import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nova-agent-test-'));
process.env.NOVA_STATE_DIR=dir;
// The live planner choice (from the IDE) must not steer these tests.
process.env.JACO_PLANNER_CHOICE_FILE = path.join(dir, 'planner-choice.json');
process.env.NOVA_BRAIN_MODE='direct';
const {loadState,processChat,callBrain,processQueue,executeTask,novaLoopDelay,compactContinuityForBrain,continuityDeltaFromProposal,createAndroidNovaTools,androidRuntimeRequest,novaAgentCard}=await import('../../agents/hands-off-agent.mjs');
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
test('chat stores exact instruction and retries using the same idempotency key',async()=>{
 const file=path.join(dir,'chat-inbox.json');const text='Öppna min lokala testsida och kontrollera titeln';
 fs.writeFileSync(file,JSON.stringify([{role:'user',kind:'mission',text}]));let key;
 await assert.rejects(processChat(loadState(),{create:async input=>{key=input.idempotencyKey;throw Error('RESPONSE_LOST');}}),/RESPONSE_LOST/);
 await processChat(loadState(),{create:async input=>{assert.equal(input.goal,text);assert.equal(input.idempotencyKey,key);return {id:'mission-1'};}});
 const inbox=JSON.parse(fs.readFileSync(file));assert.equal(inbox[0].missionId,'mission-1');assert.equal(inbox[0].read,true);
});
test('planner receives mission evidence plus durable continuity without making continuity authority',async()=>{
 const mission={id:'mission-1',goal:'Inspect the local page',receipts:[{error:'missing element'}],allowedTasks:['health-check']};
 const continuity={continuityId:'jaco:primary',revision:4,missionAuthority:'CONNECTED_DURABLE_NOVA',objective:mission.goal,workingState:{attention:'verify current state',openQuestions:['is runtime healthy?'],nextActions:['health-check'],workingRefs:['mission:mission-1']},unresolved:{questions:['is runtime healthy?'],hypotheses:[]},epistemic:{unknowns:['target_host_unobserved'],repository:{status:'SCANNED'},knowledge:{verified:3}}};
 const r=await callBrain(loadState(),{mission,observation:{title:'Local page'},continuity},async(url,opts)=>{
 const body=JSON.parse(opts.body);const ctx=body.messages[1].content;
 assert.ok(ctx.includes(mission.goal));assert.ok(ctx.includes('Local page'));assert.ok(ctx.includes('missing element'));
 assert.ok(ctx.includes('jaco:primary'));assert.ok(ctx.includes('verify current state'));assert.ok(ctx.includes('target_host_unobserved'));
 return Response.json({choices:[{message:{content:'{"task":{"type":"health-check","data":{}},"continuity":{"attention":"health verification","openQuestions":[],"nextActions":["inspect result"],"workingRefs":["mission:mission-1"]}}'}}]});
 });assert.equal(r.task.type,'health-check');assert.equal(r.continuity.attention,'health verification');
});
test('a screenshot is attached only when its hash belongs to this mission',async()=>{
 const bytes=Buffer.from('offline-image-fixture');fs.writeFileSync(path.join(dir,'latest-observation.png'),bytes);
 for(const matches of [false,true]){
 const mission={goal:'Inspect',receipts:matches?[{type:'screenshot',ok:true,verified:true,at:new Date().toISOString(),result:{imageSha256:createHash('sha256').update(bytes).digest('hex')}}]:[]};
 const result=await callBrain(loadState(),{mission,observation:null},async(url,opts)=>{assert.equal(Array.isArray(JSON.parse(opts.body).messages[1].content),matches);return Response.json({choices:[{message:{content:'{"complete":true}'}}]});});
 assert.equal(result.complete,true);
 }
});
test('failed legacy queue task is never counted as done',async()=>{const state=loadState();state.taskQueue=[{id:'1',type:'health-check',status:'pending',nextRunAt:0,retries:0,maxRetries:1}];await processQueue(state,async()=>({ok:false,error:'OFFLINE'}));assert.equal(state.completedTasks,0);assert.equal(state.failedTasks,1);});
test('unknown task fails explicitly',async()=>{await assert.rejects(executeTask({type:'unknown',data:{}},loadState()),/UNKNOWN_TASK/);});

test('GitHub control polling never changes Nova mission/model cadence',()=>{
 assert.equal(novaLoopDelay(null,60_000,3_000),60_000);
 assert.equal(novaLoopDelay({executed:false},60_000,3_000),60_000);
 assert.equal(novaLoopDelay({executed:true},60_000,3_000),3_000);
});

test('continuity proposal can update working state but cannot mint authority fields',()=>{
 const delta=continuityDeltaFromProposal({continuity:{attention:'focus',openQuestions:['q'],nextActions:['n'],workingRefs:['r'],missionAuthority:'MODEL_OWNED',operator:'ignored'}},'mission-9');
 assert.deepEqual(delta,{focusMissionId:'mission-9',attention:'focus',openQuestions:['q'],nextActions:['n'],workingRefs:['r']});
 assert.equal(continuityDeltaFromProposal({task:{type:'health-check'}},'mission-9'),null);
 const compact=compactContinuityForBrain({continuityId:'jaco:primary',workingState:{openQuestions:Array.from({length:30},(_,i)=>'q'+i)},unresolved:{hypotheses:Array.from({length:20},(_,i)=>({id:'h'+i,problem:'p'+i}))}});
 assert.equal(compact.workingState.openQuestions.length,12);
 assert.equal(compact.unresolved.hypotheses.length,8);
});


test('SEER planner mode uses the full 2048 token budget for reasoning models',async()=>{
  const prior=process.env.NOVA_BRAIN_MODE;
  process.env.NOVA_BRAIN_MODE='seer';
  try{
    const mission={id:'mission-seer-budget',goal:'Plan safely',receipts:[],allowedTasks:['health-check']};
    const result=await callBrain(loadState(),{mission,observation:null,continuity:null},async(_url,opts)=>{
      const body=JSON.parse(opts.body);
      assert.equal(body.max_tokens,2048);
      return Response.json({ok:true,text:'{"task":{"type":"health-check","data":{},"expectedOutcome":"healthy"}}',provider:'litert',model:'gemma4:e2b',local:true});
    });
    assert.equal(result.task.type,'health-check');
  }finally{
    process.env.NOVA_BRAIN_MODE=prior || 'direct';
  }
});


test('Android Nova tools use canonical traction routes and preserve verified receipts', async()=>{
  const calls=[];
  const request=async(method,path,body,options={})=>{
    calls.push({method,path,body,options});
    if(path==='/api/nova/traction/target') return {success:true,traction:{state:'LOCKED'}};
    if(path==='/api/nova/traction/android-action') {
      return {success:true,receipt:{success:true,verified:true,action_type:body.action.type}};
    }
    return {success:true,traction:{state:'INTENT'}};
  };
  const android=createAndroidNovaTools(request);
  const observed=await android.observe({packageName:'com.android.settings'});
  assert.equal(observed.receipt.action_type,'observe_screen');
  await android.begin({intent:'Open Settings and inspect Wi-Fi',expectedNextState:'settings visible'});
  const target=await android.target({semanticPurpose:'Wi-Fi row',text:'Wi-Fi',confidence:0.98,source:'accessibility'});
  assert.equal(target.verified,true);
  const tapped=await android.tap({packageName:'com.android.settings',selector:{text:'Wi-Fi'}});
  assert.equal(tapped.receipt.verified,true);
  assert.equal(calls[0].path,'/api/nova/traction/android-action');
  assert.equal(calls[0].body.action.type,'observe_screen');
  assert.equal(calls[1].path,'/api/nova/traction/begin');
  assert.equal(calls[2].path,'/api/nova/traction/target');
  assert.equal(calls[3].body.action.type,'tap');
  assert.equal(calls[3].options.mutation,true);
});

test('Android Nova typing rejects likely secrets before runtime execution', async()=>{
  let called=false;
  const android=createAndroidNovaTools(async()=>{called=true;return {success:true};});
  assert.throws(
    ()=>android.typeText({text:'OTP 123456',selector:{editable:true}}),
    /ANDROID_SENSITIVE_TEXT_REQUIRES_HUMAN_ENTRY/
  );
  assert.equal(called,false);
});

test('Android Nova tool surface is advertised only when Android runtime is detected',()=>{
  const withoutAndroid=novaAgentCard({runtime:true,android:false,nova:false,browser:false,desktop:false});
  assert.equal(withoutAndroid.capabilities.tools.includes('android-observe'),false);
  assert.equal(withoutAndroid.capabilities.android_control,false);

  const withAndroid=novaAgentCard({runtime:true,android:true,nova:false,browser:false,desktop:false});
  for(const tool of ['android-status','android-observe','android-begin','android-target','android-open-app','android-tap','android-type','android-scroll','android-back','android-home']) {
    assert.equal(withAndroid.capabilities.tools.includes(tool),true,tool);
  }
  assert.equal(withAndroid.capabilities.android_control,true);
});


test('Android runtime transport distinguishes pre-action rejection from unknown executed outcome', async()=>{
  const preAction=await androidRuntimeRequest('POST','/api/nova/traction/android-action',{action:{type:'tap'}},{
    mutation:true,
    runtimeUrl:'http://runtime.test',
    fetchImpl:async()=>new Response(JSON.stringify({success:false,error:'TARGET_LOCK_NOT_VERIFIED'}),{status:409,headers:{'content-type':'application/json'}})
  });
  assert.equal(preAction.ok,false);
  assert.equal(preAction.outcomeUnknown,false);

  const unverified=await androidRuntimeRequest('POST','/api/nova/traction/android-action',{action:{type:'tap'}},{
    mutation:true,
    runtimeUrl:'http://runtime.test',
    fetchImpl:async()=>new Response(JSON.stringify({success:false,receipt:{success:true,verified:false,action_type:'tap'}}),{status:409,headers:{'content-type':'application/json'}})
  });
  assert.equal(unverified.ok,false);
  assert.equal(unverified.outcomeUnknown,true);

  const serverError=await androidRuntimeRequest('POST','/api/nova/traction/android-action',{action:{type:'tap'}},{
    mutation:true,
    runtimeUrl:'http://runtime.test',
    fetchImpl:async()=>new Response(JSON.stringify({success:false,error:'BROKEN_PIPE'}),{status:503,headers:{'content-type':'application/json'}})
  });
  assert.equal(serverError.outcomeUnknown,true);
});

test('SEER corrects an unread edit before execution and stays within a two-proposal budget',async()=>{
 const prior=process.env.NOVA_BRAIN_MODE;process.env.NOVA_BRAIN_MODE='seer';
 try {
  const mission={id:'read-before-edit',goal:'Fix addition',allowedTasks:['repo-read','repo-edit'],receipts:[]};
  const edit={task:{type:'repo-edit',data:{path:'src/add.mjs',old:'a-b',new:'a+b'}}};
  let calls=0;
  const result=await callBrain(loadState(),{mission},async(_url,options)=>{
   const input=JSON.parse(options.body);calls++;
   if(calls===2)assert.match(input.user,/READ_BEFORE_EDIT/);
   return Response.json({ok:true,text:JSON.stringify(calls===1?edit:{task:{type:'repo-read',data:{path:'src/add.mjs'}}})});
  });
  assert.equal(calls,2);assert.equal(result.task.type,'repo-read');
  calls=0;
  await assert.rejects(callBrain(loadState(),{mission},async()=>{calls++;return Response.json({ok:true,text:JSON.stringify(edit)});}),/READ_BEFORE_EDIT/);
  assert.equal(calls,2);
 }finally{process.env.NOVA_BRAIN_MODE=prior;}
});

test('SEER accepts observed edit text but rejects invented text and does not retry provider failure',async()=>{
 const prior=process.env.NOVA_BRAIN_MODE;process.env.NOVA_BRAIN_MODE='seer';
 try {
  const mission={id:'observed-edit',goal:'Fix addition',allowedTasks:['repo-read','repo-edit'],receipts:[{type:'repo-read',ok:true,verified:true,result:{path:'src/add.mjs',content:'return a - b;\r\n'}}]};
  const proposal={task:{type:'repo-edit',data:{path:'src/add.mjs',old:'return a - b;\n',new:'return a + b;\n'}}};
  const result=await callBrain(loadState(),{mission},async()=>Response.json({ok:true,text:JSON.stringify(proposal)}));
  assert.equal(result.task.type,'repo-edit');
  proposal.task.data.old='function invented() {}';
  await assert.rejects(callBrain(loadState(),{mission},async()=>Response.json({ok:true,text:JSON.stringify(proposal)})),/EDIT_TEXT_NOT_OBSERVED/);
  let calls=0;
  await assert.rejects(callBrain(loadState(),{mission},async()=>{calls++;return Response.json({ok:false,error:'all_providers_failed'},{status:503});}),/all_providers_failed/);
  assert.equal(calls,1);
 }finally{process.env.NOVA_BRAIN_MODE=prior;}
});

test('edit planning normalizes contract paths and discards reads invalidated by an intervening edit',async()=>{
 const {assertPlanTaskAllowed}=await import('../../agents/hands-off-agent.mjs');
 const {normalizeCodingContract}=await import('../../agents/lib/coding-contract.mjs');
 const mission={allowedTasks:['repo-edit'],contract:normalizeCodingContract({objective:'Edit observed code',scope:{allowed:['src/**']},acceptance:['Edit verified']}),receipts:[{type:'repo-read',ok:true,verified:true,result:{path:'src/a.mjs',content:'const value = 1;'}}]};
 const proposal={task:{type:'repo-edit',data:{path:'./src/a.mjs',old:'value = 1',new:'value = 2'}}};
 assert.doesNotThrow(()=>assertPlanTaskAllowed(proposal,mission));
 mission.receipts.push({type:'repo-edit',ok:true,verified:true,result:{path:'src/a.mjs'}});
 assert.throws(()=>assertPlanTaskAllowed(proposal,mission),/READ_BEFORE_EDIT/);
});

test('a coding prompt retains available tool contracts without advertising unrelated tool fields',async()=>{
 const {brainSystemFor}=await import('../../agents/hands-off-agent.mjs');
 const coding=brainSystemFor(['repo-read','repo-edit','repo-test'],false,'linux');
 for(const field of ['repo-list/repo-read {path}','repo-edit {path,old,new,replaceAll?}','repo-test {command,kind}'])assert.ok(coding.includes(field),field);
 for(const field of ['repo-write {','shell {','git-push {','invoke-worker {','github-create-repo {','browser-click {','web-fetch {'])assert.ok(!coding.includes(field),field);
 assert.ok(coding.includes('command must be copied character-for-character'));
 assert.ok(coding.includes('never read .env')||coding.includes('Never read .env'));
 const browser=brainSystemFor(['browser-type'],false,'linux');
 assert.ok(browser.includes('browser-type {name,text}'));
 assert.ok(!browser.includes('browser-click {name,expect}'));
 assert.ok(browser.includes('Never compose the literal text'));
 const desktop=brainSystemFor(['screenshot'],false,'win32');
 assert.ok(desktop.includes('screenshot {hwnd?'));
 assert.ok(!desktop.includes('desktop-invoke {'));
 const pointer=brainSystemFor(['mouse-click'],false,'win32');
 assert.ok(pointer.includes('mouse-move/mouse-click {x,y}'));
 assert.ok(!pointer.includes('key-press {'));
});
