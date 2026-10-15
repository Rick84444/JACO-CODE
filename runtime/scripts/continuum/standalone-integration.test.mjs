#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-continuum-standalone-'));
const token='integration-continuum-token', sentinelBearer='integration-sentinel-token', a2aBearer='integration-a2a-token';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
async function freePort(){return await new Promise((resolve,reject)=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p))})});}
const corePort=await freePort(),sentinelPort=await freePort(),a2aPort=await freePort();
const children=[];
function start(file,cwd,env){const c=spawn(process.execPath,[file],{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});children.push(c);return c;}
async function wait(url,headers={}){for(let i=0;i<80;i++){try{const r=await fetch(url,{headers,signal:AbortSignal.timeout(500)});if(r.ok)return await r.json()}catch{}await sleep(50)}throw new Error(`timeout waiting for ${url}`)}
const headers={'x-jaco-continuum-token':token};
async function j(pathname,options={}){const r=await fetch(`http://127.0.0.1:${corePort}${pathname}`,{...options,headers:{...headers,...(options.body?{'content-type':'application/json'}:{}),...(options.headers||{})}});const x=await r.json();if(!r.ok)throw new Error(`${r.status}:${JSON.stringify(x)}`);return x;}
function stop(c){if(c&&!c.killed)c.kill('SIGTERM')}
try{
 let core=start('src/server/continuum/standalone-server.mjs',root,{JACO_CONTINUUM_WORKSPACE:work,JACO_CONTINUUM_HOST:'127.0.0.1',JACO_CONTINUUM_PORT:String(corePort),JACO_CONTINUUM_TOKEN:token,JACO_SUBSTRATE_URL:'http://127.0.0.1:1',JACO_CONTINUUM_AUTOSTART:'1'});
 const sentinel=start('src/continuum-sentinel.mjs',path.join(root,'gateway'),{JACO_CONTINUUM_SENTINEL_HOST:'127.0.0.1',JACO_CONTINUUM_SENTINEL_PORT:String(sentinelPort),JACO_CONTINUUM_URL:`http://127.0.0.1:${corePort}`,JACO_CONTINUUM_TOKEN:token,JACO_CONTINUUM_SENTINEL_BEARER:sentinelBearer});
 const a2a=start('src/a2a-server.mjs',path.join(root,'gateway'),{JACO_A2A_STATE_DIR:path.join(work,'a2a'),JACO_A2A_HOST:'127.0.0.1',JACO_A2A_PORT:String(a2aPort),JACO_BASE_URL:`http://127.0.0.1:${corePort}`,JACO_CONTINUUM_TOKEN:token,JACO_A2A_BEARER:a2aBearer});
 const identity=await wait(`http://127.0.0.1:${corePort}/api/runtime/identity`);assert.equal(identity.releaseId,'runtime');
 await wait(`http://127.0.0.1:${sentinelPort}/health`);await wait(`http://127.0.0.1:${a2aPort}/health`);
 let status=(await j('/api/continuum/status')).status;assert.equal(status.eventIntegrity.valid,true);assert.equal(status.scheduler.enabled,true);assert.equal(status.economic.policy.cloudEnabled,false);assert.equal(status.substrate.reachable,false);
 const mission=(await j('/api/continuum/missions',{method:'POST',body:JSON.stringify({objective:'standalone persistence proof',operatorFinalSignoff:true})})).mission;
 await j(`/api/continuum/missions/${mission.id}/transition`,{method:'POST',body:JSON.stringify({state:'ACTIVE',reason:'integration test'})});
 const rpc=await fetch(`http://127.0.0.1:${a2aPort}/`,{method:'POST',headers:{authorization:`Bearer ${a2aBearer}`,'content-type':'application/json','A2A-Version':'1.0'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'SendMessage',params:{message:{messageId:'integration-a2a',role:'ROLE_USER',parts:[{text:'bounded inbound work'}]},configuration:{returnImmediately:true}}})}).then(r=>r.json());assert.equal(rpc.result.task.status.state,'TASK_STATE_SUBMITTED');
 const tasks=(await j('/api/continuum/hub/tasks')).tasks;const hubTaskId=rpc.result?.task?.metadata?.hubTaskId;assert.ok(hubTaskId,'A2A response names the hub task');/* the scheduler may already have claimed it, so any non-failed state counts */assert.ok(tasks.some(t=>t.kind==='A2A_INBOUND'&&t.id===hubTaskId&&t.status!=='FAILED'));
 const estop=await fetch(`http://127.0.0.1:${sentinelPort}/api/operator/emergency-stop`,{method:'POST',headers:{authorization:`Bearer ${sentinelBearer}`}}).then(r=>r.json());assert.equal(estop.state.emergencyLatched,true);
 status=(await j('/api/continuum/status')).status;assert.equal(status.operator.emergencyLatched,true);assert.equal(status.scheduler.enabled,false);
 await j('/api/continuum/operator/reset-emergency',{method:'POST',body:JSON.stringify({reason:'integration reset'})});await j('/api/continuum/operator/resume',{method:'POST',body:JSON.stringify({reason:'integration resume'})});await j('/api/continuum/scheduler/start',{method:'POST',body:'{}'});
 stop(core);await new Promise(r=>core.once('exit',r));children.splice(children.indexOf(core),1);
 core=start('src/server/continuum/standalone-server.mjs',root,{JACO_CONTINUUM_WORKSPACE:work,JACO_CONTINUUM_HOST:'127.0.0.1',JACO_CONTINUUM_PORT:String(corePort),JACO_CONTINUUM_TOKEN:token,JACO_SUBSTRATE_URL:'http://127.0.0.1:1'});await wait(`http://127.0.0.1:${corePort}/health`);
 status=(await j('/api/continuum/status')).status;assert.equal(status.scheduler.enabled,true);assert.equal(status.scheduler.timerActive,true);assert.equal(status.counts.activeMissions,1);assert.equal(status.eventIntegrity.valid,true);
 const raw=fs.readFileSync(path.join(work,'.jaco','continuum','ledger','events.jsonl'),'utf8');assert.equal(raw.includes(token),false);
 console.log('CONTINUUM_STANDALONE_INTEGRATION: PASS (identity/state/A2A/Sentinel/e-stop/restart/integrity)');
} finally {for(const c of children)stop(c);await sleep(100);fs.rmSync(work,{recursive:true,force:true});}
