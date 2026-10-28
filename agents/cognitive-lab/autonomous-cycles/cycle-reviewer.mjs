#!/usr/bin/env node
/** Separate reviewer process: executes the candidate, not developer claims. */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const [sourceFile,phaseValue,holdoutValue='no'] = process.argv.slice(2);
const phases=['validation','dedupe','retry','abort','persistence','fencing','permission','receipt','isolation','budgetPersistence','concurrency'];
const phase=Number(phaseValue), holdout=holdoutValue==='yes';
if(!sourceFile || !Number.isInteger(phase) || phase<1 || phase>phases.length)throw new Error('INVALID_REVIEW_SCOPE');
if(!path.isAbsolute(sourceFile)||path.basename(sourceFile)!=='task-engine.mjs')throw new Error('UNTRUSTED_SOURCE_PATH');
const {TaskEngine}=await import(pathToFileURL(sourceFile).href);
const codeHash=createHash('sha256').update(fs.readFileSync(sourceFile)).digest('hex');
const cases=[];
async function check(name,fn){try{const ok=await fn();cases.push({name,passed:ok===true});}catch(e){cases.push({name,passed:false,error:String(e.message).slice(0,150)})}}
const active=i=>i<=phase;
const lease={agentId:'developer',missionId:'m',generation:3,expiresAt:Date.now()+60000};
const opts={agentId:'developer',missionId:'m',lease};
const job=(id,method='GET')=>({id,method});
if(active(1)){
 await check('rejects empty task id',async()=>{const e=new TaskEngine({execute:async()=>({status:200})});try{await e.run({id:'',method:'GET'},opts);return false}catch(x){return x.message==='TASK_INVALID'}});
 await check('rejects malformed method',async()=>{const e=new TaskEngine({execute:async()=>({status:200})});try{await e.run(job('z','REMOVE'),opts);return false}catch(x){return x.message==='TASK_INVALID'}});
}
if(active(2)){
 await check('same job id executes exactly once',async()=>{let n=0;const e=new TaskEngine({execute:async()=>{n++;return{status:200}}});const a=await e.run(job('once'),opts),b=await e.run(job('once'),opts);return n===1&&a.status===200&&b.replayed===true});
 await check('new job id remains executable',async()=>{let n=0;const e=new TaskEngine({execute:async()=>{n++;return{status:200}}});await e.run(job('a'),opts);await e.run(job('b'),opts);return n===2});
}
if(active(3)){
 await check('GET transient 503 retries twice',async()=>{let n=0;const e=new TaskEngine({execute:async()=>({status:++n<3?503:200})});const r=await e.run(job('r1'),{...opts,maxRetries:2});return n===3&&r.status===200&&r.attempts===3});
 await check('POST never retries',async()=>{let n=0;const e=new TaskEngine({execute:async()=>{n++;return{status:503}}});const r=await e.run(job('r2','POST'),{...opts,maxRetries:5});return r.attempts===1&&n===1});
 await check('rejects pathological retry count',async()=>{const e=new TaskEngine({execute:async()=>({status:503})});try{await e.run(job('r3'),{...opts,maxRetries:9999});return false}catch(x){return x.message==='RETRY_BUDGET_INVALID'}});
}
if(active(4)){
 await check('preaborted signal causes zero effects',async()=>{let n=0;const c=new AbortController();c.abort();const e=new TaskEngine({execute:async()=>{n++;return{status:200}}});try{await e.run(job('ab1'),{...opts,signal:c.signal});return false}catch(x){return x.message==='TASK_ABORTED'&&n===0}});
 await check('aborted after first retry stops next effect',async()=>{let n=0;const c=new AbortController();const e=new TaskEngine({execute:async()=>{n++;c.abort();return{status:503}}});try{await e.run(job('ab2'),{...opts,signal:c.signal});return false}catch(x){return x.message==='TASK_ABORTED'&&n===1}});
}
if(active(5)){
 await check('snapshot restores idempotency',async()=>{let n=0;const execute=async()=>{n++;return{status:200}};const e=new TaskEngine({execute});await e.run(job('s1'),opts);const f=TaskEngine.restore(e.snapshot(),{execute});const r=await f.run(job('s1'),opts);return n===1&&r.replayed===true});
 await check('snapshot preserves separate key',async()=>{let n=0;const execute=async()=>{n++;return{status:200}};const e=new TaskEngine({execute});await e.run(job('s2'),opts);const f=TaskEngine.restore(e.snapshot(),{execute});await f.run(job('s3'),opts);return n===2});
}
if(active(6)){
 await check('stale generation cannot write',async()=>{let n=0;const e=new TaskEngine({execute:async()=>{n++;return{status:200}}});await e.run(job('f1'),opts);try{await e.run(job('f2'),{...opts,lease:{...lease,generation:2}});return false}catch(x){return n===1&&x.message==='STALE_LEASE_GENERATION'}});
 await check('future generation can write',async()=>{const e=new TaskEngine({execute:async()=>({status:200})});await e.run(job('f3'),opts);return(await e.run(job('f4'),{...opts,lease:{...lease,generation:4}})).status===200});
}
if(active(7)){
 await check('agent identity mismatch is denied',async()=>{let n=0;const e=new TaskEngine({execute:async()=>{n++;return{status:200}}});try{await e.run(job('p1'),{...opts,agentId:'attacker'});return false}catch(x){return x.message==='CAPABILITY_DENIED'&&n===0}});
 await check('revoked lease is denied',async()=>{const e=new TaskEngine({execute:async()=>({status:200})});try{await e.run(job('p2'),{...opts,lease:{...lease,revoked:true}});return false}catch(x){return x.message==='CAPABILITY_DENIED'}});
 await check('expired lease is denied',async()=>{const e=new TaskEngine({execute:async()=>({status:200})});try{await e.run(job('p3'),{...opts,lease:{...lease,expiresAt:1}});return false}catch(x){return x.message==='CAPABILITY_DENIED'}});
}
if(active(8)){
 await check('receipt exists and verifies',async()=>{const e=new TaskEngine({execute:async()=>({status:200})});const r=await e.run(job('e1'),opts);return TaskEngine.verifyReceipt(r.receipt)===true});
 await check('receipt tampering is rejected',async()=>{const e=new TaskEngine({execute:async()=>({status:200})});const r=await e.run(job('e2'),opts);return TaskEngine.verifyReceipt({...r.receipt,status:503})===false});
}
if(active(9)){
 await check('same id in two missions executes twice',async()=>{
   let n=0;const e=new TaskEngine({execute:async()=>({status:++n===1?200:201})});
   const first=await e.run(job('shared'),opts);
   const second=await e.run(job('shared'),{agentId:'bob',missionId:'missionB',lease:{agentId:'bob',missionId:'missionB',generation:3,expiresAt:Date.now()+10000}});
   return n===2&&first.status===200&&second.status===201&&second.replayed!==true;
 });
 await check('same id for different methods rejects conflicting request',async()=>{
   let n=0;const e=new TaskEngine({execute:async()=>{n++;return {status:200}}});
   await e.run(job('collision','GET'),opts);
   try{await e.run(job('collision','POST'),opts);return false}catch(x){return x.message==='TASK_ID_COLLISION'&&n===1}
 });
 await check('same id in different agent identity executes twice',async()=>{
   let n=0;const e=new TaskEngine({execute:async()=>{n++;return {status:200}}});
   await e.run(job('shared2'),opts);
   const other={agentId:'worker',missionId:'m',lease:{...lease,agentId:'worker'}};
   const result=await e.run(job('shared2'),other);
   return n===2&&result.replayed!==true;
 });
}
if(active(10)){
 await check('restart does not reset external call budget',async()=>{
   let n=0;const exec=async()=>{n++;return {status:200}};
   const before=new TaskEngine({execute:exec,maxCalls:1});
   await before.run(job('budget-start'),opts);
   const resumed=TaskEngine.restore(before.snapshot(),{execute:exec,maxCalls:1});
   try{await resumed.run(job('budget-second'),opts);return false}
   catch(e){return e.message==='EXECUTION_BUDGET_EXCEEDED'&&n===1}
 });
 await check('replay after restart does not use remaining budget',async()=>{
   let n=0;const exec=async()=>{n++;return {status:200}};
   const before=new TaskEngine({execute:exec,maxCalls:1});
   await before.run(job('budget-replay'),opts);
   const resumed=TaskEngine.restore(before.snapshot(),{execute:exec,maxCalls:1});
   const replay=await resumed.run(job('budget-replay'),opts);
   return replay.replayed===true&&n===1;
 });
}
if(active(11)){
 await check('two simultaneous same-id writes perform one side effect',async()=>{
   let n=0;const e=new TaskEngine({execute:async()=>{n++;await new Promise(r=>setTimeout(r,5));return {status:200}}});
   const [a,b]=await Promise.all([e.run(job('parallel','POST'),opts),e.run(job('parallel','POST'),opts)]);
   return n===1&&a.status===200&&b.status===200;
 });
 await check('concurrent separate IDs remain independent',async()=>{
   let n=0;const e=new TaskEngine({execute:async()=>{n++;await new Promise(r=>setTimeout(r,3));return {status:200}}});
   await Promise.all([e.run(job('para-a'),opts),e.run(job('para-b'),opts)]);
   return n===2;
 });
 await check('concurrent method collision must fail closed',async()=>{
   let n=0;const e=new TaskEngine({execute:async()=>{n++;await new Promise(r=>setTimeout(r,5));return {status:200}}});
   const [first,second]=await Promise.allSettled([e.run(job('sharedmethod','GET'),opts),e.run(job('sharedmethod','POST'),opts)]);
   return n===1&&first.status==='fulfilled'&&second.status==='rejected'&&second.reason.message==='TASK_ID_COLLISION';
 });
}
if(holdout){
 await check('holdout 429 preserves capped 1000ms delay',async()=>{let n=0;const delays=[];const e=new TaskEngine({execute:async()=>({status:++n===1?429:200})});const r=await e.run(job('holdout-rate'),{...opts,sleep:async ms=>delays.push(ms)});return r.status===200&&n===2&&delays[0]===1000});
 await check('holdout budget blocks second side effect',async()=>{let n=0;const e=new TaskEngine({execute:async()=>{n++;return{status:200}},maxCalls:1});await e.run(job('holdout-budget'),opts);try{await e.run(job('holdout-budget-2'),opts);return false}catch(x){return n===1&&x.message==='EXECUTION_BUDGET_EXCEEDED'}});
}
const report={schema:'jaco.autonomous-cycles-review/v1',phase,holdout,codeHash,passed:cases.filter(c=>c.passed).length,total:cases.length,accepted:cases.every(c=>c.passed),cases};
process.stdout.write(JSON.stringify(report)+'\n');process.exitCode=report.accepted?0:2;
