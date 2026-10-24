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
  await request('/api/continuum/evidence/knowledge-proof/verify',{method:'integration test'});
  const verified=await request('/api/continuum/knowledge/retry-knowledge/status',{status:'VERIFIED'});
  assert.equal(verified.data.knowledge.verificationStatus,'VERIFIED');
  const stale=await request('/api/continuum/knowledge/retry-knowledge/status',{status:'STALE',reason:'New repository contract'});
  assert.equal(stale.data.knowledge.verificationStatus,'STALE');
  assert.equal((await request('/api/continuum/knowledge?q=retry')).data.knowledge.length,0);
  assert.equal((await request('/api/continuum/knowledge?q=retry&includeInactive=true')).data.knowledge.length,1);

  const promotedReceipt=await request('/api/continuum/cognition/promotions/receipt',{
    missionId:'mission-http-1',
    actionId:'action-http-1',
    taskType:'android-observe',
    receipt:{
      ok:true,
      verified:true,
      outcomeUnknown:false,
      before:{title:'Settings',targets:10},
      after:{title:'Settings',targets:10},
      result:{receipt:{action_id:'action-http-1',action_type:'observe_screen',success:true,verified:true,before_hash:'before-http',after_hash:'after-http',package_name:'com.android.settings'}},
    },
  });
  assert.equal(promotedReceipt.status,201);
  // A tool's self-attested success is a historical observation, not independent
  // verification of its effect. This contract must agree with effect-evidence tests.
  assert.equal(promotedReceipt.data.evidence.verified,false);
  assert.equal(promotedReceipt.data.evidence.verificationMethod,'durable_nova_tool_attestation');
  assert.equal(promotedReceipt.data.knowledge.verificationStatus,'UNVERIFIED');
  assert.equal(promotedReceipt.data.knowledge.kind,'tool-attested-observation');
  assert.equal(promotedReceipt.data.knowledge.reusable,false);
  const promotedKnowledgeId=promotedReceipt.data.knowledge.id;
  const duplicatePromotion=await request('/api/continuum/cognition/promotions/receipt',{
    missionId:'mission-http-1',
    actionId:'action-http-1',
    taskType:'android-observe',
    receipt:{
      ok:true,
      verified:true,
      outcomeUnknown:false,
      before:{title:'Settings',targets:10},
      after:{title:'Settings',targets:10},
      result:{receipt:{action_id:'action-http-1',action_type:'observe_screen',success:true,verified:true,before_hash:'before-http',after_hash:'after-http',package_name:'com.android.settings'}},
    },
  });
  assert.equal(duplicatePromotion.data.idempotent,true);
  assert.equal(duplicatePromotion.data.knowledge.id,promotedKnowledgeId);

  const rejectedPromotion=await request('/api/continuum/cognition/promotions/receipt',{
    missionId:'mission-http-1',
    actionId:'action-http-2',
    taskType:'android-tap',
    receipt:{ok:true,verified:false,outcomeUnknown:true},
  });
  assert.equal(rejectedPromotion.status,400);

  const decision=await request('/api/continuum/cognition/promotions/decision',{
    claim:'Verified knowledge must never be inferred from unknown execution outcome',
    kind:'helix-architecture-decision',
    evidenceRefs:['knowledge-proof'],
    dependencies:['unknown-outcome-reconciliation'],
    reusable:true,
  });
  assert.equal(decision.status,201);
  assert.equal(decision.data.knowledge.verificationStatus,'VERIFIED');
  assert.equal(decision.data.knowledge.reusable,true);

  const set=(await request('/api/continuum/hypotheses',{problem:'Choose a verified strategy',criteria:[{name:'success',weight:1,direction:'max'}]})).data.set;
  const candidate=(await request(`/api/continuum/hypotheses/${set.id}/candidates`,{label:'failed strategy'})).data.candidate;
  const falsified=await request(`/api/continuum/hypotheses/${set.id}/candidates/${candidate.id}/evaluate`,{status:'FALSIFIED',reason:'Observed failure',evidenceRefs:['knowledge-proof'],metrics:{success:1}});
  assert.equal(falsified.data.candidate.status,'FALSIFIED');
  const selected=await request(`/api/continuum/hypotheses/${set.id}/select`,{candidateId:candidate.id});
  assert.equal(selected.status,400);
  assert.match(selected.data.error.message,/not eligible/);
  assert.equal((await request('/api/continuum/integrity')).data.integrity.valid,true);
  const promotedSearch=(await request('/api/continuum/knowledge?q=historical execution outcome android-observe')).data.knowledge;
  assert.equal(promotedSearch.some(item=>item.id===promotedKnowledgeId),true);
  console.log('COGNITIVE_LIFECYCLE: PASS (knowledge evidence/status/search, receipt/decision promotion, hypothesis falsification, integrity)');
}finally{
  child.kill('SIGTERM');
  await sleep(100);
  fs.rmSync(work,{recursive:true,force:true});
}
