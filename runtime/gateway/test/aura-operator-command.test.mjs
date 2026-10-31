import { JacoCoreClient } from '../src/jaco-client.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { submitAuraAcceptance, safeAuraAcceptanceLines, safeAuraNotReadyLines, waitForAuraReadiness, AURA_ACCEPTANCE_GOAL } from '../src/aura-operator-command.mjs';

test('Aura sends canonical fixed operator goal over local Core and never targets Nova API',async()=>{
  const calls=[];
  const core={
    baseUrl:'http://127.0.0.1:3000',
    async request(path, options) {
      calls.push({path,options});
      return {success:true,schema:'jaco.operator-goal/v1',goal:{id:'goal-live-123'},
        development_cycle:{private:'SECRET_CYCLE'}};
    },
  };
  const result=await submitAuraAcceptance(core);
  assert.equal(result.status,'ACCEPTED');
  assert.equal(result.goalId,'goal-live-123');
  assert.equal(result.execution,'NOT_VERIFIED');
  assert.equal(calls.length,1);
  assert.equal(calls[0].path,'/api/aura/workbench/start-goal');
  assert.equal(calls[0].options.method,'POST');
  const body=JSON.parse(calls[0].options.body);
  assert.equal(body.goal,AURA_ACCEPTANCE_GOAL);
  assert.equal(body.horizon,'short');
  assert.match(body.goal,/Aura: assess/);
  assert.doesNotMatch(JSON.stringify(calls),/\/api\/connected\/nova\/missions|\/api\/connected\/goals/);
  const lines=safeAuraAcceptanceLines(result).join('\n');
  assert.match(lines,/goal-live-123/);
  assert.match(lines,/NOT_VERIFIED/);
  assert.doesNotMatch(lines,/SECRET_CYCLE|Aura: assess/);
});

test('remote or credentialed Core URLs cannot receive operator control',async()=>{
  for(const baseUrl of ['https://api.example.com','http://10.0.0.2:3000',
    'http://127.0.0.1:3000?token=secret',
    'http://operator:password@localhost:3000']) {
    let called=false;
    await assert.rejects(submitAuraAcceptance({baseUrl,
      request:async()=>{called=true;return {}}}),/AURA_OPERATOR_LOOPBACK_REQUIRED/);
    assert.equal(called,false);
  }
});

test('Core failure or missing real goal ID can never be reported as accepted',async()=>{
  for(const reply of [{success:false,schema:'jaco.operator-goal/v1',goal:{id:'a'}},
    {success:true,schema:'jaco.operator-goal/v1',goal:{}},
    {success:true,schema:'jaco.operator-goal/v1',goal:{id:'a\nsecret'}},
    {success:true,schema:'jaco.connected-goal/v1',goal:{id:'safe'}}]) {
    await assert.rejects(submitAuraAcceptance({baseUrl:'http://localhost:3000',request:async()=>reply}),
      /AURA_CANONICAL_GOAL_RECEIPT_INVALID/);
  }
});

test('public projection is fully bounded and never prints source or private details',()=>{
  const value={schema:'jaco.aura-operator-command/v1',status:'ACCEPTED',
    goalId:'\x1b[31mprivate',goal:'OPERATOR_SECRET',stderr:'C:/Users/secret'};
  const result=safeAuraAcceptanceLines(value).join('\n');
  assert.match(result,/UNVERIFIED/);
  assert.doesNotMatch(result,/SECRET|Users|private|31m/);
});

test('the only first-command prompt is observation-oriented and disallows mutations',()=>{
  assert.match(AURA_ACCEPTANCE_GOAL,/observation-only/);
  assert.match(AURA_ACCEPTANCE_GOAL,/do not change files/);
  assert.match(AURA_ACCEPTANCE_GOAL,/Do not create a parallel Nova/);
});

test('MCP goal routes into canonical Aura start-goal in single-operator mode',async()=>{
  const original=process.env.JACO_AURA_ONLY_OPERATOR;
  const calls=[];
  process.env.JACO_AURA_ONLY_OPERATOR='1';
  try {
    const core=new JacoCoreClient({baseUrl:'http://127.0.0.1:3000',token:'test-credential',
      fetchImpl:async(url,opts)=>{
        calls.push({url,opts});
        return {ok:true,status:201,text:async()=>JSON.stringify({success:true,
          schema:'jaco.operator-goal/v1',goal:{id:'goal-real'}})};
      }});
    const result=await core.seerGoal({goal:'Inspect local system',horizon:'short'});
    assert.equal(result.goal.id,'goal-real');
    assert.equal(calls.length,1);
    assert.equal(new URL(calls[0].url).pathname,'/api/aura/workbench/start-goal');
    assert.deepEqual(JSON.parse(calls[0].opts.body),{goal:'Inspect local system',horizon:'short'});
    assert.equal(calls[0].opts.headers['x-gateway-token'],'test-credential');
    assert.throws(()=>core.seerGoal({goal:''}),/AURA_GOAL_REQUIRED_OR_TOO_LONG/);
    assert.equal(calls.length,1);
  }finally{
    if(original===undefined)delete process.env.JACO_AURA_ONLY_OPERATOR;
    else process.env.JACO_AURA_ONLY_OPERATOR=original;
  }
});

test('Windows Aura-only profile retires direct operator bypass routes but not Nova executor',()=>{
  const root=resolve(import.meta.dirname,'../../..');
  const server=readFileSync(resolve(root,'runtime/server.ts'),'utf8');
  const connected=readFileSync(resolve(root,'runtime/src/server/connected/connectedRuntime.mjs'),'utf8');
  const nova=readFileSync(resolve(root,'agents/hands-off-agent.mjs'),'utf8');
  const win=readFileSync(resolve(root,'runtime/bin/windows-local-hub-env.mjs'),'utf8');
  assert.match(server,/app\.post\('\/api\/aura\/missions', requireLocalUi/);
  assert.match(server,/AURA_ONLY_USE_START_GOAL/);
  assert.match(connected,/AURA_ONLY_USE_START_GOAL/);
  assert.match(nova,/JACO_AURA_ONLY_OPERATOR === '1'/);
  assert.match(win,/JACO_AURA_ONLY_OPERATOR = '1'/);
  assert.match(nova,/new MissionClient\(CONFIG.runtimeUrl/);
});

const readinessReceipt = (seer = { required: true, reachable: true, authenticated: true }) =>
  ({ success: true, schema: 'jaco.aura-readiness/v1', ready: true, core: { reachable: true, authenticated: true }, seer });
const fakeClock = () => { let t = 0; return { now: () => t, sleep: async ms => { t += ms; } }; };

test('cold start: readiness waits for Core and SEER before reporting ready', async () => {
  const replies = [
    () => { throw new Error('JACO_CORE_UNAVAILABLE: fetch failed'); },
    () => readinessReceipt({ required: true, reachable: false, authenticated: false }),
    () => readinessReceipt({ required: true, reachable: true, authenticated: false }),
    () => readinessReceipt(),
  ];
  const paths = [];
  const core = { baseUrl: 'http://127.0.0.1:3000', async request(path, options) {
    paths.push([path, options.method]); return replies[paths.length - 1]();
  } };
  const result = await waitForAuraReadiness(core, { timeoutMs: 60000, intervalMs: 3000, ...fakeClock() });
  assert.deepEqual(result, { ready: true, attempts: 4 });
  assert.ok(paths.every(([path, method]) => path === '/api/aura/workbench/readiness' && method === 'GET'));
});

test('readiness timeout is NOT_READY with a bounded, enumerated blocker', async () => {
  let calls = 0;
  const core = { baseUrl: 'http://localhost:3000', async request() { calls++; return readinessReceipt({ required: true, reachable: true, authenticated: false }); } };
  const result = await waitForAuraReadiness(core, { timeoutMs: 9000, intervalMs: 3000, ...fakeClock() });
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'SEER_AUTH_REJECTED');
  assert.equal(calls, 4);
  const lines = safeAuraNotReadyLines({ reason: 'C:/Users/secret' }).join('\n');
  assert.match(lines, /NOT_READY/);
  assert.match(lines, /Blocker: `UNVERIFIED`/);
  assert.doesNotMatch(lines, /secret/);
});

test('readiness classifies auth rejection, missing probe and forged receipts; Lite needs no SEER', async () => {
  const run = reply => waitForAuraReadiness({ baseUrl: 'http://127.0.0.1:3000', async request() { return reply(); } }, { timeoutMs: 0, ...fakeClock() });
  assert.equal((await run(() => { throw new Error('JACO_CORE_HTTP_401: OPERATOR_AUTH_REQUIRED'); })).reason, 'CORE_AUTH_REJECTED');
  assert.equal((await run(() => { throw new Error('JACO_CORE_HTTP_404: NOT_FOUND'); })).reason, 'READINESS_PROBE_UNAVAILABLE');
  assert.equal((await run(() => ({ success: true, schema: 'jaco.other/v1' }))).reason, 'READINESS_RECEIPT_INVALID');
  assert.equal((await run(() => readinessReceipt({ required: false }))).ready, true);
  await assert.rejects(waitForAuraReadiness({ baseUrl: 'http://10.0.0.2:3000', request: async () => readinessReceipt() }), /AURA_OPERATOR_LOOPBACK_REQUIRED/);
});
