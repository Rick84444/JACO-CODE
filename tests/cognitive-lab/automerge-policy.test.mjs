import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const yaml = fs.readFileSync(path.join(root, '.github/workflows/autonomous-green-to-main.yml'), 'utf8');
const lines = yaml.split('\n');
const index = lines.findIndex(line => line.trim() === 'script: |');
assert.ok(index > 0, 'expected executable github-script block');
const script = lines.slice(index + 1).filter(line => line.startsWith('            ')).map(line => line.slice(12)).join('\n');
assert.ok(script.includes('github.rest.pulls.merge'));
const sha = 'a'.repeat(40);

async function evaluate({changes = [], conclusions = ['success','success'], event='pull_request', fork=false, reviewed=false, pending=false}={}) {
  const merged=[];const infos=[];
  const pull={number:7,draft:false,head:{sha,ref:'feat/jaco-autonomous-new-ux',repo:{full_name:fork?'elsewhere/repo':'Rick84444/JACO-CODE'}},base:{ref:'main'},labels:[]};
  const runs=['Autonomous Delivery Gate','Technical Debt Steward Gate'].map((name,i)=>({head_sha:sha,name,status:pending&&i===1?'in_progress':'completed',conclusion:conclusions[i],created_at:'2026-10-28T20:00:00Z',run_attempt:1}));
  const endpoints={list(){},listFiles(){},listReviews(){},listWorkflowRunsForRepo(){},get(){},merge(){}};
  const github={
    paginate:async(fn)=>fn===endpoints.list?[pull]:fn===endpoints.listFiles?changes.map(filename=>({filename})):fn===endpoints.listReviews?(reviewed?[{user:{login:'reviewer'},state:'CHANGES_REQUESTED'}]:[]):fn===endpoints.listWorkflowRunsForRepo?runs:[],
    rest:{pulls:{list:endpoints.list,listFiles:endpoints.listFiles,listReviews:endpoints.listReviews,get:async()=>({data:{head:pull.head,base:pull.base,draft:false,mergeable:true}}),merge:async x=>merged.push(x)},actions:{listWorkflowRunsForRepo:endpoints.listWorkflowRunsForRepo}},
  };
  const context={repo:{owner:'Rick84444',repo:'JACO-CODE'},payload:{workflow_run:{head_sha:sha,event}}};
  const core={info:message=>infos.push(message),notice:message=>infos.push(message)};
  await vm.runInNewContext(`(async()=>{${script}\n})()`,{github,context,core},{timeout:1000});
  return {merged,infos};
}

test('all green and no protected changes allows scoped, exact-SHA squash merge',async()=>{
 const out=await evaluate({changes:['runtime/src/components/AutonomousCyclesPanel.tsx']});
 assert.equal(out.merged.length,1);assert.equal(out.merged[0].sha,sha);assert.equal(out.merged[0].merge_method,'squash');
});
test('governance and verification authority changes require human review, regardless of green CI',async()=>{
 for(const file of ['.github/workflows/technical-debt-gate.yml','scripts/verify-technical-debt.mjs','runtime/src/server/continuum/evidenceLedger.mjs','runtime/src/server/continuum/leaseManager.mjs','agents/lib/cognitive-cycle-ledger.mjs','agents/cognitive-lab/autonomous-cycles/cycle-runtime.mjs','agents/cognitive-lab/autonomous-cycles/cycle-reviewer.mjs','agents/cognitive-lab/autonomous-cycles/debt-steward.mjs','runtime/src/server/connected/autonomousCycleBoard.mjs']){
  const out=await evaluate({changes:[file]});assert.equal(out.merged.length,0,file);assert.match(out.infos.join(' '),/human review/);
 }
});
test('failed and pending required checks never merge',async()=>{
 assert.equal((await evaluate({conclusions:['success','failure']})).merged.length,0);
 assert.equal((await evaluate({pending:true})).merged.length,0);
});
test('fork, review veto and non-pull-request runs never merge',async()=>{
 assert.equal((await evaluate({fork:true})).merged.length,0);
 assert.equal((await evaluate({reviewed:true})).merged.length,0);
 assert.equal((await evaluate({event:'push'})).merged.length,0);
});
