import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, mkdirSync, rmdirSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
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


// Reliability regressions: no real network, process activation or repo mutation.
function reliabilityIssue(number, commandId, extra = {}) {
  return {
    number, title: '[JACO BOOT] reliability regression', user: { login: 'Rick84444' },
    body: '<!-- jaco-bootstrap-control:v1 -->\n' + JSON.stringify({
      schema: 'jaco.bootstrap-control/v1', commandId, op: 'system.activate',
    }), ...extra,
  };
}

function reliabilityControl({file, fetchImpl, system, ...rest}) {
  return createGithubBootstrapControl({
    system, fetchImpl, enabled: true, repo: 'Rick84444/JACO-CODE',
    token: 'mock-token', actor: 'Rick84444', stateFile: file, ...rest,
  });
}

function readJournal(file, id) {
  return JSON.parse(readFileSync(join(file + '.journal', createHash('sha256').update(id).digest('hex') + '.json'), 'utf8'));
}

test('durable claim precedes activation; acknowledged terminal receipt is retained', async () => {
  const file = stateFile(), id = 'claim-before-dispatch-001', issue = reliabilityIssue(901, id);
  let actions = 0;
  const control = reliabilityControl({file, system: {
    async activate() {
      actions++;
      assert.equal(readJournal(file, id).phase, 'CLAIMED');
      return {state:'READY'};
    }
  }, fetchImpl: async (url, opts = {}) => {
    if (url.includes('/issues?')) return response(200, [issue]);
    if (opts.method === 'POST') return response(201, {});
    if (opts.method === 'PATCH') return response(200, {});
    throw Error('unexpected request');
  }});
  assert.equal((await control.pollOnce()).processed[0].status, 'READY');
  const record = readJournal(file, id);
  assert.equal(record.phase, 'TERMINAL');
  assert.equal(record.delivered, true);
  assert.equal(record.state, 'READY');
  assert.deepEqual((await control.pollOnce()).processed, []);
  assert.equal(actions, 1);
});

test('ambiguous terminal comment POST is reconciled after restart without activation replay', async () => {
  const file = stateFile(), id = 'outbox-post-ambiguous-001', issue = reliabilityIssue(902, id);
  let actions = 0, closed = false, lost = false;
  const notes = [];
  const system = {async activate() { actions++; return {state:'READY'}; }};
  const fetchImpl = async (url, opts = {}) => {
    if (url.includes('/issues?')) return response(200, closed ? [] : [issue]);
    if (url.includes('/comments?')) return response(200, notes.map(body => ({body,user:{login:'Rick84444'}})));
    if (opts.method === 'POST') {
      const body = JSON.parse(opts.body).body; notes.push(body);
      if (body.includes('jaco-bootstrap-receipt:') && !lost) {
        lost = true;
        throw Error('connection reset after GitHub stored receipt');
      }
      return response(201, {});
    }
    if (opts.method === 'PATCH') { closed = true; return response(200, {}); }
    throw Error('unexpected request');
  };
  const make = () => reliabilityControl({file, system, fetchImpl});
  assert.equal((await make().pollOnce()).processed[0].status, 'READY');
  assert.equal(readJournal(file, id).delivered, false);
  assert.equal(readJournal(file, id).state, 'READY');
  assert.equal(closed, false);
  const restarted = make();
  await restarted.pollOnce();
  assert.equal(readJournal(file, id).delivered, true);
  assert.equal(restarted.status().pendingReceipts, 0);
  assert.equal(closed, true);
  assert.equal(actions, 1);
  assert.equal(notes.filter(n=>n.includes('jaco-bootstrap-receipt:')).length, 1);
});

test('closure failure does not erase successful result or duplicate the terminal comment', async () => {
  const file = stateFile(), id = 'outbox-close-failed-001', issue = reliabilityIssue(903, id);
  let posts = 0, actions = 0, closes = 0;
  const system = {async activate() { actions++; return {state:'READY'}; }};
  const fetchImpl = async (url, opts = {}) => {
    if (url.includes('/issues?')) return response(200, [issue]);
    if (opts.method === 'POST') { posts++; return response(201, {}); }
    if (opts.method === 'PATCH') {
      if (++closes === 1) return response(503, {message:'temporary outage'});
      return response(200, {});
    }
    throw Error('unexpected request');
  };
  const make = () => reliabilityControl({file, system, fetchImpl});
  const first = make();
  assert.equal((await first.pollOnce()).processed[0].status, 'READY');
  assert.equal(first.status().pendingReceipts, 1);
  assert.equal(readJournal(file,id).commentSent, true);
  await make().pollOnce();
  assert.equal(readJournal(file,id).delivered, true);
  assert.deepEqual([actions, posts, closes], [1,2,2]);
});

test('a stranded claim is UNKNOWN, not auto-dispatched after restart', async () => {
  const file = stateFile(), id = 'stranded-claim-001', issue = reliabilityIssue(904, id);
  mkdirSync(file + '.journal');
  writeFileSync(join(file + '.journal', createHash('sha256').update(id).digest('hex') + '.json'), JSON.stringify({
    schema:'jaco.bootstrap-journal/v1', commandId:id, op:'system.activate', issueNumber:904,
    phase:'CLAIMED', pid:process.pid, at:new Date().toISOString(),
  }));
  let actions = 0; const notes = [];
  const control = reliabilityControl({file, system:{async activate(){actions++;}}, fetchImpl: async (url,opts={})=>{
    if (url.includes('/issues?')) return response(200,[issue]);
    if (opts.method === 'POST') {notes.push(JSON.parse(opts.body).body);return response(201,{});}
    if (opts.method === 'PATCH') return response(200,{});
    throw Error('unexpected request');
  }});
  await control.pollOnce();
  assert.equal(actions, 0);
  assert.equal(readJournal(file,id).state,'UNKNOWN');
  assert.equal(readJournal(file,id).delivered,true);
  assert.match(notes[0], /UNKNOWN/);
  assert.equal(control.status().lastProcessed.status,'UNKNOWN');
});

test('two simultaneous pollers sharing a journal cannot dispatch identical command twice', async () => {
  const file = stateFile(), id = 'parallel-command-claim-001', issue = reliabilityIssue(905,id);
  let actions=0, release, started;
  const hold = new Promise(r=>{release=r;});
  const entered = new Promise(r=>{started=r;});
  const system={async activate(){actions++; started(); await hold; return {state:'READY'};}};
  const fetchImpl=async(url,opts={})=>{
    if(url.includes('/issues?'))return response(200,[issue]);
    if(opts.method==='POST')return response(201,{});
    if(opts.method==='PATCH')return response(200,{});
    throw Error('unexpected request');
  };
  const first=reliabilityControl({file,system,fetchImpl});
  const second=reliabilityControl({file,system,fetchImpl});
  const running=first.pollOnce();
  await entered;
  try {
    assert.deepEqual((await second.pollOnce()).processed,[]);
    assert.equal(readJournal(file,id).phase,'CLAIMED');
    assert.equal(actions,1);
  } finally { release(); await running; }
  assert.equal(readJournal(file,id).state,'READY');
});

test('journal storage fault clears inFlight so a repaired state path can poll again', async () => {
  const file=stateFile();
  let requests=0;
  const control=reliabilityControl({file,system:{},fetchImpl:async()=>{requests++; return response(200,[]);}});
  mkdirSync(file);
  await assert.rejects(control.pollOnce());
  assert.equal(requests,0);
  rmdirSync(file);
  assert.equal((await control.pollOnce()).enabled,true);
  assert.equal(requests,1);
  assert.ok(control.status().lastSuccessfulPollAt);
});

test('explicit API mode fails closed when token absent; does not read or execute git-ref', async()=>{
  let reads=0;
  const control=reliabilityControl({file:stateFile(),system:{},token:'',transportMode:'github-api',
    fetchImpl:async()=>{throw Error('no HTTP without token');},
    gitReadImpl:async()=>{reads++;throw Error('no implicit fallback');}
  });
  await assert.rejects(control.pollOnce(),/GITHUB_BOOTSTRAP_TOKEN_REQUIRED/);
  assert.equal(reads,0);
  assert.equal(control.status().inboxState,'AUTH_REQUIRED');
  assert.equal(control.status().transport,'github-api');
});

test('unauthorized API transport does not silently fall back to git-ref',async()=>{
  let reads=0;
  const control=reliabilityControl({file:stateFile(),system:{},transportMode:'auto',
    fetchImpl:async()=>response(401,{message:'Bad credentials'}),
    gitReadImpl:async()=>{reads++;return '';}
  });
  await assert.rejects(control.pollOnce(),/GITHUB_BOOTSTRAP_HTTP_401/);
  assert.equal(reads,0);
  assert.equal(control.status().transport,'github-api');
});

test('empty tokenless inbox is distinguished from failed or unchecked polling',async()=>{
  const control=reliabilityControl({file:stateFile(),system:{},token:'',transportMode:'git-ref',
    gitReadImpl:async()=>'',fetchImpl:async()=>{throw Error('unexpected API');}
  });
  assert.equal(control.status().inboxState,'UNCHECKED');
  await control.pollOnce();
  assert.equal(control.status().inboxState,'GIT_REF_EMPTY');
  assert.equal(control.status().writeback,'local-only');
  assert.ok(control.status().lastSuccessfulPollAt);
});

test('issue listing paginates open owner issues before filtering',async()=>{
  const file=stateFile(),id='pagination-command-001';
  let requests=[],actions=0;
  const issue=reliabilityIssue(906,id);
  const control=reliabilityControl({file,system:{async activate(){actions++;return {state:'READY'};}},fetchImpl:async(url,opts={})=>{
    if(url.includes('/issues?')){
      const page=new URL(url).searchParams.get('page');requests.push(page);
      return response(200,page==='1'?Array.from({length:100},()=>({title:'ordinary issue'})):[issue]);
    }
    if(opts.method==='POST')return response(201,{});
    if(opts.method==='PATCH')return response(200,{});
    throw Error('unexpected request');
  }});
  await control.pollOnce();
  assert.deepEqual(requests,['1','2']);
  assert.equal(actions,1);
});

test('legacy RUNNING receipt is not executed again when upgrading from old journal format',async()=>{
  const file=stateFile(),id='legacy-running-command-001';
  const issue=reliabilityIssue(907,id,{comments:1});
  let actions=0;
  const control=reliabilityControl({file,system:{async activate(){actions++;return {state:'READY'};}},fetchImpl:async(url,opts={})=>{
    if(url.includes('/issues?'))return response(200,[issue]);
    if(url.includes('/comments?'))return response(200,[{user:{login:'Rick84444'},body:
      '<!-- jaco-bootstrap-status:v1 -->\n- command: '+String.fromCharCode(96)+id+String.fromCharCode(96)+'\n- operation: '+String.fromCharCode(96)+'system.activate'+String.fromCharCode(96)+'\n- status: **RUNNING**'}]);
    if(opts.method==='POST')return response(201,{});
    if(opts.method==='PATCH')return response(200,{});
    throw Error('unexpected request');
  }});
  assert.equal((await control.pollOnce()).processed[0].status,'UNKNOWN');
  assert.equal(actions,0);
  assert.equal(readJournal(file,id).state,'UNKNOWN');
});

test('write preflight failure records NOT_DISPATCHED and never activates',async()=>{
  const file=stateFile(),id='preflight-failed-001';let actions=0,posts=0;
  const issue=reliabilityIssue(908,id);
  const control=reliabilityControl({file,system:{async activate(){actions++;}},fetchImpl:async(url,opts={})=>{
    if(url.includes('/issues?'))return response(200,[issue]);
    if(opts.method==='POST')return ++posts===1?response(403,{message:'Forbidden'}):response(201,{});
    if(opts.method==='PATCH')return response(200,{});
    throw Error('unexpected request');
  }});
  assert.equal((await control.pollOnce()).processed[0].status,'NOT_DISPATCHED');
  assert.equal(readJournal(file,id).state,'NOT_DISPATCHED');
  await control.pollOnce();
  assert.equal(actions,0);
});

test('legacy handled IDs are never evicted at 500 entries',async()=>{
  const file=stateFile(), ids=Array.from({length:600},(_,i)=>'legacy-command-'+i);
  writeFileSync(file,JSON.stringify({schema:'jaco.bootstrap-state/v1',handled:ids}));
  const control=reliabilityControl({file,system:{},fetchImpl:async()=>response(200,[])});
  await control.pollOnce();
  assert.equal(JSON.parse(readFileSync(file,'utf8')).handled.length,600);
  assert.equal(readdirSync(file+'.journal').length,0);
});

test('corrupt legacy state fails closed instead of dropping deduplication history',()=>{
  const file=stateFile();writeFileSync(file,'{"handled":');
  assert.throws(()=>reliabilityControl({file,system:{},fetchImpl:async()=>response(200,[])}),/BOOTSTRAP_STATE_UNREADABLE/);
});
