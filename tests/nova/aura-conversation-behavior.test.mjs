import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationFloor,createConversationBehavior} from '../../runtime/src/lib/auraConversationBehavior.mjs';
test('observed speech and receptive microphone are distinct from mission activity',()=>{
  assert.equal(conversationFloor({active:true}),'idle');
  assert.equal(conversationFloor({listening:true}),'receptive');
  assert.equal(conversationFloor({listening:true,userSpeaking:true}),'user-speaking');
  assert.equal(conversationFloor({awaitingReply:true}),'awaiting');
  assert.equal(conversationFloor({preparingSpeech:true,awaitingReply:true}),'preparing');
  assert.equal(conversationFloor({speechPlaying:true,awaitingReply:true}),'speaking');
  assert.equal(conversationFloor({speaking:true}),'idle');
});
test('question posture is bounded and settles without repetitive gestures',()=>{
  const a=createConversationBehavior(),b=createConversationBehavior();
  a.sample(0);b.sample(0);
  let peak=0,last=0;
  for(let i=1;i<=360;i++){
    const t=i/60,s={speechPlaying:i>180,speechAct:'question'};
    const x=a.sample(t,s),y=b.sample(t,{...s,speechAct:'neutral'});
    assert.ok(x.attention>=0&&x.attention<=1&&Math.abs(x.roll)<.05&&x.brow<=.081&&x.gesture<=.046);
    if(i>180){assert.ok(x.brow>=y.brow);peak=Math.max(peak,x.gesture);}
    if(i===360)last=x.gesture;
  }
  assert.ok(peak>.005);assert.ok(last<.00001);
});
test('interrupt releases gesture and listening wins once audio stops',()=>{
  const c=createConversationBehavior();for(let i=0;i<181;i++)c.sample(i/60);
  for(let i=181;i<211;i++)c.sample(i/60,{speechPlaying:true});
  const before=c.sample(211/60,{speechPlaying:true}).gesture;
  assert.ok(before>0);
  const x=c.sample(212/60,{listening:true,userSpeaking:true});
  assert.equal(x.floor,'user-speaking');assert.ok(x.gesture<before);
  for(let i=213;i<280;i++)c.sample(i/60,{listening:true});
  assert.ok(c.sample(280/60,{listening:true}).gesture<.00001);
});
test('speech end yields briefly, new user turn takes priority, clock reset and reduced motion are safe',()=>{
  const c=createConversationBehavior();c.sample(0,{speechPlaying:true});
  assert.equal(c.sample(.1,{}).floor,'yielding');
  assert.equal(c.sample(.2,{listening:true}).floor,'receptive');
  assert.equal(c.sample(10,{}).gesture,0);
  assert.equal(c.sample(10.1,{speechPlaying:true},true).motion,0);
  assert.equal(c.sample(NaN,{}).gesture,0);
});
test('same elapsed time gives same settled posture across frame rates',()=>{
  function run(fps){const c=createConversationBehavior();c.sample(0);for(let i=1;i<=fps;i++)c.sample(i/fps,{listening:true});return {...c.sample(1,{listening:true})};}
  // Transition detection may differ by one frame, but target integration is time-based.
  assert.ok(Math.abs(run(15).attention-run(60).attention)<.000001);
});
