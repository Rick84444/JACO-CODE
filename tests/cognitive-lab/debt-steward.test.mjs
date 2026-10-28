import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanTechnicalDebt,auditTechnicalDebt } from '../../agents/cognitive-lab/autonomous-cycles/debt-steward.mjs';
import { runCycles,inspectCycles,readCycleLedger } from '../../agents/cognitive-lab/autonomous-cycles/cycle-runtime.mjs';
import { readAutonomousCycleBoard } from '../../runtime/src/server/connected/autonomousCycleBoard.mjs';
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'jaco-debt-audit-'));

test('steward removes deterministic residue and whitespace, preserves executable source',()=>{
 const text='export const value=17;  \n// candidate 2: repair for validation\n\n\n\n';
 const a=cleanTechnicalDebt(text);assert.equal(a.accepted,true);assert.equal(a.changed,true);assert.equal(a.removedCandidateComments,1);
 assert.ok(a.source.includes('export const value=17;'));assert.deepEqual(a.blockers,[]);
 assert.deepEqual(cleanTechnicalDebt(a.source).source,a.source);
});
test('steward refuses to green unresolved debugger, TODO and dynamic eval',()=>{
 const a=cleanTechnicalDebt('// FIXME unsafe\ndebugger;\neval(userCode);\n');
 assert.equal(a.accepted,false);
 assert.deepEqual(a.blockers,['DEBUGGER_STATEMENT','UNRESOLVED_FIXME','UNSAFE_DYNAMIC_EVAL']);
});
test('empty workspace is reported as not started and never as live agent',()=>{
 const d=temp();try{const result=readAutonomousCycleBoard(d);assert.equal(result.state,'NOT_STARTED');assert.equal(result.liveProcessObserved,false);assert.equal(result.mainMergeVerified,false);}finally{fs.rmSync(d,{recursive:true,force:true})}
});
test('review is always after debt audit, and cleanup before senior Git commit',async()=>{
 const base=temp();try{
  const state=path.join(base,'.jaco','autonomous-cycles');const r=await runCycles(state,{until:3});
  assert.equal(r.cycles,3);assert.equal(r.debtAudits,3);assert.equal(r.debtCleanups,2);assert.equal(r.debtBlockers,0);
  const events=readCycleLedger(state);
  for(const cycle of [1,2,3]){
   const items=events.filter(e=>e.data?.cycle===cycle);
   const audit=items.findIndex(e=>e.type==='debt.audited');const review=items.findIndex(e=>e.type==='review.attested');
   assert.ok(audit>=0&&review>audit,`Debt must precede review in cycle ${cycle}`);
  }
  const view=readAutonomousCycleBoard(base);
  assert.equal(view.state,'RECORDED');assert.equal(view.summary.debtAudits,3);
  assert.equal(view.summary.debtCleanups,2);assert.equal(view.summary.fixesAccepted,1);
  assert.equal(view.evidenceLevel,'HASH_CHAIN_ONLY');assert.equal(view.mainMergeVerified,false);
  const file=path.join(state,'events.jsonl'),body=fs.readFileSync(file,'utf8');
  fs.writeFileSync(file,body.replace('debt.audited','debt.cheated'));
  assert.throws(()=>readAutonomousCycleBoard(base),/CYCLE_LEDGER_INTEGRITY_FAILED/);
 }finally{fs.rmSync(base,{recursive:true,force:true})}
});