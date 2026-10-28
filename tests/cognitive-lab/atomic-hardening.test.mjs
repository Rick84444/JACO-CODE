import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EvidenceLedger } from '../../runtime/src/server/continuum/evidenceLedger.mjs';
import { ExecutionLeaseManager } from '../../runtime/src/server/continuum/leaseManager.mjs';
import { CognitiveProgressGovernor } from '../../agents/lib/cognitive-progress.mjs';
import { runCognitiveLab, inspectCognitiveLab, readJournal } from '../../agents/lib/cognitive-lab.mjs';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(),'jaco-hardening-'));
const withTmp = async callback => {const root=tmp();try{return await callback(root)}finally{fs.rmSync(root,{recursive:true,force:true})}};
const operator={assertExecutionAllowed(){}};
const goodHash='f'.repeat(64);

test('E-01 external verified flag is never honored',()=>withTmp(root=>{
  const ledger=new EvidenceLedger(root);
  const ev=ledger.record({kind:'review-validation',verified:true,verificationMethod:'I ran tests',claim:'all passed'});
  assert.equal(ev.verified,false);
  assert.throws(()=>ledger.assertRefs([ev.id]),/not verified/);
}));

test('E-02 direct verify cannot forge an approval',()=>withTmp(root=>{
  const ledger=new EvidenceLedger(root);
  const ev=ledger.record({claim:'asserted'});
  assert.throws(()=>ledger.verify(ev.id,{method:'I say so',actor:'developer-agent'}),/INDEPENDENT_VERIFIER_REQUIRED/);
  assert.equal(ledger.get(ev.id).verified,false);
}));

test('trusted internal observation has signed content and tamper is rejected',()=>withTmp(root=>{
  const ledger=new EvidenceLedger(root);
  const ev=ledger.recordInternal({kind:'system-observation',claim:'observed',verified:true,verificationMethod:'local bounded process',data:{exitCode:0}});
  assert.equal(ledger.get(ev.id).verified,true);
  const file=path.join(root,'evidence',`${ev.id}.json`);
  const changed=JSON.parse(fs.readFileSync(file,'utf8'));
  changed.data.exitCode=17;
  fs.writeFileSync(file,JSON.stringify(changed));
  assert.equal(ledger.get(ev.id).verified,false);
  assert.throws(()=>ledger.assertRefs([ev.id]),/not verified/);
}));

test('legacy unsigned verification is not trusted by upgraded reader',()=>withTmp(root=>{
  const ledger=new EvidenceLedger(root);
  const id='legacy-claim';
  fs.writeFileSync(path.join(root,'evidence',`${id}.json`),JSON.stringify({id,verified:true,claim:'claimed'}));
  assert.equal(ledger.get(id).verified,false);
}));

test('L-01 bound identity missing fails closed for authorize and consume',()=>withTmp(root=>{
  const lease=new ExecutionLeaseManager(root,null,operator,null);
  const l=lease.issue({agentId:'developer-agent',missionId:'mission-x',allowedActions:['write'],maxActions:2});
  assert.throws(()=>lease.authorize(l.id,{action:'write'}),/LEASE_AGENT_ID_REQUIRED/);
  assert.throws(()=>lease.authorize(l.id,{action:'write',agentId:'developer-agent'}),/LEASE_MISSION_ID_REQUIRED/);
  assert.throws(()=>lease.consume(l.id,{action:'write'}),/LEASE_AGENT_ID_REQUIRED/);
  assert.throws(()=>lease.authorize(l.id,{action:'write',agentId:'reviewer-agent',missionId:'mission-x'}),/LEASE_AGENT_MISMATCH/);
  assert.equal(lease.authorize(l.id,{action:'write',agentId:'developer-agent',missionId:'mission-x'}).allowed,true);
}));

test('progress governor detects duplicate work and no-progress branches',()=>{
  const g=new CognitiveProgressGovernor({maxSteps:4,maxStalls:1});
  g.before('candidate-a');assert.equal(g.observe('candidate-a',{passed:4,total:8,codeHash:goodHash}).improved,true);
  assert.throws(()=>g.before('candidate-a'),/PROGRESS_REPEAT/);
  g.before('candidate-b');assert.equal(g.observe('candidate-b',{passed:4,total:8,codeHash:goodHash}).improved,false);
  g.before('candidate-c');assert.throws(()=>g.observe('candidate-c',{passed:2,total:8,codeHash:goodHash}),/PROGRESS_NO_IMPROVEMENT/);
});

test('signed reviewer proof controls memory reuse in two independent runs',()=>withTmp(async root=>{
  const first=await runCognitiveLab(root);
  assert.equal(first.attempts.length,2);
  assert.equal(first.leaseBound,true);
  assert.equal(first.progressGoverned,true);
  assert.equal(first.attempts[0].progress.bestPassed,4);
  assert.equal(first.attempts[1].progress.bestPassed,8);
  const second=await runCognitiveLab(root);
  assert.equal(second.memoryReused,true);
  assert.equal(second.attempts.length,1);
  assert.equal(second.attempts[0].passed,8);
  assert.ok(readJournal(root).some(e=>e.type==='progress.observed'));
  assert.equal(inspectCognitiveLab(root).trustedKnowledgeItems,2);
}));

test('modified attestation MAC invalidates previously promoted skill',()=>withTmp(async root=>{
  const run=await runCognitiveLab(root);
  const filename=run.attempts[1].evidenceFile;
  const ev=JSON.parse(fs.readFileSync(filename,'utf8'));
  ev.attestation.mac='0'.repeat(64);
  fs.writeFileSync(filename,JSON.stringify(ev));
  assert.equal(inspectCognitiveLab(root).trustedKnowledgeItems,0);
  const next=await runCognitiveLab(root);
  assert.equal(next.memoryReused,false);
}));

test('forged high pass count with unchanged signature cannot change promotion',()=>withTmp(async root=>{
  const run=await runCognitiveLab(root);
  const filename=run.attempts[1].evidenceFile;
  const ev=JSON.parse(fs.readFileSync(filename,'utf8'));
  ev.cases[0].name='forged by developer';
  fs.writeFileSync(filename,JSON.stringify(ev));
  assert.equal(inspectCognitiveLab(root).trustedKnowledgeItems,0);
}));
