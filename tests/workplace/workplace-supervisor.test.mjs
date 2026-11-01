import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createWorkplaceAgentSupervisor } from '../../gateway/src/workplace/workplace-agent-supervisor.mjs';
import { joinWorkplace, buildAgentCard } from '../../agents/lib/workplace-session.mjs';

function fakeChild(pid=4242) {
  const child = new EventEmitter();
  child.pid = pid;
  child.kill = signal => {
    queueMicrotask(() => child.emit('exit', 0, signal));
    return true;
  };
  return child;
}

function jsonResponse(body, ok=true, status=200) {
  return { ok, status, json: async()=>body };
}

test('local Workplace scope retains remote mission routing without using the remote session', async () => {
  const calls = [];
  const bootstrap = async (_card, options) => {
    calls.push(options);
    return {
      client: { cursor: 0, sessionId: 'session-test', end: async () => null },
      registration: { agentId: 'agent:test', sessionId: 'session-test' },
      sync: { events: [], decisions: [] },
    };
  };
  const card = buildAgentCard({
    stableId: 'scope-test', name: 'Scope test', agentType: 'runtime',
    role: 'test', description: 'test'
  });
  const env = {
    JACO_HUB_URL: 'https://api.jacocode.com',
    JACO_DEVICE_KEY: 'jdev_device_token_test',
    JACO_NOVA_EXECUTOR: 'nova@dickdator',
    JACO_WORKPLACE_URL: 'http://127.0.0.1:2995',
    JACO_WORKPLACE_TOKEN: 'local-workplace-test-token'
  };
  const local = await joinWorkplace({
    card, env: { ...env, JACO_WORKPLACE_SCOPE: 'local' }, bootstrap,
  });
  assert.equal(local.state, 'READY');
  assert.equal(calls[0].baseUrl,env.JACO_WORKPLACE_URL);
  assert.equal(calls[0].token,env.JACO_WORKPLACE_TOKEN);
  await local.end();

  const linked = await joinWorkplace({ card, env, bootstrap });
  assert.equal(linked.state, 'READY');
  assert.equal(calls[1].baseUrl,env.JACO_HUB_URL + '/v1/device/workplace');
  assert.equal(calls[1].token,env.JACO_DEVICE_KEY);
  await linked.end();
});

test('Workplace agent supervision stays disabled unless explicitly enabled', async()=>{
  let spawned=0;
  const supervisor=createWorkplaceAgentSupervisor({
    env:{},
    spawnImpl:()=>{spawned++;return fakeChild();},
    fetchImpl:async()=>jsonResponse({}),
    log:()=>{},error:()=>{}
  });
  await supervisor.start('http://127.0.0.1:2995');
  assert.equal(supervisor.snapshot().state,'DISABLED');
  assert.equal(spawned,0);
});

test('supervisor starts the configured desktop executor and withholds operator credentials', async t => {
  const spawns = [];
  const supervisor = createWorkplaceAgentSupervisor({
    env: { JACO_WORKPLACE_SUPERVISE_NOVA: '1', JACO_EXECUTOR: 'desktop-agentos',
      JACO_GATEWAY_TOKEN: 'test-gateway-token-123456789012345',
      JACO_WORKPLACE_OPERATOR_TOKEN: 'operator-test',
      JACO_CHATGPT_WORKPLACE_TOKEN: 'relay-test-secret',
      GITHUB_TOKEN: 'github-test', STRIPE_SECRET_KEY: 'stripe-test' },
    spawnImpl: (cmd, args, opts) => {
      const child = fakeChild(); spawns.push({ args, opts, child });
      queueMicrotask(() => child.emit('spawn')); return child;
    },
    fetchImpl: async (url,opts={}) => {
      if (String(url).endsWith('/cortex/brain')) {
        assert.equal(JSON.parse(opts.body).startup_probe,true);
        return jsonResponse({ ok: true, text: 'JACO_SEER_READY', local: true });
      }
      return jsonResponse({});
    },
    log: () => {}, error: () => {}, restartDelayMs: 5,
  });
  t.after(() => supervisor.stop());
  await supervisor.start('http://127.0.0.1:2995');
  for (let i = 0; i < 100 && !spawns.length; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(spawns.length, 1);
  assert.deepEqual(spawns[0].args, ['agents/run-desktop-agentos.mjs']);
  assert.equal(spawns[0].opts.windowsHide, true);
  for (const key of ['JACO_WORKPLACE_OPERATOR_TOKEN', 'JACO_CHATGPT_WORKPLACE_TOKEN', 'GITHUB_TOKEN', 'STRIPE_SECRET_KEY']) assert.equal(spawns[0].opts.env[key], undefined);
  assert.equal(supervisor.snapshot().nova.executor, 'desktop-agentos');
  spawns[0].child.emit('exit', 1, null);
  for (let i = 0; i < 100 && spawns.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(spawns.length, 2, 'failed executor must restart through its existing supervisor');
  assert.deepEqual(spawns[1].args, ['agents/run-desktop-agentos.mjs']);
});

test('Workplace starts LiteRT, then SEER, verifies brain inference, then starts Nova', async()=>{
  let pid=5000;
  let modelHealthy=false;
  let seerHealthy=false;
  const spawns=[];
  const env={
    JACO_WORKPLACE_SUPERVISE_MODEL:'1',
    JACO_WORKPLACE_SUPERVISE_SEER:'1',
    JACO_WORKPLACE_SUPERVISE_NOVA:'1',
    JACO_GATEWAY_TOKEN:'local-token-12345678901234567890',
    // A formerly paired phone still has these entries in the checkout .env.
    JACO_HUB_URL:'https://api.jacocode.com',
    JACO_DEVICE_KEY:'jdev_revoked_or_stale',
    JACO_NOVA_EXECUTOR:'nova@dickdator',
    JACO_RUNTIME_URL:'http://127.0.0.1:3000',
    SEER_URL:'http://127.0.0.1:2997',
    JACO_LITERT_URL:'http://127.0.0.1:9379/v1',
  };

  const supervisor=createWorkplaceAgentSupervisor({
    root:'/repo',
    env,
    spawnImpl:(cmd,args,opts)=>{
      const child=fakeChild(++pid);
      const kind=cmd==='litert-lm' ? 'model' : args.includes('gateway/src/seer-start.mjs') ? 'seer' : 'nova';
      spawns.push({kind,cmd,args,opts,child});
      if(kind==='model') modelHealthy=true;
      if(kind==='seer') seerHealthy=true;
      queueMicrotask(()=>child.emit('spawn'));
      return child;
    },
    fetchImpl:async (url,opts={})=>{
      const u=String(url);
      if(u==='http://127.0.0.1:3000/api/runtime/identity') return jsonResponse({});
      if(u==='http://127.0.0.1:9379/v1/models') return jsonResponse({data:[{id:'gemma4-e4b'}]},modelHealthy,modelHealthy?200:503);
      if(u==='http://127.0.0.1:11434/api/tags') return jsonResponse({},false,503);
      if(u==='http://127.0.0.1:2997/health') return jsonResponse({ok:true},seerHealthy,seerHealthy?200:503);
      if(u==='http://127.0.0.1:2997/cortex/brain') {
        assert.equal(opts.method,'POST');
        assert.match(String(opts.headers.Authorization),/^Bearer /);
        const readiness=JSON.parse(opts.body);
        assert.equal(readiness.max_tokens,128);
        assert.equal(readiness.startup_probe,true);
        return jsonResponse({ok:true,text:'JACO_SEER_READY',provider:'litert',model:'gemma4-e4b',local:true},true,200);
      }
      throw new Error(`unexpected URL ${u}`);
    },
    log:()=>{},error:()=>{},
    restartDelayMs:5,
  });

  await supervisor.start('http://127.0.0.1:2995');
  await new Promise(r=>setTimeout(r,50));

  assert.deepEqual(spawns.map(x=>x.kind),['model','seer','nova']);
  assert.equal(spawns[0].cmd,'litert-lm');
  assert.deepEqual(spawns[0].args,['serve','--host','127.0.0.1','--port','9379']);
  assert.deepEqual(spawns[1].args,['--experimental-sqlite','gateway/src/seer-start.mjs']);
  assert.deepEqual(spawns[2].args,['agents/hands-off-agent.mjs']);
  for (const child of spawns) {
    // Force locally supervised Workplace sessions, without dropping the
    // operator's remote Hub mission credentials for the same Nova process.
    assert.equal(child.opts.env.JACO_WORKPLACE_SCOPE,'local');
    assert.equal(child.opts.env.JACO_HUB_URL,'https://api.jacocode.com');
    assert.equal(child.opts.env.JACO_DEVICE_KEY,'jdev_revoked_or_stale');
    assert.equal(child.opts.env.JACO_NOVA_EXECUTOR,'nova@dickdator');
    assert.equal(child.opts.env.JACO_WORKPLACE_URL,'http://127.0.0.1:2995');
    assert.equal(child.opts.env.JACO_WORKPLACE_REQUIRED,'1');
  }

  const state=supervisor.snapshot();
  assert.equal(state.state,'RUNNING');
  assert.equal(state.model.state,'READY');
  assert.equal(state.model.ownership,'workplace');
  assert.equal(state.model.provider,'litert');
  assert.ok(state.model.pid);
  assert.equal(state.seer.state,'READY');
  assert.equal(state.seer.ownership,'workplace');
  assert.ok(state.seer.pid);
  assert.equal(state.nova.state,'RUNNING');
  assert.ok(state.nova.pid);

  await supervisor.stop();
  assert.equal(supervisor.snapshot().state,'STOPPED');
});

test('Workplace adopts healthy external provider and SEER without duplicate processes', async()=>{
  let pid=7000;
  const spawns=[];
  const supervisor=createWorkplaceAgentSupervisor({
    root:'/repo',
    env:{
      JACO_WORKPLACE_SUPERVISE_MODEL:'1',
      JACO_WORKPLACE_SUPERVISE_SEER:'1',
      JACO_WORKPLACE_SUPERVISE_NOVA:'1',
      JACO_GATEWAY_TOKEN:'local-token-12345678901234567890',
      JACO_RUNTIME_URL:'http://127.0.0.1:3000',
      SEER_URL:'http://127.0.0.1:2997',
    },
    spawnImpl:(cmd,args,opts)=>{
      const child=fakeChild(++pid);
      spawns.push({cmd,args,opts,child});
      queueMicrotask(()=>child.emit('spawn'));
      return child;
    },
    fetchImpl:async (url)=>{
      const u=String(url);
      if(u.endsWith('/api/runtime/identity')) return jsonResponse({});
      if(u.endsWith(':9379/v1/models')) return jsonResponse({data:[{id:'external-model'}]});
      if(u.endsWith(':2997/health')) return jsonResponse({ok:true});
      if(u.endsWith(':2997/cortex/brain')) return jsonResponse({ok:true,text:'ready',provider:'litert',model:'external-model',local:true});
      return jsonResponse({},false,503);
    },
    log:()=>{},error:()=>{},
    restartDelayMs:5,
  });

  await supervisor.start('http://127.0.0.1:2995');
  await new Promise(r=>setTimeout(r,35));

  assert.equal(spawns.length,1);
  assert.deepEqual(spawns[0].args,['agents/hands-off-agent.mjs']);
  const state=supervisor.snapshot();
  assert.equal(state.model.ownership,'external');
  assert.equal(state.model.pid,null);
  assert.equal(state.seer.ownership,'external');
  assert.equal(state.seer.pid,null);
  assert.equal(state.nova.state,'RUNNING');

  await supervisor.stop();
});

test('Workplace supervises forced llama.cpp, verifies SEER brain, then starts Nova', async()=>{
  let llamaHealthy=false;
  const spawns=[];
  const supervisor=createWorkplaceAgentSupervisor({
    env:{
      JACO_WORKPLACE_SUPERVISE_MODEL:'1',
      JACO_WORKPLACE_SUPERVISE_SEER:'1',
      JACO_WORKPLACE_SUPERVISE_NOVA:'1',
      JACO_GATEWAY_TOKEN:'local-token-12345678901234567890',
      JACO_RUNTIME_URL:'http://127.0.0.1:3000',
      SEER_URL:'http://127.0.0.1:2997',
      JACO_SEER_PROVIDER_PREFERENCE:'llamacpp',
      JACO_LLAMACPP_URL:'http://127.0.0.1:9380/v1',
      JACO_LLAMACPP_SERVER:'/home/test/llama.cpp/build/bin/llama-server',
      JACO_LLAMACPP_MODEL:'/models/Bonsai-27B-Q1_0.gguf',
      JACO_LLAMACPP_CTX:'2048',
      JACO_WORKPLACE_SEER_BRAIN_MAX_TOKENS:'128',
    },
    spawnImpl:(cmd,args,opts)=>{
      const child=fakeChild(8100+spawns.length);
      const kind=String(cmd).includes('llama-server') ? 'model' : 'nova';
      spawns.push({kind,cmd,args,opts,child});
      if(kind==='model') llamaHealthy=true;
      queueMicrotask(()=>child.emit('spawn'));
      return child;
    },
    fetchImpl:async(url,opts={})=>{
      const u=String(url);
      if(u.endsWith('/api/runtime/identity')) return jsonResponse({});
      if(u==='http://127.0.0.1:9380/v1/models') {
        return jsonResponse({data:[{id:'/models/Bonsai-27B-Q1_0.gguf'}]},llamaHealthy,llamaHealthy?200:503);
      }
      if(u.endsWith(':2997/health')) return jsonResponse({ok:true});
      if(u.endsWith(':2997/cortex/brain')) {
        const readiness=JSON.parse(opts.body);
        assert.equal(readiness.max_tokens,128);
        assert.equal(readiness.startup_probe,true);
        return jsonResponse({ok:true,text:'JACO_SEER_READY',provider:'llamacpp',model:'/models/Bonsai-27B-Q1_0.gguf',local:true});
      }
      return jsonResponse({},false,503);
    },
    log:()=>{},error:()=>{},restartDelayMs:5,
  });

  await supervisor.start('http://127.0.0.1:2995');
  await new Promise(r=>setTimeout(r,50));

  assert.deepEqual(spawns.map(x=>x.kind),['model','nova']);
  assert.equal(spawns[0].cmd,'/home/test/llama.cpp/build/bin/llama-server');
  assert.deepEqual(spawns[0].args,[
    '-m','/models/Bonsai-27B-Q1_0.gguf',
    '-c','2048',
    '--host','127.0.0.1',
    '--port','9380',
    '--reasoning','off',
  ]);
  const state=supervisor.snapshot();
  assert.equal(state.model.provider,'llamacpp');
  assert.equal(state.model.ownership,'workplace');
  assert.ok(state.model.pid);
  assert.equal(state.nova.state,'RUNNING');

  await supervisor.stop();
});

test('Nova cannot start when SEER health is up but real brain inference fails', async()=>{
  const spawns=[];
  const supervisor=createWorkplaceAgentSupervisor({
    env:{
      JACO_WORKPLACE_SUPERVISE_MODEL:'1',
      JACO_WORKPLACE_SUPERVISE_SEER:'1',
      JACO_WORKPLACE_SUPERVISE_NOVA:'1',
      JACO_GATEWAY_TOKEN:'local-token-12345678901234567890',
      JACO_RUNTIME_URL:'http://127.0.0.1:3000',
      SEER_URL:'http://127.0.0.1:2997',
      JACO_WORKPLACE_DEPENDENCY_WAIT_MS:'40',
    },
    spawnImpl:(cmd,args)=>{
      const child=fakeChild(9000+spawns.length);
      spawns.push({cmd,args,child});
      queueMicrotask(()=>child.emit('spawn'));
      return child;
    },
    fetchImpl:async url=>{
      const u=String(url);
      if(u.endsWith('/api/runtime/identity')) return jsonResponse({});
      if(u.endsWith(':9379/v1/models')) return jsonResponse({data:[{id:'gemma'}]});
      if(u.endsWith(':2997/health')) return jsonResponse({ok:true});
      if(u.endsWith(':2997/cortex/brain')) return jsonResponse({ok:false,error:'all_providers_failed'},false,503);
      return jsonResponse({},false,503);
    },
    log:()=>{},error:()=>{},
    restartDelayMs:1000,
  });

  await supervisor.start('http://127.0.0.1:2995');
  await new Promise(r=>setTimeout(r,120));

  assert.equal(spawns.some(x=>x.args.includes('agents/hands-off-agent.mjs')),false);
  assert.equal(supervisor.snapshot().state,'DEPENDENCY_FAILED');

  await supervisor.stop();
});

test('Aura-only startup skips all local model probes and waits for actual selected-model inference', async t => {
  const spawns = [], calls = [];
  let releaseBrain;
  const brain = new Promise(resolve => { releaseBrain = resolve; });
  let supervisor;
  supervisor = createWorkplaceAgentSupervisor({
    env: { JACO_WORKPLACE_SUPERVISE_MODEL: '0', JACO_WORKPLACE_SUPERVISE_SEER: '1',
      JACO_WORKPLACE_SUPERVISE_NOVA: '1', JACO_SEER_PROVIDER_PREFERENCE: 'aura',
      JACO_GATEWAY_TOKEN: 'fixture-gateway-token' },
    fetchImpl: async url => {
      calls.push(String(url));
      if (String(url).endsWith('/api/runtime/identity')) return jsonResponse({});
      if (String(url).endsWith('/health')) return jsonResponse({});
      if (String(url).endsWith('/cortex/brain')) return brain;
      assert.fail('Unexpected local model probe: ' + url);
    },
    spawnImpl: (cmd, args) => {
      const child = fakeChild(12000 + spawns.length);
      spawns.push({ cmd, args, child });
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }, log: () => {}, error: () => {},
  });
  t.after(() => supervisor.stop());
  await supervisor.start('http://127.0.0.1:2995');
  for (let i=0;i<100 && !calls.some(u=>u.endsWith('/cortex/brain'));i++) await new Promise(r=>setTimeout(r,2));
  assert.equal(supervisor.snapshot().state, 'VERIFYING_SEER_BRAIN');
  assert.equal(supervisor.snapshot().model.state, 'WAITING_SELECTED_PROVIDER');
  assert.equal(spawns.length, 0, 'no Nova before inference succeeds');
  releaseBrain(jsonResponse({ ok: true, text: 'JACO_SEER_READY', provider: 'fixture-cloud', local: false }));
  for (let i=0;i<100 && !spawns.length;i++) await new Promise(r=>setTimeout(r,2));
  assert.equal(supervisor.snapshot().state, 'RUNNING');
  assert.equal(supervisor.snapshot().model.provider, 'fixture-cloud');
  assert.equal(supervisor.snapshot().model.pid, null);
  assert.deepEqual(spawns.map(s=>s.args), [['agents/hands-off-agent.mjs']]);
});

test('stopping during a runtime probe cannot later start model or agents', async () => {
  let release;
  const response = new Promise(resolve => { release = resolve; });
  const supervisor = createWorkplaceAgentSupervisor({
    env: { JACO_WORKPLACE_SUPERVISE_MODEL: '1' },
    fetchImpl: async () => response,
    spawnImpl: () => assert.fail('spawn after stop'), log: () => {}, error: () => {},
  });
  await supervisor.start('http://127.0.0.1:2995');
  await supervisor.stop();
  release(jsonResponse({}));
  await new Promise(r=>setTimeout(r,20));
  assert.equal(supervisor.snapshot().state, 'STOPPED');
});

test('shutdown does not await a second exit from an already-exited child', async () => {
  let child;
  const supervisor = createWorkplaceAgentSupervisor({
    env: { JACO_WORKPLACE_SUPERVISE_NOVA: '1', JACO_GATEWAY_TOKEN: 'fixture-token' },
    fetchImpl: async url => String(url).endsWith('/cortex/brain')
      ? jsonResponse({ ok: true, text: 'ready' }) : jsonResponse({}),
    spawnImpl: () => { child = fakeChild(); queueMicrotask(()=>child.emit('spawn')); return child; },
    log: () => {}, error: () => {},
  });
  await supervisor.start('http://127.0.0.1:2995');
  for (let i=0;i<100 && !child;i++) await new Promise(r=>setTimeout(r,2));
  assert.ok(child);
  child.exitCode = 0;
  child.kill = () => assert.fail('must not signal already-exited PID');
  await supervisor.stop();
  assert.equal(supervisor.snapshot().state, 'STOPPED');
});
