import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DurableMissionBus} from '../../runtime/src/server/connected/durableMissionBus.mjs';
import {NovaMissionControl, validateTask, mountNovaMissionRoutes, compactTaskInput} from '../../runtime/src/server/connected/novaMissionControl.mjs';
import {MissionClient,processMissionTurn,checkedReceipt} from '../../agents/lib/mission-client.mjs';
function setup(t, allowedTasks=['health-check','browser-click']) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nova-test-'));
 let clock=Date.now();
 let bus=new DurableMissionBus(dir);
 let control=new NovaMissionControl(bus,{allowedTasks,now:()=>clock});
 t.after(()=>{bus.close();fs.rmSync(dir,{recursive:true,force:true});});
 const routes=new Map();
 const auth=()=>{};
 mountNovaMissionRoutes({get:(p,...f)=>routes.set('GET '+p,f),post:(p,...f)=>routes.set('POST '+p,f)},auth,control);
 const client=new MissionClient('http://offline','test-token',async(url,opts)=>{
   assert.equal(opts.headers['x-gateway-token'],'test-token');
   const pathname=new URL(url).pathname;
   const match=pathname.match(/\/missions\/([^/]+)(\/.*)?$/);
   const key=match?pathname.replace(match[1],':id'):pathname;
   const handlers=routes.get(opts.method+' '+key);
   assert.ok(handlers,'mounted route '+key);assert.equal(handlers[0],auth);
   let status=200,data;
   handlers.at(-1)({body:opts.body?JSON.parse(opts.body):undefined,params:{id:match?.[1]},query:Object.fromEntries(new URL(url).searchParams)},{status(n){status=n;return this;},json(value){data=value;}});
   return {ok:status===200,status,json:async()=>data};
 });
 return {client,get control(){return control;},advance(ms){clock+=ms;},reopen(){bus.close();bus=new DurableMissionBus(dir);control=new NovaMissionControl(bus,{allowedTasks,now:()=>clock});}};
}
const goal={goal:'Kontrollera sidan och rapportera vad som faktiskt hände',idempotencyKey:'operator-1'};
const task={type:'health-check',data:{}};

test('authenticated cancellation route persists a request and waits for the executing receipt',async t=>{
 const s=setup(t);const m=await s.client.create(goal);
 const {token}=await s.client.claim(m.id,'nova');const lease={owner:'nova',token};
 const started=await s.client.begin(m.id,{...lease,task});
 const stopped=await s.client.request('POST',`/missions/${m.id}/cancel`,{note:'Parent graph stopped during dispatch'});
 assert.equal(stopped.mission.cancelRequested,true);
 assert.equal(stopped.mission.status,'ACTIVE');
 const done=await s.client.finish(m.id,{...lease,actionId:started.id,receipt:{ok:true,verified:true,result:{observed:true}}});
 assert.equal(done.status,'CANCELLED');
 assert.equal(done.receipts.length,1);
 s.reopen();assert.equal(s.control.get(m.id).status,'CANCELLED');
});
test('goal and idempotency survive database reopen',t=>{const s=setup(t);const m=s.control.create(goal);s.reopen();assert.equal(s.control.create(goal).id,m.id);assert.equal(s.control.current().goal,goal.goal);});
test('HTTP contract closes the loop and feeds receipts to the next plan',async t=>{
 const s=setup(t);const m=await s.client.create(goal);let calls=0;
 for(let i=0;i<2;i++)await processMissionTurn({client:s.client,owner:'nova',plan:async ctx=>{assert.equal(ctx.mission.goal,goal.goal);assert.equal(ctx.mission.receipts.length,i);assert.equal(ctx.observation.title,'Observed');return {task};},observe:async()=>({title:'Observed'}),execute:async()=>{calls++;return {ok:true};}});
 assert.equal(calls,2);s.reopen();assert.equal(s.control.get(m.id).receipts.length,2);
});
test('a false tool result is persisted as failure',async t=>{const s=setup(t);await s.client.create(goal);const r=await processMissionTurn({client:s.client,owner:'nova',plan:async()=>({task}),execute:async()=>({ok:false,error:'DEVICE_OFFLINE'})});assert.equal(r.receipt.ok,false);assert.equal(r.mission.failures,1);});
test('unverified mutation blocks instead of counting completion',async t=>{const s=setup(t);await s.client.create(goal);let n=0;const run=()=>processMissionTurn({client:s.client,owner:'nova',plan:async()=>({task:{type:'browser-click',data:{name:'Save'}}}),execute:async()=>{n++;return {ok:true};}});const r=await run();assert.equal(r.mission.status,'BLOCKED');await run();assert.equal(n,1);});
test('only one owner can lease a mission',t=>{const s=setup(t);const m=s.control.create(goal);s.control.claim(m.id,'a');assert.throws(()=>s.control.claim(m.id,'b'),/BUSY/);});
test('expired planning can recover',t=>{const s=setup(t);const m=s.control.create(goal);const claim=s.control.claim(m.id,'a');s.advance(claim.mission.planningDeadlineAt-Date.parse(m.createdAt)+1000);assert.ok(s.control.claim(m.id,'b').token);});
test('expired executing mutation remains interrupted after restart',t=>{const s=setup(t);const m=s.control.create(goal);const {token}=s.control.claim(m.id,'a');s.control.begin(m.id,{owner:'a',token,task:{type:'browser-click',data:{name:'Save'}}});s.advance(300001);s.reopen();assert.equal(s.control.current(),null);assert.equal(s.control.get(m.id).phase,'INTERRUPTED');assert.throws(()=>s.control.claim(m.id,'b'),/MISSION_NOT_CURRENT|BLOCKED/);});
test('receipt retries do not duplicate evidence',t=>{const s=setup(t);const m=s.control.create(goal);const {token}=s.control.claim(m.id,'a');const a=s.control.begin(m.id,{owner:'a',token,task});const body={owner:'a',token,actionId:a.id,receipt:{ok:true,verified:true}};s.control.finish(m.id,body);s.control.finish(m.id,body);assert.equal(s.control.get(m.id).receipts.length,1);});
test('lost finish response never automatically repeats a mutation',async t=>{const s=setup(t);const m=await s.client.create(goal);let n=0;s.client.finish=async()=>{throw Error('NETWORK_LOST');};await assert.rejects(processMissionTurn({client:s.client,owner:'nova',plan:async()=>({task:{type:'browser-click',data:{name:'Save'}}}),execute:async()=>{n++;return {ok:true,verified:true};}}),/NETWORK_LOST/);s.advance(300001);s.control.current();assert.equal(s.control.get(m.id).status,'BLOCKED');assert.equal(s.control.current(),null);assert.equal(n,1);});
test('completion proposal waits for operator evidence review',async t=>{const s=setup(t);const m=await s.client.create(goal);await processMissionTurn({client:s.client,owner:'nova',plan:async()=>({complete:true}),execute:async()=>assert.fail('must not execute')});assert.equal(s.control.get(m.id).status,'AWAITING_VERIFICATION');assert.throws(()=>s.control.resolve(m.id,{decision:'confirm',note:'reviewed'}),/VERIFIED_RECEIPT/);});
test('review can confirm verified work',async t=>{const s=setup(t);const m=await s.client.create(goal);await processMissionTurn({client:s.client,owner:'nova',plan:async()=>({task}),execute:async()=>({ok:true})});assert.equal(s.control.resolve(m.id,{decision:'confirm',note:'Observed requested result'}).status,'DONE');});
test('three planning errors stop repeated model calls',t=>{const s=setup(t);const m=s.control.create(goal);for(let i=0;i<3;i++){const {token}=s.control.claim(m.id,'a');s.control.release(m.id,{owner:'a',token,error:'NO_PROVIDER'});}assert.equal(s.control.get(m.id).status,'BLOCKED');});
test('blocked oldest mission does not starve later active work',t=>{const s=setup(t);const first=s.control.create({...goal,idempotencyKey:'blocked-first'});for(let i=0;i<3;i++){const {token}=s.control.claim(first.id,'a');s.control.release(first.id,{owner:'a',token,error:'NO_PROVIDER'});}assert.equal(s.control.get(first.id).status,'BLOCKED');const second=s.control.create({...goal,idempotencyKey:'active-second'});assert.equal(s.control.current().id,second.id);assert.ok(s.control.claim(second.id,'b').token);});
test('coding tools require an explicit coding contract',t=>{const s=setup(t,['health-check','repo-read','repo-write','repo-test','git-status','git-diff','git-commit']);const plain=s.control.create({...goal,idempotencyKey:'plain-no-code'});assert.deepEqual(plain.allowedTasks,['health-check']);assert.throws(()=>s.control.create({...goal,idempotencyKey:'explicit-no-contract',allowedTasks:['repo-read']}),/CODING_CONTRACT_REQUIRED/);const contract={schema:'jaco.coding-contract/v1',objective:'Inspect bounded source',scope:{allowed:['agents/**']},acceptance:['inspection evidence exists'],execution:{autonomous:true,allow_git_commit:false},verification:{tests_required:false,receipt_required:true,commands:[]}};const coded=s.control.create({...goal,idempotencyKey:'contract-code',allowedTasks:['repo-read'],contract});assert.deepEqual(coded.allowedTasks,['repo-read']);assert.equal(coded.contract.schema,'jaco.coding-contract/v1');});
test('task permission and schema are enforced',()=>{assert.throws(()=>validateTask({type:'shell',data:{command:'anything'}},['health-check']),/NOT_ALLOWED/);assert.throws(()=>validateTask({type:'browser-click',data:{}},['browser-click']),/REQUIRED/);assert.throws(()=>validateTask({type:'mouse-click',data:{x:NaN,y:0}},['mouse-click']),/COORDINATE/);assert.throws(()=>validateTask({type:'screenshot',data:{outFile:'custom'}},['screenshot']),/RUNTIME_OWNED/);});
test('adaptive screenshot task is bounded and runtime-owned',()=>{
 const checked=validateTask({type:'screenshot',data:{hwnd:123,mode:'adaptive',maxWidth:768,maxHeight:512},expectedOutcome:'fresh terminal ROI'},['screenshot']);
 assert.deepEqual(checked.data,{hwnd:123,mode:'adaptive',maxWidth:768,maxHeight:512});
 assert.throws(()=>validateTask({type:'screenshot',data:{mode:'tiny'}},['screenshot']),/INVALID_SCREENSHOT_MODE/);
 assert.throws(()=>validateTask({type:'screenshot',data:{maxWidth:100}},['screenshot']),/INVALID_SCREENSHOT_MAXWIDTH/);
 assert.throws(()=>validateTask({type:'screenshot',data:{foo:'bar'}},['screenshot']),/INVALID_SCREENSHOT_FIELD/);
});

test('nested failed receipt overrides outer acknowledgement',()=>{assert.equal(checkedReceipt(task,{success:true,receipt:{success:false,error:'FAILED'}}).ok,false);});

test('desktop AgentOS contract accepts semantic UIA action only',()=>{
 const allowed=['desktop-windows','desktop-observe','desktop-action'];
 const checked=validateTask({type:'desktop-action',data:{action:{type:'invoke',hwnd:123,selector:{automationId:'saveButton',controlType:'Button'},wait_after_ms:600}},expectedOutcome:'Save confirmation becomes visible'},allowed);
 assert.equal(checked.data.action.type,'invoke');
 assert.equal(checked.data.action.selector.automationId,'saveButton');
 assert.throws(()=>validateTask({type:'desktop-action',data:{action:{type:'click',hwnd:123,selector:{name:'Save'}}}},allowed),/INVALID_DESKTOP_ACTION_TYPE/);
 assert.throws(()=>validateTask({type:'desktop-action',data:{action:{type:'invoke',hwnd:123,selector:{}}}},allowed),/INVALID_DESKTOP_SELECTOR/);
 assert.throws(()=>validateTask({type:'desktop-action',data:{action:{type:'set_value',hwnd:123,selector:{automationId:'name'},text:'x'.repeat(2001)}}},allowed),/INVALID_DESKTOP_TEXT/);
 assert.throws(()=>validateTask({type:'desktop-action',data:{action:{type:'invoke',hwnd:123,selector:{automationId:'save'},x:10}}},allowed),/INVALID_DESKTOP_ACTION_FIELD/);
});

test('desktop window discovery is read-only evidence',()=>{
 const receipt=checkedReceipt({type:'desktop-windows',data:{}},{success:true,windows:[{hwnd:123,title:'Editor'}]});
 assert.equal(receipt.ok,true);
 assert.equal(receipt.verified,true);
 assert.equal(receipt.outcomeUnknown,false);
});

test('mission persists explicit autonomy mandate binding',t=>{
 const s=setup(t,['desktop-windows','desktop-observe','desktop-action']);
 const mission=s.control.create({goal:'Inspect and update the editor through verified UI Automation',idempotencyKey:'desktop-mandate-1',mandateId:'mandate-test-123'});
 assert.equal(mission.metadata.mandateId,'mandate-test-123');
 s.reopen();
 assert.equal(s.control.get(mission.id).metadata.mandateId,'mandate-test-123');
});


test('windows WMI task is bounded, read-only and requires Desktop AgentOS executor',t=>{
 const s=setup(t,['health-check','windows-wmi-read']);
 assert.throws(
   ()=>s.control.create({goal:'Read Windows CPU',idempotencyKey:'wmi-wrong-executor',allowedTasks:['windows-wmi-read'],executor:'nova'}),
   /WINDOWS_WMI_REQUIRES_DESKTOP_AGENTOS/
 );
 const mission=s.control.create({
   goal:'Read Windows CPU through bounded CIM observation',
   idempotencyKey:'wmi-desktop-1',
   allowedTasks:['windows-wmi-read'],
   executor:'desktop-agentos'
 });
 assert.deepEqual(mission.allowedTasks,['windows-wmi-read']);
 assert.equal(mission.metadata.executor,'desktop-agentos');
 assert.throws(()=>s.control.claim(mission.id,'nova-android'),/MISSION_EXECUTOR_MISMATCH/);
 const lease=s.control.claim(mission.id,'desktop-agentos-testhost-123');
 const action=s.control.begin(mission.id,{
   owner:'desktop-agentos-testhost-123',
   token:lease.token,
   task:{type:'windows-wmi-read',data:{query:'cpu',limit:10},expectedOutcome:'observed CPU inventory'}
 });
 assert.equal(action.type,'windows-wmi-read');
 assert.equal(action.data.query,'cpu');
 assert.throws(
   ()=>validateTask({type:'windows-wmi-read',data:{query:'SELECT * FROM Win32_Process'}},['windows-wmi-read']),
   /INVALID_WINDOWS_WMI_QUERY/
 );
 assert.throws(
   ()=>validateTask({type:'windows-wmi-read',data:{query:'cpu',command:'whoami'}},['windows-wmi-read']),
   /INVALID_WINDOWS_WMI_FIELD/
 );
});

test('executor compatibility is checked before durable lease claim',async()=>{
 let claimed=0;
 const client={
   current:async()=>({id:'m-win',status:'ACTIVE',metadata:{executor:'desktop-agentos'}}),
   claim:async()=>{claimed++;throw new Error('claim must not run');}
 };
 const result=await processMissionTurn({
   client,
   owner:'nova-android',
   acceptMission:mission=>mission.metadata.executor!=='desktop-agentos',
   plan:async()=>assert.fail('planner must not run'),
   execute:async()=>assert.fail('executor must not run')
 });
 assert.equal(result.executed,false);
 assert.equal(result.skipped,'executor_mismatch');
 assert.equal(claimed,0);
});


test('Android Nova mission tasks are bounded and schema-validated',()=>{
 const allowed=['android-status','android-observe','android-begin','android-target','android-open-app','android-tap','android-type','android-scroll','android-back','android-home'];

 assert.deepEqual(
   validateTask({type:'android-begin',data:{intent:'Open Settings',expectedNextState:'Settings visible'}},allowed).data,
   {intent:'Open Settings',expectedNextState:'Settings visible'}
 );
 assert.deepEqual(
   validateTask({type:'android-target',data:{semanticPurpose:'Wi-Fi row',text:'Wi-Fi',confidence:0.97,source:'accessibility',bbox:[0,100,900,220]}},allowed).data,
   {semanticPurpose:'Wi-Fi row',text:'Wi-Fi',confidence:0.97,source:'accessibility',bbox:[0,100,900,220]}
 );
 assert.deepEqual(
   validateTask({type:'android-tap',data:{packageName:'com.android.settings',selector:{text:'Wi-Fi'},waitAfterMs:750}},allowed).data,
   {packageName:'com.android.settings',selector:{text:'Wi-Fi'},waitAfterMs:750}
 );
 assert.deepEqual(
   validateTask({type:'android-scroll',data:{direction:'down'}},allowed).data,
   {direction:'DOWN'}
 );

 assert.throws(()=>validateTask({type:'android-open-app',data:{packageName:'bad package'}},allowed),/INVALID_ANDROID_PACKAGE/);
 assert.throws(()=>validateTask({type:'android-tap',data:{}},allowed),/ANDROID_TAP_TARGET_REQUIRED/);
 assert.throws(()=>validateTask({type:'android-target',data:{semanticPurpose:'Save',confidence:2}},allowed),/INVALID_ANDROID_TARGET_CONFIDENCE/);
 assert.throws(()=>validateTask({type:'android-type',data:{text:'OTP 123456',selector:{editable:true}}},allowed),/ANDROID_SENSITIVE_TEXT_REQUIRES_HUMAN_ENTRY/);
 assert.throws(()=>validateTask({type:'android-scroll',data:{direction:'DIAGONAL'}},allowed),/INVALID_ANDROID_DIRECTION/);
 assert.throws(()=>validateTask({type:'android-observe',data:{shell:'whoami'}},allowed),/INVALID_ANDROID_OBSERVE_FIELD/);
});

test('Android observe/status are read-only evidence but Android mutations require verified receipt',()=>{
 const observed=checkedReceipt({type:'android-observe',data:{}},{success:true,receipt:{success:true,verified:true,action_type:'observe_screen'}});
 assert.equal(observed.ok,true);
 assert.equal(observed.verified,true);
 assert.equal(observed.outcomeUnknown,false);

 const status=checkedReceipt({type:'android-status',data:{}},{success:true,android:{connected:true}});
 assert.equal(status.ok,true);
 assert.equal(status.verified,true);

 const begin=checkedReceipt({type:'android-begin',data:{intent:'Inspect Settings'}},{success:true,traction:{state:'INTENT'}});
 assert.equal(begin.ok,true);
 assert.equal(begin.verified,true);

 const target=checkedReceipt({type:'android-target',data:{semanticPurpose:'Wi-Fi'}},{success:true,traction:{state:'REIDENTIFYING'}});
 assert.equal(target.ok,true);
 assert.equal(target.verified,true);
 assert.equal(target.outcomeUnknown,false);

 const tapUnverified=checkedReceipt({type:'android-tap',data:{x:1,y:1}},{success:true,receipt:{success:true,verified:false}});
 assert.equal(tapUnverified.ok,true);
 assert.equal(tapUnverified.verified,false);
 assert.equal(tapUnverified.outcomeUnknown,true);

 const tapVerified=checkedReceipt({type:'android-tap',data:{x:1,y:1}},{success:true,receipt:{success:true,verified:true}});
 assert.equal(tapVerified.ok,true);
 assert.equal(tapVerified.verified,true);
 assert.equal(tapVerified.outcomeUnknown,false);
});


test('receipt post-processing hook is awaited after durable mission finish',async t=>{
 const s=setup(t);
 await s.client.create(goal);
 let hookFinished=false;
 const turn=await processMissionTurn({
   client:s.client,
   owner:'nova',
   plan:async()=>({task}),
   execute:async()=>({ok:true}),
   onReceipt:async(receipt,finishedTask,mission)=>{
     assert.equal(receipt.ok,true);
     assert.equal(receipt.verified,true);
     assert.equal(finishedTask.type,'health-check');
     assert.equal(mission.receipts.length,1);
     await new Promise(resolve=>setTimeout(resolve,10));
     hookFinished=true;
   },
 });
 assert.equal(turn.executed,true);
 assert.equal(hookFinished,true);
});

// Operator 2026-10-03: several read-only steps per planning call, like a Claude turn, each with its own receipt.
test('a batched plan runs its reading steps in one turn, each with a receipt and its input',async t=>{
 const s=setup(t,['health-check','browser-click','web-fetch']);const m=await s.client.create(goal);let planned=0;const ran=[];
 const r=await processMissionTurn({client:s.client,owner:'nova',plan:async()=>{planned++;return {tasks:[task,{type:'web-fetch',data:{url:'https://a.test'}},{type:'web-fetch',data:{url:'https://b.test'}}]};},execute:async x=>{ran.push(x.data.url||x.type);return {ok:true,verified:true};}});
 assert.equal(planned,1);assert.deepEqual(ran,['health-check','https://a.test','https://b.test']);
 assert.equal(r.receipts.length,3);
 const receipts=s.control.get(m.id).receipts;
 assert.deepEqual(receipts.map(x=>[x.type,x.input?.url||null]),[['health-check',null],['web-fetch','https://a.test'],['web-fetch','https://b.test']]);
});
test('a batch stops at the first failure and never runs a later changing step',async t=>{
 const s=setup(t,['health-check','browser-click','web-fetch']);await s.client.create(goal);const ran=[];
 await processMissionTurn({client:s.client,owner:'nova',plan:async()=>({tasks:[task,{type:'browser-click',data:{name:'Buy'}},{type:'web-fetch',data:{url:'https://c.test'}}]}),execute:async x=>{ran.push(x.type);return {ok:true};}});
 assert.deepEqual(ran,['health-check'],'a click after the first step is not run');
 const ran2=[];const s2=setup(t,['health-check','web-fetch']);await s2.client.create({...goal,idempotencyKey:'operator-2'});
 await processMissionTurn({client:s2.client,owner:'nova',plan:async()=>({tasks:[{type:'web-fetch',data:{url:'https://x.test'}},{type:'web-fetch',data:{url:'https://y.test'}}]}),execute:async x=>{ran2.push(x.data.url);return {ok:false,error:'DOWN'};}});
 assert.deepEqual(ran2,['https://x.test']);
});
test('long inputs are kept on receipts by length only',()=>{
 assert.deepEqual(compactTaskInput({path:'a.txt',content:'x'.repeat(5000)}),{path:'a.txt',content:'[5000 chars]'});
});
test('failed reads get five tries before the mission stops; failed actions three',t=>{
 const s=setup(t,['health-check','browser-click','web-fetch']);const m=s.control.create(goal);
 const fail=type=>{const {token}=s.control.claim(m.id,'a');const a=s.control.begin(m.id,{owner:'a',token,task:type==='web-fetch'?{type,data:{url:'https://x.test'}}:{type,data:{name:'Save'}}});return s.control.finish(m.id,{owner:'a',token,actionId:a.id,receipt:{ok:false,verified:false,error:'E'}});};
 for(let i=0;i<4;i++)assert.equal(fail('web-fetch').status,'ACTIVE');
 assert.equal(fail('web-fetch').status,'BLOCKED');
 const m2=s.control.create({...goal,idempotencyKey:'acts',goal:'Klicka spara i formuläret'});
 const failAct=()=>{const {token}=s.control.claim(m2.id,'a');const a=s.control.begin(m2.id,{owner:'a',token,task:{type:'browser-click',data:{name:'Save'}}});return s.control.finish(m2.id,{owner:'a',token,actionId:a.id,receipt:{ok:false,verified:false,error:'E'}});};
 failAct();failAct();assert.equal(failAct().status,'BLOCKED');
});
test('a mission routed to a joined device is only claimed by that device, and the hub Nova never takes it',t=>{
 const s=setup(t);
 assert.throws(()=>s.control.create({goal:'Bad device',idempotencyKey:'dev-bad',executor:'nova@Laptop!'}),/INVALID_MISSION_EXECUTOR/);
 const device=s.control.create({goal:'Lista filer i hemkatalogen på laptopen',idempotencyKey:'dev-1',executor:'nova@laptop'});
 const hub=s.control.create({goal:'Kontrollera hubbens hälsa och rapportera',idempotencyKey:'hub-1'});
 assert.equal(s.control.current('nova').id,hub.id);
 assert.equal(s.control.current('nova@laptop').id,device.id);
 assert.throws(()=>s.control.claim(device.id,'nova-hub'),/MISSION_EXECUTOR_MISMATCH/);
 assert.throws(()=>s.control.claim(device.id,'nova-phone','nova@phone'),/MISSION_EXECUTOR_MISMATCH/);
 assert.throws(()=>s.control.claim(hub.id,'nova-laptop','nova@laptop'),/MISSION_EXECUTOR_MISMATCH/);
 assert.throws(()=>s.control.claim(device.id,'desktop-agentos-pc-1'),/MISSION_EXECUTOR_MISMATCH/);
 assert.ok(s.control.claim(device.id,'nova-laptop','nova@laptop').token);
 assert.ok(s.control.claim(hub.id,'nova-hub').token);
});
test('the mission client claims with its executor',async t=>{
 const s=setup(t);
 s.control.create({goal:'Lista filer i hemkatalogen på laptopen',idempotencyKey:'dev-2',executor:'nova@laptop'});
 const device=new MissionClient('http://offline','test-token',s.client.fetch,'nova@laptop');
 let ran=0;
 const r=await processMissionTurn({client:device,owner:'nova-laptop',acceptMission:m=>(m.metadata.executor||'nova')===device.executor,plan:async()=>({task}),execute:async()=>{ran++;return {ok:true};}});
 assert.equal(ran,1);assert.equal(r.receipt.ok,true);
 const hub=new MissionClient('http://offline','test-token',s.client.fetch,'nova');
 const hubTurn=await processMissionTurn({client:hub,owner:'nova-hub',plan:async()=>assert.fail('hub must not plan'),execute:async()=>assert.fail('hub must not run')});
 assert.equal(hubTurn.executed,false);
});
test('a paid order goes before older research missions in the queue',t=>{
 const s=setup(t);
 const research=s.control.create({goal:'Undersök hur lokala modeller planerar uppdrag',idempotencyKey:'research-1'});
 s.advance(1000);
 const paid=s.control.create({goal:'Paid order sky_test: run the repo security scan for https://github.com/a/b',idempotencyKey:'sky_test',source:'skyfire-order'});
 assert.equal(s.control.current().id,paid.id);
 assert.equal(s.control.current('nova').id,paid.id);
 assert.ok(s.control.claim(paid.id,'nova-hub').token);
 assert.throws(()=>s.control.claim(research.id,'nova-hub'),/MISSION_NOT_CURRENT/);
});

test('Nova requests graph refinement without executing and the request survives restart',async t=>{
 const s=setup(t); const m=await s.client.create({...goal,idempotencyKey:'split',source:'seer-mission-graph',parent:{graphId:'g',nodeKey:'large',mainGoal:'Original measurable goal'}});
 const subgoals=[{title:'Inspect',objective:'Inspect contracts'},{title:'Integrate',objective:'Implement and verify acceptance'}];
 const r=await processMissionTurn({client:s.client,owner:'nova',plan:async()=>({replan:true,reason:'Too broad',subgoals}),execute:async()=>{assert.fail('No action may run during refinement');}});
 assert.equal(r.replanRequested,true); assert.equal(s.control.get(m.id).status,'BLOCKED');s.reopen();assert.deepEqual(s.control.get(m.id).replanRequest,{reason:'Too broad',subgoals});
});
test('a replan request cannot inject permissions or change an executing turn', t=>{
 const s=setup(t); const m=s.control.create({...goal,idempotencyKey:'split-invalid',source:'seer-mission-graph',parent:{graphId:'g',nodeKey:'large',mainGoal:'Original'}});
 const lease=s.control.claim(m.id,'nova'); const input={owner:'nova',token:lease.token,replanRequest:{reason:'Split',subgoals:[{title:'A',objective:'A',contract:{scope:{allowed:['/']}}},{title:'B',objective:'B'}]}};
 assert.throws(()=>s.control.release(m.id,input),/REPLAN_SUBGOAL_INVALID/);assert.equal(s.control.get(m.id).phase,'PLANNING');
 s.control.begin(m.id,{owner:'nova',token:lease.token,task});assert.throws(()=>s.control.release(m.id,input),/EXECUTION_REQUIRES_RECEIPT/);
});
test('successful unrelated reads no longer reset repeated identical failures',async t=>{
 const s=setup(t,['web-fetch','health-check']);const m=await s.client.create({...goal,idempotencyKey:'stall',source:'seer-mission-graph',parent:{graphId:'g',nodeKey:'large',mainGoal:'Original'}});
 const run=(task,result)=>processMissionTurn({client:s.client,owner:'nova',plan:async()=>({task}),execute:async()=>result});
 for(let i=0;i<5;i++){
   if(i)await run({type:'health-check',data:{}},{ok:true});
   await run({type:'web-fetch',data:{url:'https://example.test/missing'}},{ok:false,error:'WEB_FETCH_EXPECTATION_FAILED',status:404});
 }
 const after=s.control.get(m.id);assert.equal(after.status,'BLOCKED');assert.equal(after.failures,1);assert.match(after.replanRequest.reason,/failed 5 times/);
});

test('operator cancellation waits for the in-flight receipt and never claims success',t=>{
 const s=setup(t);const m=s.control.create({...goal,idempotencyKey:'cancel-flight'});const lease=s.control.claim(m.id,'nova');const action=s.control.begin(m.id,{owner:'nova',token:lease.token,task});
 assert.equal(s.control.requestCancel(m.id).cancelRequested,true);assert.equal(s.control.get(m.id).phase,'EXECUTING');
 const after=s.control.finish(m.id,{owner:'nova',token:lease.token,actionId:action.id,receipt:{ok:true,verified:true}});
 assert.equal(after.status,'CANCELLED');assert.equal(after.receipts.length,1);assert.equal(after.receipts[0].actionId,action.id);assert.equal(after.cancelRequested,false);
});
test('a cancellation during planning prevents a new tool call and survives restart',t=>{
 const s=setup(t);const m=s.control.create({...goal,idempotencyKey:'cancel-plan'});const lease=s.control.claim(m.id,'nova');s.control.requestCancel(m.id);s.reopen();
 assert.throws(()=>s.control.begin(m.id,{owner:'nova',token:lease.token,task}),/MISSION_CANCEL_REQUESTED/);
 s.control.release(m.id,{owner:'nova',token:lease.token});assert.equal(s.control.get(m.id).status,'CANCELLED');assert.equal(s.control.get(m.id).receipts.length,0);
});

// A verified mutation proposed again on an unchanged view is not re-run (an endless mkdir), but the
// same action on a changed view is (Next on consecutive wizard pages), and long arguments still match.
test('the same verified mutation on an unchanged view proposes completion instead of re-running',async t=>{
 const s=setup(t,['browser-click']);const m=await s.client.create({...goal,allowedTasks:['browser-click']});
 const long={name:'Save',note:'x'.repeat(5000)};let runs=0;
 const turn=()=>processMissionTurn({client:s.client,owner:'nova',observe:async()=>({url:'https://a.test/form',title:'Form'}),plan:async()=>({task:{type:'browser-click',data:long,expectedOutcome:'saved'}}),execute:async()=>{runs++;return {ok:true,verified:true};}});
 await turn();const second=await turn();
 assert.equal(runs,1);assert.equal(second.awaitingVerification,true);assert.equal(second.reason,'REPEAT_OF_VERIFIED_ACTION');
 const r=s.control.get(m.id).receipts.at(-1);assert.equal(r.input.note,'[5000 chars]');assert.equal(r.inputHash.length,64);
});
test('the same mutation runs again when the view changed since its receipt',async t=>{
 const s=setup(t,['browser-click']);await s.client.create({...goal,allowedTasks:['browser-click']});
 let page=1,runs=0;
 const turn=()=>processMissionTurn({client:s.client,owner:'nova',observe:async()=>({url:`https://a.test/wizard/${page}`,title:`Step ${page}`}),plan:async()=>({task:{type:'browser-click',data:{name:'Next'},expectedOutcome:'next page'}}),execute:async()=>{runs++;page++;return {ok:true,verified:true};}});
 await turn();const second=await turn();
 assert.equal(runs,2);assert.equal(second.executed,true);
});

test('an interrupted read-only step or test runs again instead of waiting on the operator',t=>{
 const s=setup(t,['health-check','repo-test','browser-click']);
 const m=s.control.create({goal:'Kontrollera hubbens hälsa och rapportera',idempotencyKey:'retry-read'});
 const lease=s.control.claim(m.id,'nova');s.control.begin(m.id,{owner:'nova',token:lease.token,task});
 s.advance(60*60_000);s.control.current();
 const after=s.control.get(m.id);
 assert.equal(after.status,'ACTIVE');assert.equal(after.phase,'READY');assert.equal(after.activeTask,null);
 assert.ok(s.control.claim(m.id,'nova').token,'claimable again');
});
test('an interrupted step that changes something still waits for the operator',t=>{
 const s=setup(t,['health-check','browser-click']);
 const m=s.control.create({goal:'Klicka spara i formuläret',idempotencyKey:'retry-mutate',allowedTasks:['browser-click']});
 const lease=s.control.claim(m.id,'nova');s.control.begin(m.id,{owner:'nova',token:lease.token,task:{type:'browser-click',data:{name:'Spara'}}});
 s.advance(60*60_000);s.control.current();
 const after=s.control.get(m.id);
 assert.equal(after.status,'BLOCKED');assert.equal(after.phase,'INTERRUPTED');
});
test('a mission for a device that never joined is refused at creation',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nova-known-'));const bus=new DurableMissionBus(dir);
 t.after(()=>{bus.close();fs.rmSync(dir,{recursive:true,force:true});});
 const control=new NovaMissionControl(bus,{allowedTasks:['health-check'],knownExecutor:e=>!e.includes('@')||e==='nova@laptop'});
 assert.throws(()=>control.create({...goal,idempotencyKey:'ghost',executor:'nova@goal-proof'}),/UNKNOWN_DEVICE_EXECUTOR:nova@goal-proof/);
 assert.ok(control.create({...goal,idempotencyKey:'laptop',executor:'nova@laptop'}).id);
 assert.ok(control.create({goal:'Kontrollera hubben',idempotencyKey:'hub'}).id);
});


test('opaque MCP in-flight call is INTERRUPTED instead of replaying on restart',t=>{
  const s=setup(t,['mcp-call']);
  const m=s.control.create({...goal,idempotencyKey:'opaque-replay',allowedTasks:['mcp-call']});
  const {token}=s.control.claim(m.id,'a');
  s.control.begin(m.id,{owner:'a',token,task:{type:'mcp-call',data:{server:'files',tool:'read_file',arguments:{}}}});
  s.advance(300001);
  s.reopen();
  // Reopening the database alone is not a state transition: expiration recovery
  // runs when the queue is inspected or a lease is claimed. Trigger that real
  // runtime path before asserting the persisted INTERRUPTED result.
  assert.equal(s.control.current(),null);
  assert.equal(s.control.get(m.id).phase,'INTERRUPTED');
  assert.equal(s.control.get(m.id).status,'BLOCKED');
});
