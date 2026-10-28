import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runCycles,inspectCycles,readCycleLedger,adversarialChecks} from '../../agents/cognitive-lab/autonomous-cycles/cycle-runtime.mjs';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'jaco-autonomous-cycles-test-'));
const cleanup=dir=>fs.rmSync(dir,{recursive:true,force:true});
const source=dir=>path.join(dir,'work','task-engine.mjs');

test('three-cycle reject, debug, repair, senior review, real Git commit and replay',async()=>{
 const dir=tmp();try{
  const r=await runCycles(dir,{until:3});
  assert.equal(r.cycles,3);assert.equal(r.fixesAccepted,1);assert.equal(r.proposalsRejected,1);
  assert.equal(r.actualGitCommits,2);assert.equal(r.skillsPromoted,1);
  const e=readCycleLedger(dir);assert.ok(e.some(x=>x.type==='debug.diagnosed'));
  assert.ok(e.some(x=>x.type==='senior.rejected'));
  assert.ok(e.some(x=>x.type==='senior.approved'));
  assert.equal(fs.existsSync(path.join(dir,'work','.git')),true);
 }finally{cleanup(dir)}
});

test('process restart resumes without duplicating accepted skills or Git commits',async()=>{
 const dir=tmp();try{
  await runCycles(dir,{until:3});
  const runner=path.resolve('agents/cognitive-lab/autonomous-cycles/run.mjs');
  const p=spawnSync(process.execPath,[runner,'run','--state',dir,'--until','6'],{cwd:path.resolve('.'),encoding:'utf8',timeout:20000});
  assert.equal(p.status,0,p.stderr);
  const r=inspectCycles(dir);
  assert.equal(r.cycles,6);assert.equal(r.fixesAccepted,2);assert.equal(r.actualGitCommits,3);
  assert.equal(r.skillsPromoted,2);
 }finally{cleanup(dir)}
});

test('edited reviewer attestation is rejected on inspection and continuation',async()=>{
 const dir=tmp();try{
  await runCycles(dir,{until:3});
  const file=path.join(dir,'evidence','cycle-02.json');const e=JSON.parse(fs.readFileSync(file,'utf8'));
  e.passed=99;fs.writeFileSync(file,JSON.stringify(e));
  assert.throws(()=>inspectCycles(dir),/REVIEW_EVIDENCE_TAMPERED/);
  await assert.rejects(()=>runCycles(dir,{until:4}),/REVIEW_EVIDENCE_TAMPERED/);
 }finally{cleanup(dir)}
});

test('memory cannot promote a fake verified phase',async()=>{
 const dir=tmp();try{
  await runCycles(dir,{until:3});
  const file=path.join(dir,'knowledge.json');const k=JSON.parse(fs.readFileSync(file,'utf8'));
  k.accepted[0].codeHash='f'.repeat(64);fs.writeFileSync(file,JSON.stringify(k));
  await assert.rejects(()=>runCycles(dir,{until:4}),/KNOWLEDGE_EVIDENCE_UNTRUSTED/);
 }finally{cleanup(dir)}
});

test('role capsule cannot silently claim senior approval right',async()=>{
 const dir=tmp();try{
  await runCycles(dir,{until:3});
  const file=path.join(dir,'agents','developer','capsule.json');const x=JSON.parse(fs.readFileSync(file,'utf8'));
  x.skills.push('approve');fs.writeFileSync(file,JSON.stringify(x));
  await assert.rejects(()=>runCycles(dir,{until:4}),/ROLE_CAPSULE_MUTATED/);
 }finally{cleanup(dir)}
});

test('journal tampering is detected before continuation',async()=>{
 const dir=tmp();try{
  await runCycles(dir,{until:3});
  const file=path.join(dir,'events.jsonl');const before=fs.readFileSync(file,'utf8');
  fs.writeFileSync(file,before.replace('senior.rejected','senior.hidden'));
  assert.throws(()=>readCycleLedger(dir),/CYCLE_LEDGER_TAMPERED/);
  await assert.rejects(()=>runCycles(dir,{until:4}),/CYCLE_LEDGER_TAMPERED/);
 }finally{cleanup(dir)}
});

test('all 33 cycles achieve independently reviewed state and prevent cross-tenant replay, budget resets and concurrent duplicates',async()=>{
 const dir=tmp();try{
  const r=await runCycles(dir,{until:33});
  assert.equal(r.cycles,33);assert.equal(r.fixesAccepted,11);assert.equal(r.proposalsRejected,11);
  assert.equal(r.actualGitCommits,12);assert.equal(r.skillsPromoted,11);assert.equal(r.regressionCycles,11);
  assert.equal(r.reviewCasesExecuted,452);assert.equal(r.reviewCasesPassed,433);
  assert.deepEqual(adversarialChecks(dir),{forgedProofRejected:true,developerCannotApprove:true,ledgerIntegrityVerified:true});
  const {TaskEngine}=await import(pathToFileURL(source(dir)).href);
  let n=0;const execute=async()=>({status:++n===1?200:201});
  const l=(a,m)=>({agentId:a,missionId:m,generation:3,expiresAt:Date.now()+30000});
  const e=new TaskEngine({execute,maxCalls:2});
  const a=await e.run({id:'shared',method:'GET'},{agentId:'a',missionId:'A',lease:l('a','A')});
  const b=await e.run({id:'shared',method:'GET'},{agentId:'b',missionId:'B',lease:l('b','B')});
  assert.equal(a.status,200);assert.equal(b.status,201);assert.equal(n,2);
  const restored=TaskEngine.restore(e.snapshot(),{execute,maxCalls:2});
  await assert.rejects(()=>restored.run({id:'third',method:'GET'},{agentId:'a',missionId:'A',lease:l('a','A')}),/EXECUTION_BUDGET_EXCEEDED/);
  let sideEffects=0;const concurrent=new TaskEngine({execute:async()=>{sideEffects++;await new Promise(r=>setTimeout(r,5));return {status:200}}});
  const scoped={agentId:'a',missionId:'A',lease:l('a','A')};
  const parallel=await Promise.all([concurrent.run({id:'p',method:'POST'},scoped),concurrent.run({id:'p',method:'POST'},scoped)]);
  assert.equal(sideEffects,1);assert.equal(parallel.length,2);
 }finally{cleanup(dir)}
});
