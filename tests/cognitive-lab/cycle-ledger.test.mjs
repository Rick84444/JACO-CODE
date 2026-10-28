import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {hashCycleEvent,parseCycleLedger,CYCLE_ZERO_HASH} from '../../agents/lib/cognitive-cycle-ledger.mjs';
import {readCycleLedger} from '../../agents/cognitive-lab/autonomous-cycles/cycle-runtime.mjs';
import {readAutonomousCycleBoard} from '../../runtime/src/server/connected/autonomousCycleBoard.mjs';
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'jaco-ledger-'));
const event=(data={},seq=1,prev=CYCLE_ZERO_HASH)=>{const a={schema:'jaco.autonomous-cycle-event/v1',seq,at:'2026-10-28T00:00:00Z',type:'cycle.completed',role:'controller',data,prev};return {...a,hash:hashCycleEvent(a)}};
test('shared parser retains existing valid journal format',()=>{
 const a=event({cycle:1,mode:'regression',accepted:true,passed:1,total:1});const b=event({cycle:2},2,a.hash);
 assert.deepEqual(parseCycleLedger(JSON.stringify(a)+'\n'+JSON.stringify(b)+'\n'),[a,b]);assert.deepEqual(parseCycleLedger(''),[]);
});
test('malformed, truncated and over-budget histories are rejected',()=>{
 const good=JSON.stringify(event())+'\n';
 assert.throws(()=>parseCycleLedger(good.trimEnd()),/CYCLE_LEDGER_INCOMPLETE/);
 assert.throws(()=>parseCycleLedger('{broken\n'),/CYCLE_LEDGER_TAMPERED/);
 assert.throws(()=>parseCycleLedger('null\n'),/CYCLE_LEDGER_TAMPERED/);
 assert.throws(()=>parseCycleLedger(good,{maxBytes:10}),/CYCLE_LEDGER_TOO_LARGE/);
 assert.throws(()=>parseCycleLedger(good+good,{maxEvents:1}),/CYCLE_LEDGER_TOO_LARGE/);
});
test('rehashed structural forgery is still invalid',()=>{
 for(const bad of [{...event(),seq:0},{...event(),schema:'other'},{...event(),role:12},{...event(),data:null},{...event(),prev:'1'.repeat(64)}]){
  bad.hash=hashCycleEvent(bad);assert.throws(()=>parseCycleLedger(JSON.stringify(bad)+'\n'),/CYCLE_LEDGER_TAMPERED/);
 }
});
test('IDE and runner reject the same corrupted journal',()=>{
 const dir=temp();try{const state=path.join(dir,'.jaco','autonomous-cycles');fs.mkdirSync(state,{recursive:true});const file=path.join(state,'events.jsonl');const e=event({cycle:1,mode:'propose'});
 fs.writeFileSync(file,JSON.stringify(e)+'\n');assert.equal(readCycleLedger(state).length,1);assert.equal(readAutonomousCycleBoard(dir).summary.cycles,1);
 fs.writeFileSync(file,JSON.stringify({...e,prev:'bad'})+'\n');assert.throws(()=>readCycleLedger(state),/CYCLE_LEDGER_TAMPERED/);assert.throws(()=>readAutonomousCycleBoard(dir),/CYCLE_LEDGER_INTEGRITY_FAILED/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('runner does not follow symlinked ledger files',()=>{
 const dir=temp();try{const state=path.join(dir,'state');fs.mkdirSync(state);const ext=path.join(dir,'outside.jsonl');fs.writeFileSync(ext,JSON.stringify(event())+'\n');fs.symlinkSync(ext,path.join(state,'events.jsonl'));
 assert.throws(()=>readCycleLedger(state),/FILE_NOT_REGULAR/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
