#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-knowledge-lifecycle-'));
const port=await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(error=>error?reject(error):resolve(value));});});
const token='knowledge-lifecycle-test-token';
const child=spawn(process.execPath,['src/server/continuum/standalone-server.mjs'],{cwd:root,env:{...process.env,JACO_CONTINUUM_WORKSPACE:work,JACO_CONTINUUM_HOST:'127.0.0.1',JACO_CONTINUUM_PORT:String(port),JACO_CONTINUUM_TOKEN:token,JACO_SUBSTRATE_URL:'http://127.0.0.1:1'},stdio:['ignore','pipe','pipe']});
let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk.toString();});
const base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function request(route,body){const response=await fetch(`${base}${route}`,{method:body===undefined?'GET':'POST',headers:{'x-jaco-continuum-token':token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};}

try{
  let ready=false;
  for(let attempt=0;attempt<100;attempt++){
    if(child.exitCode!==null)throw new Error(`Continuum exited: ${stderr}`);
    try{const response=await fetch(`${base}/health`,{signal:AbortSignal.timeout(500)});if(response.ok){ready=true;break;}}catch{}
    await sleep(50);
  }
  if(!ready)throw new Error(`Continuum did not start: ${stderr}`);
  const pending=await request('/api/continuum/evidence',{id:'knowledge-proof',kind:'test',claim:'Observed retry outcome'});
  assert.equal(pending.status,201);
  const rejected=await request('/api/continuum/knowledge',{id:'retry-knowledge',purpose:'retry policy',evidenceRefs:['knowledge-proof'],verificationStatus:'VERIFIED'});
  assert.equal(rejected.status,400);
  const created=await request('/api/continuum/knowledge',{id:'retry-knowledge',purpose:'retry policy',evidenceRefs:['knowledge-proof']});
  assert.equal(created.data.knowledge.verificationStatus,'UNVERIFIED');
  const refused=await request('/api/continuum/evidence/knowledge-proof/verify',{method:'I tested it'});
  assert.equal(refused.status,400);
  assert.match(refused.data.error.message,/EVIDENCE_INDEPENDENT_VERIFIER_REQUIRED/);
  const rejectedStatus=await request('/api/continuum/knowledge/retry-knowledge/status',{status:'VERIFIED'});
  assert.equal(rejectedStatus.status,400);
  assert.match(rejectedStatus.data.error.message,/not verified/);
  const stillPending=await request('/api/continuum/evidence?verified=false');
  assert.equal(stillPending.data.evidence.some(item=>item.id==='knowledge-proof'),true);
  const promotedReceipt=await request('/api/continuum/cognition/promotions/receipt',{
    missionId:'mission-http-1',actionId:'action-http-1',taskType:'android-observe',
    receipt:{ok:true,verified:true,outcomeUnknown:false,
      before:{title:'Settings',targets:10},after:{title:'Settings',targets:10},
      result:{receipt:{action_id:'action-http-1',action_type:'observe_screen',success:true,
        verified:true,before_hash:'before-http',after_hash:'after-http',package_name:'com.android.settings'}}},
  });
  assert.equal(promotedReceipt.status,201);
  assert.equal(promotedReceipt.data.evidence.verified,false);
  assert.equal(promotedReceipt.data.evidence.kind,'nova-action-receipt');
  assert.equal(promotedReceipt.data.knowledge.verificationStatus,'UNVERIFIED');
  assert.equal(promotedReceipt.data.knowledge.reusable,false);
  assert.equal(promotedReceipt.data.knowledge.kind,'tool-attested-observation');
  assert.deepEqual(promotedReceipt.data.knowledge.evidenceRefs,[promotedReceipt.data.evidence.id]);
  const rejectedDecision=await request('/api/continuum/cognition/promotions/decision',{
    claim:'unsupported knowledge',kind:'helix-architecture-decision',evidenceRefs:['knowledge-proof'],
    dependencies:[],reusable:true,
  });
  assert.equal(rejectedDecision.status,400);
  const set=(await request('/api/continuum/hypotheses',{problem:'Evidence gate',criteria:[{name:'success',weight:1,direction:'max'}]})).data.set;
  const candidate=(await request(`/api/continuum/hypotheses/${set.id}/candidates`,{label:'unproven strategy'})).data.candidate;
  const attempt=await request(`/api/continuum/hypotheses/${set.id}/candidates/${candidate.id}/evaluate`,{
    status:'VERIFIED',evidenceRefs:['knowledge-proof'],metrics:{success:1}});
  assert.equal(attempt.status,400);
  assert.equal((await request('/api/continuum/integrity')).data.integrity.valid,true);
  console.log('COGNITIVE_LIFECYCLE_STRICT: PASS (API forgery refusal, external proof denial, provisional receipt, knowledge and hypothesis gates, integrity)');
}finally{
  child.kill('SIGTERM');
  await sleep(100);
  fs.rmSync(work,{recursive:true,force:true});
}
