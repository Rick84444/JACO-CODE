import test from 'node:test';
import assert from 'node:assert/strict';
import {createBonsaiAndroidAgent} from '../../runtime/src/server/android/bonsaiAndroidAgent.mjs';
const pkg='com.android.chrome';
const node = (text,props={}) => ({text,clickable:true,children:[],...props});
const observe=()=>({success:true,package_name:pkg,root:{text:'',children:[node('Search', {view_id:'search-input',editable:true,clickable:true}),node('Search result',{view_id:'result-1'})]}});
const mandate = {signedByOperator:true,enabled:true,expiresAt:new Date(Date.now()+100000).toISOString(),allowedAndroidPackages:[pkg]};
const reply = obj=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(obj)}}]})});
function setup(sequence,options={}) {let calls=[];let cursor=0;let status=options.currentPackage||pkg; const android={status:async()=>({enabled:true,accessibility_connected:true,active_package:status}),observe:async()=>observe(),executeVerified:async(action)=>{calls.push(action);return {action_id:action.action_id,action_type:action.type,success:true,verified:true,before_hash:'x',after_hash:'y'}}};const fetchImpl=async(_url,init)=>{cursor++;return reply(sequence[Math.min(cursor-1,sequence.length-1)])};const agent=createBonsaiAndroidAgent({android,fetchImpl});return {agent,calls};}
const action=(type,selector,extras={})=>({type:'action',action:{type,selector,...extras}});
const input=extra=>({instruction:'Search for weather',packageName:pkg,mandate, ...extra});
test('taps unique observed selector and reports only verified receipt',async()=>{const x=setup([action('tap',{view_id:'result-1'}),{type:'done',expected_text:'Search result'}]);const r=await x.agent.run(input());assert.equal(r.status,'DONE_WITH_OBSERVED_TEXT');assert.equal(r.verifiedSteps,1);assert.equal(x.calls[0].type,'tap')});
test('rejects sensitive delete targets before acting',async()=>{const x=setup([action('tap',{text:'Delete'})]);const r=await x.agent.run(input());assert.equal(r.status,'ACTION_REJECTED');assert.equal(x.calls.length,0)});
test('rejects unapproved package and missing mandate',async()=>{const x=setup([]);await assert.rejects(x.agent.run(input({packageName:'com.android.settings'})),/ANDROID_PACKAGE_DENIED/);await assert.rejects(x.agent.run(input({mandate:{}})),/ANDROID_MANDATE_REQUIRED/)});
test('strict JSON and no model-supplied coordinates',async()=>{const x=setup([action('tap',undefined,{x:10,y:20})]);const r=await x.agent.run(input());assert.equal(r.status,'ACTION_REJECTED')});
test('does not accept model done without visible completion',async()=>{const x=setup([{type:'done',expected_text:'nonexistent'}]);const r=await x.agent.run(input());assert.equal(r.status,'MODEL_DONE_UNVERIFIED')});
test('launches only approved Android package when not foreground',async()=>{const x=setup([{type:'done',expected_text:'Search'}],{currentPackage:'com.other.app'});const r=await x.agent.run(input());assert.equal(x.calls.length,1);assert.equal(x.calls[0].type,'open_app');assert.equal(x.calls[0].package_name,pkg);assert.equal(r.status,'DONE_WITH_OBSERVED_TEXT')});
test('requires Android accessibility service ready',async()=>{const a=createBonsaiAndroidAgent({android:{status:async()=>({enabled:false,accessibility_connected:false}),observe:async()=>observe(),executeVerified:async()=>{}},fetchImpl:async()=>reply({type:'stop'})});await assert.rejects(a.run(input()),/ANDROID_ACCESSIBILITY_NOT_READY/)});

test('stops on a stale UI after local Bonsai inference',async()=>{
  let observations=0,executions=0;
  const android={
    status:async()=>({enabled:true,accessibility_connected:true,active_package:pkg}),
    observe:async()=>{observations++;const s=observe();if(observations===2)s.root.children[1].text='changed while deciding';return s;},
    executeVerified:async()=>{executions++;throw Error('must not execute stale target');},
  };
  const agent=createBonsaiAndroidAgent({android,fetchImpl:async()=>reply(action('tap',{view_id:'result-1'}))});
  const result=await agent.run(input());
  assert.equal(result.status,'TARGET_STALE');
  assert.equal(executions,0);
});
