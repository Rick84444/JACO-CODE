import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {freshMissionFrame,permittedFrameMessages} from '../../agents/lib/mission-screen-frame.mjs';
import {NovaTractionEngine} from '../../runtime/src/server/nova/tractionCore.mjs';
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
  assert.equal(local.at(-1).content[1].type,'image_url');assert.equal(messages.length,1);
  const remote=permittedFrameMessages(messages,frame,{url:'https://remote.example/v1/chat'},{});
  assert.match(remote.at(-1).content,/not permitted/);
  assert.ok(!JSON.stringify(remote).includes('base64'));
  assert.equal(permittedFrameMessages(messages,frame,{url:'https://remote.example'},{NOVA_ALLOW_CLOUD_IMAGES:'1'}).at(-1).content[1].type,'image_url');
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
