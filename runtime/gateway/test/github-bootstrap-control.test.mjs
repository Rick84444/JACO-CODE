import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGithubBootstrapControl, safeBootstrapHealthLines } from '../src/github-bootstrap-control.mjs';

function stateFile() {
  return join(mkdtempSync(join(tmpdir(), 'jaco-bootstrap-test-')), 'state.json');
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return body == null ? '' : JSON.stringify(body); },
  };
}

test('Sentinel GitHub bootstrap accepts owner activate and closes the command issue', async () => {
  const calls = [];
  const system = {
    async status(){ calls.push(['status']); return { state:'READY' }; },
    async activate(profile, options){ calls.push(['activate', profile, options]); return { state:'READY' }; },
    async restart(options){ calls.push(['restart', options]); return { state:'READY' }; },
  };
  const writes = [];
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'GET' && url.includes('/issues?')) {
      return response(200, [{
        number: 97,
        title: '[JACO BOOT] Android activate',
        user: { login: 'Rick84444' },
        body: '<!-- jaco-bootstrap-control:v1 -->\n```json\n' + JSON.stringify({
          schema: 'jaco.bootstrap-control/v1',
          commandId: 'android-boot-001',
          op: 'system.activate',
        }) + '\n```',
      }]);
    }
    if (method === 'POST' && url.endsWith('/issues/97/comments')) {
      writes.push(['comment', JSON.parse(options.body).body]);
      return response(201, { id: 1 });
    }
    if (method === 'PATCH' && url.endsWith('/issues/97')) {
      writes.push(['close', JSON.parse(options.body)]);
      return response(200, { state: 'closed' });
    }
    throw new Error('unexpected fetch ' + method + ' ' + url);
  };

  const control = createGithubBootstrapControl({
    system,
    fetchImpl,
    enabled: true,
    repo: 'Rick84444/jaco-code',
    token: 'token',
    actor: 'Rick84444',
    pollMs: 5000,
    stateFile: stateFile(),
  });
  assert.equal(control.enabled, true);
  const result = await control.pollOnce();
  assert.equal(result.processed[0].status, 'READY');
  assert.deepEqual(calls, [['activate','full',{fromMcp:false}]]);
  assert.equal(writes.filter(x=>x[0]==='comment').length, 2);
  assert.equal(writes.some(x=>x[0]==='close'), true);
  assert.equal(writes.some(x=>String(x[1]).includes('arbitrary shell')), true);
});

test('Sentinel GitHub bootstrap ignores non-owner issues before parsing', async () => {
  const system = {
    async status(){ throw new Error('must not run'); },
    async activate(){ throw new Error('must not run'); },
    async restart(){ throw new Error('must not run'); },
  };
  const control = createGithubBootstrapControl({
    system,
    enabled: true,
    repo: 'Rick84444/jaco-code',
    token: 'token',
    actor: 'Rick84444',
    stateFile: stateFile(),
    fetchImpl: async (url, options = {}) => {
      if ((options.method || 'GET') === 'GET' && url.includes('/issues?')) {
        return response(200, [{
          number: 98,
          title: '[JACO BOOT] hostile',
          user: { login: 'someone-else' },
          body: '<!-- jaco-bootstrap-control:v1 -->\n{}',
        }]);
      }
      throw new Error('unexpected');
    },
  });
  const result = await control.pollOnce();
  assert.deepEqual(result.processed, []);
});

test('Sentinel GitHub bootstrap rejects unsupported operations and exposes no shell op', async () => {
  let closed = false;
  const control = createGithubBootstrapControl({
    system: { status:async()=>({}), activate:async()=>({}), restart:async()=>({}) },
    enabled: true,
    repo: 'Rick84444/jaco-code',
    token: 'token',
    actor: 'Rick84444',
    stateFile: stateFile(),
    fetchImpl: async (url, options = {}) => {
      const method = options.method || 'GET';
      if (method === 'GET' && url.includes('/issues?')) {
        return response(200, [{
          number: 99,
          title: '[JACO BOOT] no shell',
          user: { login: 'Rick84444' },
          body: '<!-- jaco-bootstrap-control:v1 -->\n' + JSON.stringify({
            schema: 'jaco.bootstrap-control/v1',
            commandId: 'android-boot-shell-001',
            op: 'shell',
          }),
        }]);
      }
      if (method === 'POST' && url.endsWith('/issues/99/comments')) return response(201, { id: 2 });
      if (method === 'PATCH' && url.endsWith('/issues/99')) { closed = true; return response(200, {}); }
      throw new Error('unexpected');
    },
  });
  const result = await control.pollOnce();
  assert.equal(result.processed[0].status, 'REJECTED');
  assert.equal(closed, true);
});

test('Sentinel GitHub bootstrap is inert without explicit enable flag and token', async () => {
  let fetched = false;
  const control = createGithubBootstrapControl({
    system: { status:async()=>({}), activate:async()=>({}), restart:async()=>({}) },
    enabled: false,
    token: '',
    stateFile: stateFile(),
    fetchImpl: async () => { fetched = true; throw new Error('must not fetch'); },
  });
  assert.equal(control.enabled, false);
  const result = await control.pollOnce();
  assert.deepEqual(result.processed, []);
  assert.equal(fetched, false);
});


test('Sentinel reads tokenless bootstrap from Git control ref and dedupes persistently', async () => {
  const calls = [];
  const file = stateFile();
  let gitReads = 0;
  let httpFetched = false;
  const gitReadImpl = async ({gitControlRef,gitControlLocalRef,gitControlPath}) => {
    gitReads++;
    assert.equal(gitControlRef,'refs/heads/jaco-control');
    assert.equal(gitControlLocalRef,'refs/jaco/bootstrap-control');
    assert.equal(gitControlPath,'.jaco/bootstrap-control.json');
    return JSON.stringify({
      schema: 'jaco.bootstrap-control/v1',
      commandId: 'android-git-boot-001',
      op: 'system.activate',
    });
  };
  const make = () => createGithubBootstrapControl({
    system: {
      async status(){ return { state:'READY' }; },
      async activate(){ calls.push('activate'); return { state:'READY' }; },
      async restart(){ calls.push('restart'); return { state:'READY' }; },
    },
    fetchImpl: async () => { httpFetched = true; throw new Error('REST must not be used in tokenless git-ref mode'); },
    gitReadImpl,
    enabled: true,
    repo: 'Rick84444/jaco-code',
    token: '',
    actor: 'Rick84444',
    pollMs: 5000,
    stateFile: file,
  });

  const firstControl = make();
  assert.equal(firstControl.pollMs, 30000);
  const first = await firstControl.pollOnce();
  assert.equal(first.enabled, true);
  assert.equal(first.processed[0].status, 'READY');
  assert.deepEqual(calls, ['activate']);
  assert.equal(httpFetched, false);
  const status = firstControl.status();
  assert.equal(status.transport, 'git-ref');
  assert.equal(status.writeback, 'local-only');
  assert.equal(status.lastProcessed.commandId, 'android-git-boot-001');
  assert.equal(status.lastProcessed.op, 'system.activate');
  assert.equal(status.lastProcessed.status, 'READY');
  assert.ok(status.lastPollAt);

  const secondControl = make();
  const second = await secondControl.pollOnce();
  assert.deepEqual(second.processed, []);
  assert.deepEqual(calls, ['activate']);
  assert.equal(secondControl.status().lastProcessed.commandId, 'android-git-boot-001');
  assert.equal(gitReads, 2);
});

test('Sentinel Git control ref dispatches fixed system.update verb', async () => {
  const calls=[];
  const control=createGithubBootstrapControl({
    system:{
      async status(){return {state:'READY'};},
      async activate(){return {state:'READY'};},
      async restart(){return {state:'READY'};},
      async update(options){calls.push(options);return {state:'UPDATED',before:'a',after:'b'};},
    },
    enabled:true,
    repo:'Rick84444/jaco-code',
    token:'',
    actor:'Rick84444',
    stateFile:stateFile(),
    gitReadImpl:async()=>JSON.stringify({
      schema:'jaco.bootstrap-control/v1',
      commandId:'android-update-001',
      op:'system.update',
    }),
  });
  const result=await control.pollOnce();
  assert.equal(result.processed[0].status,'UPDATED');
  assert.deepEqual(calls,[{fromMcp:false}]);
  assert.equal(control.status().transport,'git-ref');
  assert.equal(control.status().lastProcessed.op,'system.update');
});


test('default Git control reader fetches isolated ref without touching checkout', async () => {
  const calls=[];
  const system={
    repoRoot:'/repo',
    gitBin:'git',
    async runFile(file,args){
      calls.push([file,...args]);
      if(args[2]==='fetch') return {stdout:'',stderr:''};
      if(args[2]==='ls-tree') return {stdout:'.jaco/bootstrap-control.json\n',stderr:''};
      if(args[2]==='show') return {stdout:JSON.stringify({
        schema:'jaco.bootstrap-control/v1',
        commandId:'git-ref-default-001',
        op:'system.status',
      }),stderr:''};
      throw new Error('unexpected git op '+args.join(' '));
    },
    async status(){return {state:'READY'};},
    async activate(){throw new Error('unexpected');},
    async restart(){throw new Error('unexpected');},
    async update(){throw new Error('unexpected');},
  };
  const control=createGithubBootstrapControl({
    system,
    enabled:true,
    repo:'Rick84444/jaco-code',
    token:'',
    actor:'Rick84444',
    stateFile:stateFile(),
  });
  const result=await control.pollOnce();
  assert.equal(result.processed[0].status,'READY');
  assert.deepEqual(calls[0],[
    'git','-C','/repo','fetch','--quiet','--no-tags','origin',
    '+refs/heads/jaco-control:refs/jaco/bootstrap-control'
  ]);
  assert.deepEqual(calls[1],[
    'git','-C','/repo','ls-tree','--name-only','refs/jaco/bootstrap-control','--','.jaco/bootstrap-control.json'
  ]);
  assert.deepEqual(calls[2],[
    'git','-C','/repo','show','refs/jaco/bootstrap-control:.jaco/bootstrap-control.json'
  ]);
});

test('tokenless Git control branch without instruction is a quiet no-op, not a polling failure', async () => {
  const calls = [];
  let dispatched = false;
  const control = createGithubBootstrapControl({
    system: {
      repoRoot: '/repo',
      gitBin: 'git',
      async runFile(_bin, args) {
        calls.push(args);
        if (args[2] === 'fetch') return { stdout: '', stderr: '' };
        if (args[2] === 'ls-tree') return { stdout: '.jaco/nova-control.json\\n', stderr: '' };
        throw new Error('git show must never run when the instruction is absent');
      },
      async status(){ dispatched = true; },
      async activate(){ dispatched = true; },
      async restart(){ dispatched = true; },
      async update(){ dispatched = true; },
    },
    enabled: true,
    repo: 'Rick84444/jaco-code',
    actor: 'Rick84444',
    token: '',
    stateFile: stateFile(),
  });
  const first = await control.pollOnce();
  const second = await control.pollOnce();
  assert.deepEqual(first.processed, []);
  assert.deepEqual(second.processed, []);
  assert.equal(dispatched, false);
  assert.equal(control.status().lastError, null);
  assert.equal(control.status().transport, 'git-ref');
  assert.deepEqual(calls.map(args => args[2]), ['fetch', 'ls-tree', 'fetch', 'ls-tree']);
});

test('tokenless Git bootstrap still surfaces real fetch failures', async () => {
  const control = createGithubBootstrapControl({
    system: {
      repoRoot: '/repo',
      gitBin: 'git',
      async runFile(){ throw new Error('GIT_FETCH_FAILED'); },
    },
    enabled: true,
    repo: 'Rick84444/jaco-code',
    actor: 'Rick84444',
    token: '',
    stateFile: stateFile(),
  });
  await assert.rejects(control.pollOnce(), /GIT_FETCH_FAILED/);
  assert.match(control.status().lastError, /GIT_FETCH_FAILED/);
});

test('GitHub health receipt uses strict allowlists and never leaks model tokens or paths', () => {
  const secret = 'SECRET123-CANNOT-LEAK';
  const state = {schema:'jaco.activation/v2',ok:false,runtime:{up:true,secret},workplace:{required:true,up:false,secret},planner:{reachable:false,model:secret},tools:{toolCount:0,servers:[secret]},problems:[secret]};
  const lines = safeBootstrapHealthLines(state).join('\n');
  assert.match(lines, /Core: .UP./);
  assert.match(lines, /Workplace: .DOWN./);
  assert.match(lines, /Aura operator: .NOT_INDEPENDENTLY_PROBED./);
  assert.match(lines, /End-to-end activation: .DEGRADED./);
  assert.ok(!lines.includes(secret));
  assert.deepEqual(safeBootstrapHealthLines({state:'READY'}), []);
});
test('GitHub status body reports verified degraded health instead of misleading OBSERVED', async () => {
  const writes=[];
  const fetchImpl=async (url,opts={})=>{
    const m=opts.method||'GET';
    if (m==='GET'&&url.includes('/issues?')) return response(200,[{number:45,title:'[JACO BOOT] health',user:{login:'Rick84444'},body:'<!-- jaco-bootstrap-control:v1 -->\n'+JSON.stringify({schema:'jaco.bootstrap-control/v1',commandId:'health-status-0001',op:'system.status'})}]);
    if(m==='POST'&&url.endsWith('/issues/45/comments')){writes.push(JSON.parse(opts.body).body);return response(201,{id:1})}
    if(m==='PATCH'&&url.endsWith('/issues/45'))return response(200,{state:'closed'});
    throw Error('unexpected');
  };
  const sys={status:async()=>({schema:'jaco.activation/v2',ok:false,runtime:{up:true},workplace:{required:true,up:false},planner:{reachable:false},tools:{toolCount:0},problems:['token=SECRET']})};
  const bridge=createGithubBootstrapControl({system:sys,fetchImpl,token:'test',enabled:true,repo:'Rick84444/jaco-code',actor:'Rick84444',stateFile:stateFile()});
  const r=await bridge.pollOnce();
  assert.equal(r.processed[0].status,'DEGRADED');
  assert.match(writes[1],/status: \*\*DEGRADED\*\*/);
  assert.match(writes[1],/Workplace: .DOWN./);
  assert.ok(!writes[1].includes('SECRET'));
});

test('GitHub bootstrap system.health returns independent Core and Workplace receipt',async()=>{
  const notes=[];
  const fetchImpl=async(url,opts={})=>{
    const m=opts.method||'GET';
    if (m==='GET'&&url.includes('/issues?'))return response(200,[{
      number:77,title:'[JACO BOOT] health',user:{login:'Rick84444'},
      body:'<!-- jaco-bootstrap-control:v1 -->\n'+JSON.stringify({schema:'jaco.bootstrap-control/v1',commandId:'health-probe-v1-00077',op:'system.health'})
    }]);
    if(m==='POST'&&url.endsWith('/issues/77/comments')){notes.push(JSON.parse(opts.body).body);return response(201,{id:1})}
    if(m==='PATCH'&&url.endsWith('/issues/77'))return response(200,{state:'closed'});
    throw Error('Unexpected request');
  };
  let called=0;
  const system={health:async()=>{called++;return {
    schema:'jaco.service-health/v1',status:'DEGRADED',
    core:{up:true},workplace:{up:false,state:'DOWN',novaState:'DOWN'},
    aura:{state:'NOT_INDEPENDENTLY_PROBED'},secret:'NEVER-PUBLISH'
  }}};
  const control=createGithubBootstrapControl({system,fetchImpl,enabled:true,token:'test-token',repo:'Rick84444/jaco-code',actor:'Rick84444',stateFile:stateFile()});
  const done=await control.pollOnce();
  assert.equal(called,1);
  assert.equal(done.processed[0].status,'DEGRADED');
  assert.match(notes[1],/Core: .UP./);
  assert.match(notes[1],/Workplace: .DOWN./);
  assert.match(notes[1],/Aura operator: .NOT_INDEPENDENTLY_PROBED./);
  assert.ok(!notes[1].includes('NEVER-PUBLISH'));
});

test('failed Windows coldstart is logged without private paths, closed and never replayed',async()=>{
  const errors=[], notes=[], actions=[]; let remoteOpen=true;
  const fetchImpl=async(url,opts={})=>{
    const m=opts.method||'GET';
    if(m==='GET'&&url.includes('/issues?')) return response(200,remoteOpen ? [{
      number:123,title:'[JACO BOOT] coldstart',user:{login:'Rick84444'},
      body:'<!-- jaco-bootstrap-control:v1 -->\n'+JSON.stringify({
        schema:'jaco.bootstrap-control/v1',commandId:'windows-coldstart-000123',op:'system.activate'
      })}]:[]);
    if(m==='POST'&&url.endsWith('/issues/123/comments')){notes.push(JSON.parse(opts.body).body);return response(201,{id:22})}
    if(m==='PATCH'&&url.endsWith('/issues/123')){remoteOpen=false;return response(200,{state:'closed'})}
    throw Error('unexpected HTTP '+m+' '+url);
  };
  const system={async activate(){actions.push('activate');throw Error('C:\\Users\\operator\\private\\TOKEN=secret');}};
  const control=createGithubBootstrapControl({system,fetchImpl,enabled:true,token:'secure',
    repo:'Rick84444/jaco-code',actor:'Rick84444',stateFile:stateFile()});
  const first=await control.pollOnce();
  assert.equal(first.processed[0].status,'FAILED');
  assert.equal(remoteOpen,false);
  assert.equal(actions.length,1);
  assert.ok(notes[1].includes('TARGET_EXECUTION_FAILED'));
  assert.ok(!notes[1].includes('Users'));
  assert.ok(!notes[1].includes('secret'));
  assert.deepEqual((await control.pollOnce()).processed,[]);
  assert.equal(actions.length,1);
});

test('authenticated owner can inspect only a fingerprint-matched Nova receipt',async()=>{
  const fingerprint='a'.repeat(64), writes=[], calls=[];
  const system={async verifyNovaMission(hash){
    calls.push(hash);
    return {schema:'jaco.nova-receipt-summary/v1',status:'OBSERVED',matched:true,
      executed:true,missionId:'mission_01',missionState:'ACTIVE',phase:'READY',
      receipts:1,verifiedReceipts:1,verifiedHealthChecks:1,verifiedTask:'health-check',
      secrets:'NEVER_PRINT_THIS_SECRET'};
  }};
  const fetchImpl=async(url,opts={})=>{
    const method=opts.method||'GET';
    if(method==='GET'&&url.includes('/issues?'))return response(200,[{
      number:777,title:'[JACO BOOT] Nova receipt',user:{login:'Rick84444'},
      body:'<!-- jaco-bootstrap-control:v1 -->\n'+JSON.stringify({
        schema:'jaco.bootstrap-control/v1',commandId:'read-only-nova-receipt-001',
        op:'system.nova-receipt',goalSha256:fingerprint,
      })}]);
    if(method==='POST'&&url.includes('/issues/777/comments')){writes.push(JSON.parse(opts.body).body);return response(201,{id:88})}
    if(method==='PATCH'&&url.endsWith('/issues/777'))return response(200,{state:'closed'});
    throw Error('Unexpected HTTP operation '+method);
  };
  const control=createGithubBootstrapControl({
    system,fetchImpl,enabled:true,repo:'Rick84444/jaco-code',
    token:'token',actor:'Rick84444',stateFile:stateFile(),
  });
  const result=await control.pollOnce();
  assert.equal(result.processed[0].status,'OBSERVED');
  assert.deepEqual(calls,[fingerprint]);
  assert.equal(writes.length,2);
  assert.match(writes[1],/Verified health checks: \`1\`/);
  assert.doesNotMatch(writes.join('\\n'),/NEVER_PRINT_THIS_SECRET/);
});

test('Aura-only GitHub operator issue invokes the canonical goal once, even after polling again',async()=>{
  const calls=[],comments=[],file=stateFile();
  let closed=false;
  const payload={schema:'jaco.aura-command/v1',commandId:'aura-first-real-command-20261030-v1',op:'aura.acceptance'};
  const fetchImpl=async(url,options={})=>{
    const method=options.method||'GET';
    if(method==='GET'&&url.includes('/issues?'))return response(200,closed?[]:[{
      number:880,title:'[JACO AURA] First operator command',
      user:{login:'Rick84444'},
      body:'<!-- jaco-aura-control:v1 -->\n'+JSON.stringify(payload),
    }]);
    if(method==='POST'&&url.endsWith('/issues/880/comments')) {
      comments.push(JSON.parse(options.body).body);
      return response(201,{id:89});
    }
    if(method==='PATCH'&&url.endsWith('/issues/880')) {
      closed=true;return response(200,{state:'closed'});
    }
    throw new Error('unexpected '+method+' '+url);
  };
  const system={async auraReadiness(){return {ready:true,attempts:1};},async startAuraAcceptance(){calls.push('aura');
    return {schema:'jaco.aura-operator-command/v1',status:'ACCEPTED',goalId:'goal-123',execution:'NOT_VERIFIED'};}};
  const make=()=>createGithubBootstrapControl({system,fetchImpl,enabled:true,
    repo:'Rick84444/JACO-CODE',token:'test-github-token',actor:'Rick84444',stateFile:file});
  const control=make();
  const first=await control.pollOnce();
  assert.equal(first.processed[0].status,'ACCEPTED');
  assert.deepEqual(calls,['aura']);
  assert.equal(comments.length,2);
  assert.match(comments[1],/Goal ID: \`goal-123\`/);
  assert.match(comments[1],/Mission execution: \`NOT_VERIFIED\`/);
  assert.equal(closed,true);
  assert.deepEqual((await make().pollOnce()).processed,[]);
  assert.deepEqual(calls,['aura']);
});

test('Aura operator issue rejects arbitrary goal text and does not invoke Core',async()=>{
  let called=false,closed=false;
  const fetchImpl=async(url,options={})=>{
    const method=options.method||'GET';
    if(method==='GET'&&url.includes('/issues?'))return response(200,[{
      number:881,title:'[JACO AURA] Unsafe arbitrary goal',
      user:{login:'Rick84444'},
      body:'<!-- jaco-aura-control:v1 -->\n'+JSON.stringify({
        schema:'jaco.aura-command/v1',
        commandId:'aura-arbitrary-goal-20261030-v1',
        op:'aura.acceptance',goal:'run powershell remotely',
      }),
    }]);
    if(method==='POST'&&url.endsWith('/issues/881/comments'))return response(201,{id:90});
    if(method==='PATCH'&&url.endsWith('/issues/881')){closed=true;return response(200,{});}
    throw Error('Unexpected HTTP');
  };
  const result=await createGithubBootstrapControl({
    system:{async startAuraAcceptance(){called=true;throw Error('must not run');}},
    fetchImpl,enabled:true,repo:'Rick84444/JACO-CODE',token:'token',
    actor:'Rick84444',stateFile:stateFile(),
  }).pollOnce();
  assert.equal(result.processed[0].status,'REJECTED');
  assert.equal(called,false);
  assert.equal(closed,true);
});

test('Aura goal is journaled before execution so a failed remote response cannot replay it',async()=>{
  let called=0;
  const file=stateFile();
  const fetchImpl=async(url,options={})=>{
    const method=options.method||'GET';
    if(method==='GET'&&url.includes('/issues?'))return response(200,[{
      number:882,title:'[JACO AURA] Intent durability',
      user:{login:'Rick84444'},
      body:'<!-- jaco-aura-control:v1 -->\n'+JSON.stringify({
        schema:'jaco.aura-command/v1',commandId:'aura-intent-failed-20261030-v1',op:'aura.acceptance'}),
    }]);
    if(method==='POST'&&url.endsWith('/issues/882/comments'))return response(201,{});
    if(method==='PATCH'&&url.endsWith('/issues/882'))return response(200,{});
    throw Error('Unexpected HTTP');
  };
  const make=()=>createGithubBootstrapControl({
    system:{async auraReadiness(){return {ready:true,attempts:1};},async startAuraAcceptance(){called++;throw Error('private target host error');}},
    fetchImpl,enabled:true,repo:'Rick84444/JACO-CODE',token:'token',
    actor:'Rick84444',stateFile:file,
  });
  const first=await make().pollOnce();
  assert.equal(first.processed[0].status,'FAILED');
  assert.equal(called,1);
  assert.deepEqual((await make().pollOnce()).processed,[]);
  assert.equal(called,1);
});

test('delayed Core: NOT_READY keeps the Aura command open and unjournaled, then registers exactly one goal',async()=>{
  const file=stateFile(),comments=[];
  let closed=false,ready=false,goals=0,probes=0;
  const fetchImpl=async(url,options={})=>{
    const method=options.method||'GET';
    if(method==='GET'&&url.includes('/issues?'))return response(200,closed?[]:[{
      number:883,title:'[JACO AURA] Cold start',user:{login:'Rick84444'},
      body:'<!-- jaco-aura-control:v1 -->\n'+JSON.stringify({schema:'jaco.aura-command/v1',commandId:'aura-cold-start-20261031-v1',op:'aura.acceptance'}),
    }]);
    if(method==='POST'&&url.endsWith('/issues/883/comments')){comments.push(JSON.parse(options.body).body);return response(201,{});}
    if(method==='PATCH'&&url.endsWith('/issues/883')){closed=true;return response(200,{});}
    throw Error('Unexpected HTTP');
  };
  const system={
    async auraReadiness(){probes++;return ready?{ready:true,attempts:1}:{ready:false,reason:'SEER_UNREACHABLE',attempts:30};},
    async startAuraAcceptance(){goals++;return {schema:'jaco.aura-operator-command/v1',status:'ACCEPTED',goalId:'goal-cold-1',execution:'NOT_VERIFIED'};},
  };
  const make=()=>createGithubBootstrapControl({system,fetchImpl,enabled:true,repo:'Rick84444/JACO-CODE',token:'token',actor:'Rick84444',stateFile:file});
  const control=make();
  assert.equal((await control.pollOnce()).processed[0].status,'NOT_READY');
  assert.equal((await control.pollOnce()).processed[0].status,'NOT_READY');
  assert.equal(goals,0);
  assert.equal(closed,false);
  assert.equal(comments.length,1);
  assert.match(comments[0],/NOT_READY/);
  assert.match(comments[0],/SEER_UNREACHABLE/);
  assert.deepEqual(JSON.parse(readFileSync(file,'utf8')).handled,[]);
  ready=true;
  // A restarted Sentinel still sees an open, unjournaled command and may submit it once.
  assert.equal((await make().pollOnce()).processed[0].status,'ACCEPTED');
  assert.equal(goals,1);
  assert.equal(closed,true);
  assert.deepEqual((await make().pollOnce()).processed,[]);
  assert.equal(goals,1);
  assert.equal(probes,3);
});

test('Aura command without a readiness probe fails closed as NOT_READY',async()=>{
  let goals=0;
  const fetchImpl=async(url,options={})=>{
    const method=options.method||'GET';
    if(method==='GET'&&url.includes('/issues?'))return response(200,[{
      number:884,title:'[JACO AURA] No probe',user:{login:'Rick84444'},
      body:'<!-- jaco-aura-control:v1 -->\n'+JSON.stringify({schema:'jaco.aura-command/v1',commandId:'aura-no-probe-20261031-v1',op:'aura.acceptance'}),
    }]);
    if(method==='POST')return response(201,{});
    throw Error('Unexpected HTTP');
  };
  const result=await createGithubBootstrapControl({system:{async startAuraAcceptance(){goals++;}},fetchImpl,enabled:true,
    repo:'Rick84444/JACO-CODE',token:'token',actor:'Rick84444',stateFile:stateFile()}).pollOnce();
  assert.equal(result.processed[0].status,'NOT_READY');
  assert.equal(goals,0);
});
