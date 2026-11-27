import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {summarizeMissionOutcomes} from '../../agents/lib/mission-intelligence.mjs';
import {learningStore} from '../../agents/lib/skill-learning.mjs';
const scopeKey='a'.repeat(64);
const row=(id,extra={})=>({schema:'jaco.mission-reflection/v1',missionId:id,scopeKey,status:'DONE',verificationStatus:'VERIFIED',repositoryRevision:'r1',at:'2026-11-27T00:00:00Z',evidence:['receipt'],unexpected:[],...extra});
test('counts unique scoped reflections and separates stale and unknown evidence',()=>{
 const s=summarizeMissionOutcomes([row('a'),row('a'),row('b',{repositoryRevision:'old'}),row('c',{unexpected:[{}]}),row('d',{status:'FAILED'}),row('e',{scopeKey:'b'.repeat(64)}),row('f',{at:'invalid'}),row('g',{evidence:[]})],{scopeKey,revision:'r1'});
 assert.deepEqual(s.counts,{verified:1,stale:1,unverified:2,failed:1,other:0});
 assert.equal(s.total,5);assert.equal(s.duplicates,1);assert.equal(s.invalid,1);assert.equal(s.verifiedFraction,0.2);assert.equal(s.unresolved,1);
 assert.doesNotMatch(JSON.stringify(s),/receipt"|missionId|scopeKey/);
});
test('empty scope is not a success rate and absent revision cannot verify',()=>{
 assert.equal(summarizeMissionOutcomes([],{scopeKey}).verifiedFraction,null);
 assert.equal(summarizeMissionOutcomes([row('a')],{scopeKey}).counts.verified,0);
 assert.throws(()=>summarizeMissionOutcomes([],{}),/VALID_SCOPE_REQUIRED/);
});
test('canonical journal integration is scope-bound and read-only',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mission-intel-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=learningStore(dir),contract={scope:{allowed:['repo-read']}};
 store.recordOutcome({id:'m',status:'DONE',contract,contractStatus:{machineVerified:true},preflight:{repository:{revision:'r1'}},receipts:[{type:'repo-read',actionId:'m:turn:1',ok:true,verified:true}]});
 assert.equal(store.intelligence(contract,'r1').counts.verified,1);
 assert.equal(store.intelligence(contract,'r2').counts.stale,1);
 assert.equal(store.intelligence({scope:{allowed:['repo-list']}},'r1').total,0);
 assert.throws(()=>store.intelligence({},'r1'),/EXPLICIT_SCOPE_REQUIRED/);
});
