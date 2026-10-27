import test from 'node:test';
import assert from 'node:assert/strict';
import {compactPlannerStep,focusPlannerToolDescriptions} from '../../agents/lib/context-packet.mjs';
const fixture=()=>({mission:{goal:'Fix addition',allowedTasks:['repo-read','repo-edit','repo-test'],
 contract:{scope:{allowed:['src/add.mjs']},verification:{commands:['node check.mjs']},budget:{max_steps:8}},
 contractStatus:{machineVerified:false,missing:['test']},openFiles:[{path:'src/add.mjs',sha256:'source',content:'a-b'}],
 recentReceipts:Array.from({length:8},(_,n)=>({n,type:'repo-read',input:{path:'src/add.mjs'},ok:true,verified:true,result:'x'.repeat(1200)}))},
 preflight:{ok:true,revision:'actual-revision',toolContracts:Object.fromEntries(Array.from({length:20},(_,i)=>['task-'+i,{description:'schema'.repeat(300)}]))},
 repository:{revision:'actual-revision',entries:Array.from({length:100},(_,i)=>({name:i===99?'src':'file-'+i,type:'dir'}))},
 execution:{remaining:['test']},skill:{instructions:'Never omit this procedure'}});
test('compact context removes duplicates while preserving authority, full observed files and verification',()=>{
 const source=fixture(),before=structuredClone(source),compact=compactPlannerStep(source);
 for(const key of ['goal','allowedTasks','contract','contractStatus','openFiles'])assert.deepEqual(compact.mission[key],source.mission[key]);
 assert.deepEqual(compact.execution,source.execution);assert.deepEqual(compact.skill,source.skill);
 assert.equal(compact.repository.revision,source.repository.revision);
 assert.equal(compact.repository.entries[0].name,'src');assert.equal(compact.repository.entriesOmitted,70);
 assert.deepEqual(compact.mission.recentReceipts.slice(-3),source.mission.recentReceipts.slice(-3));
 assert.deepEqual(source,before);assert.equal(compactPlannerStep(source,{profile:'standard'}),source);
 const originalChars=JSON.stringify(source).length,compactChars=JSON.stringify(compact).length;
 assert.ok(compactChars<originalChars*.5);console.log(JSON.stringify({fixture:'large-preflight-and-read-history',originalChars,compactChars,reductionPercent:Math.round(100*(1-compactChars/originalChars))}));
});
test('failed, unverified and mutation receipts keep their entire existing projection',()=>{
 const source=fixture();source.mission.recentReceipts[0]={type:'repo-edit',ok:true,verified:true,result:'mutation evidence'};
 source.mission.recentReceipts[1]={type:'repo-read',ok:false,verified:false,error:'permission denied',result:'error details'};
 source.mission.recentReceipts[2]={type:'repo-read',ok:true,verified:false,result:'uncertain outcome'};
 assert.deepEqual(compactPlannerStep(source).mission.recentReceipts.slice(0,3),source.mission.recentReceipts.slice(0,3));
});
test('focused tool descriptions preserve every schema, permission and learned caution',()=>{
 const tools=Array.from({length:30},(_,i)=>({name:'tool'+i,server:'test',description:i===29?'Fix addition':'Unrelated capability',readOnly:i%2===0,note:'Require an exact target',inputSchema:{required:['path'],properties:{path:{type:'string'}}}}));
 const selected=focusPlannerToolDescriptions(tools,{goal:'Fix addition'});
 assert.equal(selected.length,tools.length);assert.equal(selected[29].description,'Fix addition');
 assert.equal(selected.filter(t=>t.description).length,8);
 for(let i=0;i<tools.length;i++)for(const key of ['name','server','readOnly','note','inputSchema'])assert.deepEqual(selected[i][key],tools[i][key]);
});
