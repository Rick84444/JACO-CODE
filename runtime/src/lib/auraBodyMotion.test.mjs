import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleWalk,samplePresentation,createBodyMotion,WALK_DISTANCE} from './auraBodyMotion.mjs';
test('four alternating swing phases advance three strides and collect the stance',()=>{
  let prior=0;
  for(let t=0;t<=3;t+=.005){
    const p=sampleWalk(t);
    assert.ok(p.rootZ>=prior-1e-8&&p.rootZ<=WALK_DISTANCE);
    assert.ok(p.leftLift>=0&&p.rightLift>=0&&Math.min(p.leftLift,p.rightLift)<1e-8);
    assert.ok(p.leftLift<=.065&&p.rightLift<=.065);
    prior=p.rootZ;
  }
  const p=sampleWalk(3);
  assert.equal(p.leftZ,WALK_DISTANCE);assert.equal(p.rightZ,WALK_DISTANCE);assert.equal(p.rootZ,WALK_DISTANCE);assert.equal(p.done,true);
});
test('return is a bounded reverse walk; a planted foot never moves during the other swing',()=>{
  for(let i=0;i<4;i++){
    const a=sampleWalk(.65+i*.5+.1,WALK_DISTANCE,0),b=sampleWalk(.65+i*.5+.4,WALK_DISTANCE,0);
    assert.equal(i%2?a.leftZ:a.rightZ,i%2?b.leftZ:b.rightZ);
  }
  assert.equal(sampleWalk(3,WALK_DISTANCE,0).rootZ,0);
});
test('presentation has smooth entry and exit, and requests cannot interrupt a walk',()=>{
  assert.equal(samplePresentation(0),0);assert.equal(samplePresentation(1),1);assert.equal(samplePresentation(4),0);
  const m=createBodyMotion();
  assert.equal(m.request('shell'),false);assert.equal(m.request('advance'),true);assert.equal(m.request('present-left'),false);
  for(let i=0;i<100;i++)m.update(.04);
  assert.equal(m.request('advance'),false);assert.equal(m.request('return'),true);
  assert.equal(m.update(.02,true).rootZ,0);
});

test('weight moves to support side before swing and is bounded',()=>{
  assert.ok(sampleWalk(.55).weightX<-.025);
  assert.ok(sampleWalk(.90).weightX<-.02);
  assert.ok(sampleWalk(1.40).weightX>.02);
  assert.equal(sampleWalk(3).weightX,0);
  for(let t=0;t<3;t+=.01)assert.ok(Math.abs(sampleWalk(t).weightX)<=.035001);
});

// Operator 2026-11-28: "why does she stand like a doll?" The model's rest pose holds the arms out (A-pose).
test('at rest the hands hang beside the thighs, within reach and outside the body',async()=>{
  const {relaxedHandTarget}=await import('./auraBodyMotion.mjs');
  const shoulder={x:.17,y:1.42,z:0},aPoseHand={x:.62,y:1.05,z:.02},reach=.56;
  const h=relaxedHandTarget(shoulder,aPoseHand,reach);
  assert.ok(h.x>shoulder.x&&h.x-shoulder.x<.2,'beside the body on the same side: '+h.x);
  assert.ok(shoulder.y-h.y>.85*reach&&Math.hypot(h.x-shoulder.x,h.y-shoulder.y,h.z-shoulder.z)<reach,'hanging, within reach');
  assert.ok(h.z>shoulder.z,'a little in front of the hip, not behind it');
  const mirrored=relaxedHandTarget({x:-.17,y:1.42,z:0},{x:-.62,y:1.05,z:.02},reach);
  assert.ok(Math.abs(mirrored.x+h.x)<1e-9&&mirrored.y===h.y);
});
