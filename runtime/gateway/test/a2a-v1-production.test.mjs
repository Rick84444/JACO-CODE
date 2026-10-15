#!/usr/bin/env node
// End-to-end: official A2A v1 SDK server against a real standalone Continuum runtime (temp workspace).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const gateway=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.resolve(gateway,'..');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-a2a-v1-'));
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
const coreToken='a2a-v1-continuum-token',tokenA='peer-a-token-0123456789',tokenB='peer-b-token-9876543210';
const sha=(v)=>crypto.createHash('sha256').update(v).digest('hex');
const corePort=await freePort(),a2aPort=await freePort();
const children=new Set();

function start(file,cwd,env){const c=spawn(process.execPath,[file],{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});c.log='';c.stdout.on('data',d=>c.log+=d);c.stderr.on('data',d=>c.log+=d);c.exited=new Promise(r=>c.once('exit',r));children.add(c);return c;}
async function stop(c){c.kill();await c.exited;children.delete(c);}
async function waitFor(url){for(let i=0;i<120;i++){try{const r=await fetch(url);if(r.ok)return r.json();}catch{}await sleep(50);}throw new Error(`timeout waiting for ${url}`);}
async function until(fn,ms=5000){const end=Date.now()+ms;for(;;){const v=await fn();if(v)return v;if(Date.now()>end)throw new Error('condition not reached');await sleep(50);}}

const startCore=()=>start('src/server/continuum/standalone-server.mjs',root,{JACO_CONTINUUM_WORKSPACE:work,JACO_CONTINUUM_HOST:'127.0.0.1',JACO_CONTINUUM_PORT:String(corePort),JACO_CONTINUUM_TOKEN:coreToken,JACO_SUBSTRATE_URL:'http://127.0.0.1:1'});
const startA2A=()=>start('src/a2a-server.mjs',gateway,{JACO_A2A_HOST:'127.0.0.1',JACO_A2A_PORT:String(a2aPort),JACO_BASE_URL:`http://127.0.0.1:${corePort}`,JACO_CONTINUUM_TOKEN:coreToken,JACO_A2A_STATE_DIR:path.join(work,'a2a'),JACO_A2A_POLL_MS:'50',JACO_A2A_BEARER:'',JACO_A2A_PEERS:JSON.stringify([{principal:'peer-a',tokenSha256:sha(tokenA)},{principal:'peer-b',tokenSha256:sha(tokenB)}])});

async function hub(pathname,{method='GET',body}={}){const r=await fetch(`http://127.0.0.1:${corePort}/api/continuum${pathname}`,{method,headers:{'x-jaco-continuum-token':coreToken,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const data=await r.json();return {status:r.status,data};}
let rpcId=0;
async function rpc(token,method,params,{version='1.0'}={}){const headers={'content-type':'application/json'};if(version)headers['A2A-Version']=version;if(token)headers.authorization=`Bearer ${token}`;const r=await fetch(`http://127.0.0.1:${a2aPort}/`,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params})});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data={raw:text};}return {status:r.status,...data};}
const send=(token,messageId,text,extra={})=>rpc(token,'SendMessage',{message:{messageId,role:'ROLE_USER',parts:[{text}]},configuration:{returnImmediately:true},...extra});

let core=startCore(),a2a=startA2A();
try{
  await waitFor(`http://127.0.0.1:${corePort}/health`);
  const health=await waitFor(`http://127.0.0.1:${a2aPort}/health`);
  assert.equal(health.protocol,'1.0');assert.equal(health.taskStore,'durable-principal-scoped');

  // Discovery: wire-form card, bearer scheme declared, no internal oneof leakage.
  const card=await (await fetch(`http://127.0.0.1:${a2aPort}/.well-known/agent-card.json`)).json();
  assert.equal(card.supportedInterfaces[0].protocolVersion,'1.0');
  assert.equal(card.securitySchemes.jacoBearer.httpAuthSecurityScheme.scheme,'Bearer');
  assert.equal(JSON.stringify(card).includes('$case'),false);

  // Authentication and version negotiation.
  assert.equal((await send(null,'m-anon','no token')).status,401);
  assert.equal((await send('wrong-token','m-wrong','bad token')).status,401);
  const noVersion=await rpc(tokenA,'SendMessage',{message:{messageId:'m-nov',role:'ROLE_USER',parts:[{text:'x'}]}},{version:null});
  assert.ok(noVersion.error,'request without A2A-Version must not be treated as 1.0');

  // Send: task is bound to a durable hub task with scheduler-readable content.
  const first=await send(tokenA,'m-1','bounded inbound work');
  const t1=first.result.task;assert.equal(t1.status.state,'TASK_STATE_SUBMITTED');
  const hubId=t1.metadata.hubTaskId;assert.match(hubId,/^a2a_[0-9a-f]{40}$/);
  const hubTask=(await hub(`/hub/tasks/${hubId}`)).data.task;
  assert.equal(hubTask.kind,'A2A_INBOUND');assert.equal(hubTask.status,'QUEUED');assert.equal(hubTask.payload.message.parts[0].text,'bounded inbound work');assert.equal(hubTask.payload.principalId,'peer-a');

  // Idempotency: retrying the same messageId returns the same task and creates no second execution.
  const retry=await send(tokenA,'m-1','bounded inbound work');
  assert.equal(retry.result.task.id,t1.id);
  assert.equal((await hub('/hub/tasks')).data.tasks.filter(t=>t.payload?.principalId==='peer-a'&&t.payload?.message?.messageId==='m-1').length,1);

  // Principal isolation: another peer cannot see, list or cancel peer A's task, and its own same messageId is a different task.
  assert.equal((await rpc(tokenB,'GetTask',{id:t1.id})).error.code,-32001);
  assert.equal((await rpc(tokenB,'CancelTask',{id:t1.id})).error.code,-32001);
  assert.equal(((await rpc(tokenB,'ListTasks',{})).result.tasks||[]).length,0);
  const bSame=await send(tokenB,'m-1','peer b work');assert.notEqual(bSame.result.task.metadata.hubTaskId,hubId);

  // Completion is reported from real hub evidence, as a receipt artifact.
  await hub('/hub/agents',{method:'POST',body:{id:'test-executor',name:'Test executor',role:'forge',capabilities:['A2A_INBOUND'],tools:[],permissions:[]}});
  assert.equal((await hub(`/hub/tasks/${hubId}/claim`,{method:'POST',body:{agentId:'test-executor'}})).status,200);
  assert.equal((await hub(`/hub/tasks/${hubId}/complete`,{method:'POST',body:{agentId:'test-executor',status:'COMPLETED',evidenceRefs:['ev-test-1']}})).status,200);
  const done=await until(async()=>{const r=await rpc(tokenA,'GetTask',{id:t1.id});return r.result?.status?.state==='TASK_STATE_COMPLETED'?r.result:null;});
  const receipt=done.artifacts.find(a=>a.artifactId===`continuum-receipt-${hubId}`);
  assert.deepEqual(receipt.parts[0].data.evidenceRefs,['ev-test-1']);

  // Cancel with a live execution: A2A reports CANCELED only because the hub cancelled.
  const t2=(await send(tokenA,'m-2','work to cancel')).result.task;
  const canceled=await rpc(tokenA,'CancelTask',{id:t2.id});
  assert.equal(canceled.result.status.state,'TASK_STATE_CANCELED');
  assert.equal((await hub(`/hub/tasks/${t2.metadata.hubTaskId}`)).data.task.status,'CANCELLED');
  // A cancelled hub task cannot later be reported as completed by an agent.
  const late=await hub(`/hub/tasks/${t2.metadata.hubTaskId}/complete`,{method:'POST',body:{agentId:null,status:'COMPLETED',evidenceRefs:['ev-late']}});
  assert.notEqual(late.status,200);

  // Restart of the A2A process: tasks survive, and hub progress made while it was down is reconciled on read.
  const t3=(await send(tokenA,'m-3','finishes while adapter is down')).result.task;
  const t4=(await send(tokenA,'m-4','cancelled after restart')).result.task;
  await stop(a2a);
  await hub(`/hub/tasks/${t3.metadata.hubTaskId}/claim`,{method:'POST',body:{agentId:'test-executor'}});
  await hub(`/hub/tasks/${t3.metadata.hubTaskId}/complete`,{method:'POST',body:{agentId:'test-executor',status:'COMPLETED',evidenceRefs:['ev-test-3']}});
  a2a=startA2A();await waitFor(`http://127.0.0.1:${a2aPort}/health`);
  assert.equal((await rpc(tokenA,'GetTask',{id:t1.id})).result.status.state,'TASK_STATE_COMPLETED');
  const t3After=(await rpc(tokenA,'GetTask',{id:t3.id})).result;
  assert.equal(t3After.status.state,'TASK_STATE_COMPLETED');
  assert.equal(t3After.artifacts[0].parts[0].data.evidenceRefs[0],'ev-test-3');

  // Cancel with no live execution after restart: the store refuses to persist CANCELED unless the hub cancels.
  const c4=await rpc(tokenA,'CancelTask',{id:t4.id});
  assert.equal(c4.result.status.state,'TASK_STATE_CANCELED');
  assert.equal((await hub(`/hub/tasks/${t4.metadata.hubTaskId}`)).data.task.status,'CANCELLED');

  // Retry after restart is still idempotent (durable message index).
  assert.equal((await send(tokenA,'m-3','finishes while adapter is down')).result.task.id,t3.id);

  // Crash window: the hub task exists but the A2A record was never persisted. A retry must reuse the hub execution.
  const t5=(await send(tokenA,'m-5','crash window')).result.task;
  await stop(a2a);
  const storeFile=path.join(work,'a2a','tasks.json');const stored=JSON.parse(fs.readFileSync(storeFile,'utf8'));delete stored.tasks[t5.id];fs.writeFileSync(storeFile,JSON.stringify(stored));
  a2a=startA2A();await waitFor(`http://127.0.0.1:${a2aPort}/health`);
  const t5Retry=(await send(tokenA,'m-5','crash window')).result.task;
  assert.equal(t5Retry.metadata.hubTaskId,t5.metadata.hubTaskId);
  assert.equal((await hub('/hub/tasks')).data.tasks.filter(t=>t.payload?.principalId==='peer-a'&&t.payload?.message?.messageId==='m-5').length,1);

  // Hub idempotency: the same key with different content is a conflict, not a silent second task.
  const keyed={title:'idempotency probe',kind:'A2A_INBOUND',payload:{n:1},requirements:['A2A_INBOUND'],idempotencyKey:'probe-key'};
  const k1=await hub('/hub/tasks',{method:'POST',body:keyed});const k2=await hub('/hub/tasks',{method:'POST',body:keyed});
  assert.equal(k2.data.task.id,k1.data.task.id);
  assert.notEqual((await hub('/hub/tasks',{method:'POST',body:{...keyed,payload:{n:2}}})).status,201);

  console.log('A2A_V1_PRODUCTION: PASS (sdk-card/auth/version/hub-binding/idempotency/principal-isolation/evidence-artifact/cancel-live/cancel-after-restart/restart-reconcile)');
}catch(error){
  for(const c of children)console.error(`--- child log\n${c.log.slice(-2000)}`);
  throw error;
}finally{
  for(const c of [...children])await stop(c);
  fs.rmSync(work,{recursive:true,force:true});
}
