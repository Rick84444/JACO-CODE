import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { processMissionTurn } from '../../agents/lib/mission-client.mjs';
import { normalizeCodingContract, validateCodingTask } from '../../agents/lib/coding-contract.mjs';
import { createCodingWorkspace } from '../../agents/lib/coding-workspace.mjs';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { NovaMissionControl } from '../../runtime/src/server/connected/novaMissionControl.mjs';
const { webFetchGet, assertPlanTaskAllowed } = await import('../../agents/hands-off-agent.mjs');
const contract = () => normalizeCodingContract({objective:'Inspect scoped code',scope:{allowed:['src/feature/**']},acceptance:['Report scoped code'],verification:{tests_required:false},budget:{max_duration_ms:1000}});

test('root discovery exposes only scope ancestors and keeps protected files inaccessible', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nova-inventory-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const name of ['src/feature','src/private','other'])fs.mkdirSync(path.join(root,name),{recursive:true});
  fs.writeFileSync(path.join(root,'src/feature/a.mjs'),'export const a=1;');
  fs.writeFileSync(path.join(root,'.env'),'private');
  const w=createCodingWorkspace({root});const c=contract();
  assert.deepEqual(w.inspect(c).entries,[{name:'src',type:'dir'}]);
  const r=await w.execute({type:'repo-list',data:{path:'src'}},c);
  assert.deepEqual(r.entries,[{name:'feature',type:'dir'}]);
  for(const p of ['src/private/a.mjs','.env'])assert.throws(()=>validateCodingTask({type:'repo-read',data:{path:p}},c),/SCOPE_DENIED/);
  assert.throws(()=>validateCodingTask({type:'repo-list',data:{path:'src/**'}},c),/GLOB_NOT_SUPPORTED/);
});

test('expired coding budget blocks durably before a planner can be called', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nova-preflight-'));const bus=new DurableMissionBus(root);
  t.after(()=>{bus.close();fs.rmSync(root,{recursive:true,force:true});});
  let now=10000;const control=new NovaMissionControl(bus,{now:()=>now,allowedTasks:['repo-list']});
  const m=control.create({goal:'Inspect scoped code',idempotencyKey:'preflight',contract:contract()});
  const {token}=control.claim(m.id,'nova');control.release(m.id,{owner:'nova',token});now+=1001;
  assert.throws(()=>control.claim(m.id,'nova'),/DURATION_EXCEEDED/);
  assert.equal(control.get(m.id).status,'BLOCKED');
  assert.equal(bus.lastMissionEvent(m.id,'NOVA_PREFLIGHT_BLOCKED').payload.beforePlanning,true);
  assert.equal(control.current(),null);
});

test('a real HTTP 404 is observed successfully, but does not satisfy an explicit 200 expectation',async t=>{
  const server=http.createServer((_req,res)=>{res.writeHead(404,{'content-type':'text/plain'});res.end('missing');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const url=`http://127.0.0.1:${server.address().port}/missing`;
  const observed=await webFetchGet(url);assert.equal(observed.ok,true);assert.equal(observed.status,404);assert.equal(observed.httpOk,false);
  const expected=await webFetchGet(url,fetch,{status:200});assert.equal(expected.ok,false);assert.equal(expected.error,'WEB_FETCH_EXPECTATION_FAILED');
});

test('an unchanged deterministic failed read is rejected before dispatch',()=>{
  const mission={allowedTasks:['repo-read'],receipts:[{type:'repo-read',ok:false,error:'ENOENT',input:{path:'missing.mjs'}}]};
  assert.throws(()=>assertPlanTaskAllowed({task:{type:'repo-read',data:{path:'missing.mjs'}}},mission),/UNCHANGED_FAILED_READ/);
  assert.doesNotThrow(()=>assertPlanTaskAllowed({task:{type:'repo-read',data:{path:'present.mjs'}}},mission));
});

test('activity follows planning and execution and returns ready after a persisted receipt',async()=>{
  const activity=[]; const mission={id:'activity-mission',status:'ACTIVE'};
  const client={current:async()=>mission,claim:async()=>({mission,token:'lease'}),begin:async()=>({id:'action',type:'health-check'}),finish:async()=>mission};
  await processMissionTurn({client,owner:'nova',plan:async()=>({task:{type:'health-check',data:{}}}),execute:async()=>({ok:true}),onActivity:async value=>activity.push(value)});
  assert.deepEqual(activity,[{phase:'PLANNING',missionId:mission.id},{phase:'EXECUTING',missionId:mission.id},{phase:'READY',missionId:null}]);
});

test('a failed planner releases its lease and clears activity without executing',async()=>{
  const activity=[];let released=false;const mission={id:'failed-plan',status:'ACTIVE'};
  const client={current:async()=>mission,claim:async()=>({mission,token:'lease'}),release:async()=>{released=true;}};
  await assert.rejects(processMissionTurn({client,owner:'nova',plan:async()=>{throw Error('MODEL_FAILED');},execute:async()=>assert.fail('must not execute'),onActivity:async value=>activity.push(value)}),/MODEL_FAILED/);
  assert.equal(released,true);assert.deepEqual(activity.map(v=>v.phase),['PLANNING','READY']);
});

test('240 minute web fetch covers transport and durable action lease',async()=>{const {webFetchTimeoutMs,actionLeaseMs}=await import('../../agents/lib/web-fetch-policy.mjs');const env={JACO_WEB_FETCH_TIMEOUT_MS:'14400000'};assert.equal(webFetchTimeoutMs(env),14400000);assert.equal(actionLeaseMs('web-fetch',env),14430000);assert.equal(actionLeaseMs('repo-read',env),300000);assert.throws(()=>webFetchTimeoutMs({JACO_WEB_FETCH_TIMEOUT_MS:'bad'}),/INVALID/);let options;const result=await webFetchGet('https://example.test',async(_url,o)=>{options=o;return{status:200,ok:true,text:async()=> 'ok'}},{},env);assert.equal(result.ok,true);assert.equal(options.signal.aborted,false);assert.ok(options.dispatcher);});
test('web fetch still aborts at its configured deadline',async()=>{const result=await webFetchGet('https://example.test',async(_url,o)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>resolve({status:200,ok:true,text:async()=> 'late'}),1000);o.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(o.signal.reason)},{once:true});}),{},{JACO_WEB_FETCH_TIMEOUT_MS:'20'});assert.equal(result.ok,false);assert.match(result.error,/timeout/i);});

test('durable web-fetch execution survives the old five-minute deadline',async t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'nova-fetch-lease-'));const bus=new DurableMissionBus(root);const original=process.env.JACO_WEB_FETCH_TIMEOUT_MS;process.env.JACO_WEB_FETCH_TIMEOUT_MS='14400000';t.after(async()=>{if(original===undefined)delete process.env.JACO_WEB_FETCH_TIMEOUT_MS;else process.env.JACO_WEB_FETCH_TIMEOUT_MS=original;bus.close();await fs.promises.rm(root,{recursive:true,force:true});});let clock=1000000;const control=new NovaMissionControl(bus,{allowedTasks:['web-fetch'],now:()=>clock});const m=control.create({goal:'Read slow endpoint',idempotencyKey:'slow-web-lease-test',allowedTasks:['web-fetch']});const {token}=control.claim(m.id,'nova');control.begin(m.id,{owner:'nova',token,task:{type:'web-fetch',data:{url:'https://example.test'}}});clock+=300001;control.recoverExpired();assert.equal(control.get(m.id).phase,'EXECUTING');clock+=14430000;control.recoverExpired();
// A read changes nothing: past its lease it is planned again instead of being held for the operator.
assert.equal(control.get(m.id).phase,'READY');assert.equal(control.get(m.id).status,'ACTIVE');});
