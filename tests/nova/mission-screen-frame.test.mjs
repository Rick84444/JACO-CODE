import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {freshMissionFrame,permittedFrameMessages} from '../../agents/lib/mission-screen-frame.mjs';
import {NovaTractionEngine,computeManifoldDrift} from '../../runtime/src/server/nova/tractionCore.mjs';
import {taskContract} from '../../agents/lib/task-fields.mjs';
const bytes=Buffer.from([137,80,78,71,13,10,26,10,1,2,3]),now=Date.now(),sha=createHash('sha256').update(bytes).digest('hex');
const receipt={type:'screenshot',ok:true,verified:true,at:new Date(now-100).toISOString(),result:{imageSha256:sha,width:200,height:100,capture:{x:-100,y:20,width:400,height:200}}};
const deps={now,stat:()=>({size:bytes.length,mtimeMs:now-100,isFile:()=>true}),read:()=>bytes};
test('frame is bound to current mission, hash, age and intervening actions',()=>{
  assert.equal(freshMissionFrame({receipts:[receipt]},'ignored',deps).sha256,sha);
  assert.equal(freshMissionFrame({receipts:[receipt,{type:'mouse-click'}]},'ignored',deps),null);
  assert.equal(freshMissionFrame({receipts:[receipt,{type:'screenshot',ok:false}]},'ignored',deps),null);
  assert.equal(freshMissionFrame({receipts:[receipt]},'ignored',{...deps,now:now+31000}),null);
  assert.equal(freshMissionFrame({receipts:[receipt]},'ignored',{...deps,read:()=>Buffer.alloc(bytes.length)}),null);
  assert.equal(freshMissionFrame({receipts:[]},'ignored',deps),null);
});
test('visual request is ephemeral and cloud requires explicit opt-in',()=>{
  const frame=freshMissionFrame({receipts:[receipt]},'ignored',deps),messages=[{role:'user',content:'test'}];
  const local=permittedFrameMessages(messages,frame,{url:'http://127.0.0.1:11434/v1/chat/completions'},{});
  assert.equal(local.at(-1).content.at(-1).type,'image_url');assert.equal(messages.length,1);
  const remote=permittedFrameMessages(messages,frame,{url:'https://remote.example/v1/chat'},{});
  assert.match(remote.at(-1).content,/not permitted/);
  assert.ok(!JSON.stringify(remote).includes('base64'));
  assert.equal(permittedFrameMessages(messages,frame,{url:'https://remote.example'},{NOVA_ALLOW_CLOUD_IMAGES:'1'}).at(-1).content.at(-1).type,'image_url');
});
test('Track refuses stale and cross-application observations; no NaN target lock',()=>{
  const track=new NovaTractionEngine();
  track.beginIntent('edit','changed');track.acquireTarget({semanticPurpose:'Editor',confidence:'not a number'});
  assert.equal(track.getState().target.confidence,0);
  track.acquireTarget({semanticPurpose:'Editor',text:'Editor',confidence:1});
  track.observe({app:'code',timestamp:new Date().toISOString(),semanticTargets:[{text:'Editor'}]});
  assert.equal(track.getState().state,'LOCKED');
  track.observe({app:'other',timestamp:new Date().toISOString(),semanticTargets:[{text:'Editor'}]});
  assert.equal(track.getState().state,'REIDENTIFYING');
  assert.equal(track.beforeAction('click').state,'RECOVERING');
  track.observe({app:'other',timestamp:new Date(Date.now()-60000).toISOString(),semanticTargets:[{text:'Editor'}]});
  assert.equal(track.getState().state,'REIDENTIFYING');
});
test('native computer actions have concrete schemas',()=>{
  assert.equal(taskContract('mouse-click').properties.x.type,'integer');
  assert.deepEqual(taskContract('mouse-click').properties.button.enum,['left','right','middle']);
  assert.equal(taskContract('screenshot').properties.maxWidth.maximum,1600);
});

test('vision preserves one trailing user turn and does not mutate the transcript',()=>{
  const frame=freshMissionFrame({receipts:[receipt]},'ignored',deps);
  const messages=[{role:'user',content:'Click Save'}];
  const out=permittedFrameMessages(messages,frame,{url:'http://127.0.0.1:11434/v1/chat/completions'},{});
  assert.equal(out.length,1);
  assert.equal(out[0].content[0].text,'Click Save');
  assert.equal(out[0].content.at(-1).type,'image_url');
  assert.equal(messages[0].content,'Click Save');
  const denied=permittedFrameMessages(messages,frame,{url:'https://remote.example'},{});
  assert.equal(denied.length,1);assert.equal(typeof denied[0].content,'string');
  assert.ok(!JSON.stringify(denied).includes('base64'));
});
test('manifold veto: geometry and age independently break continuity',()=>{
  const base={role:'button',text:'Save',bbox:[100,100,80,30],confidence:1};
  assert.equal(computeManifoldDrift(base,{...base,bbox:[140,100,80,30]},0).lockBroken,true);
  assert.equal(computeManifoldDrift(base,base,2000).lockBroken,true);
  assert.equal(computeManifoldDrift(base,{...base,bbox:[102,100,80,30]},100).lockBroken,false);
  assert.equal(computeManifoldDrift(base,{...base,text:'Delete'},0).drift,1);
  assert.equal(computeManifoldDrift(base,base,NaN).lockBroken,true);
  assert.equal(computeManifoldDrift(base,{...base,bbox:undefined},0).geometryObserved,false);
});
test('trajectory evaluates the matched candidate, not first item, and vetoes a moved target',()=>{
  const engine=new NovaTractionEngine(),at=new Date().toISOString();
  const base={role:'button',text:'Save',bbox:[100,100,80,30],confidence:1};
  engine.beginIntent('Save');engine.acquireTarget({...base,semanticPurpose:'Save'});
  assert.equal(engine.observe({app:'editor',timestamp:at,semanticTargets:[{text:'Delete'},base]}).state,'LOCKED');
  assert.equal(engine.observe({app:'editor',timestamp:at,semanticTargets:[{...base,bbox:[140,100,80,30]}]}).state,'REIDENTIFYING');
  assert.equal(engine.beforeAction('click').state,'RECOVERING');
});
