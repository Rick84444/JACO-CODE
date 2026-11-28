import test from 'node:test';
import assert from 'node:assert/strict';
import {createSecondaryMotion,contactShadow} from './auraSecondaryMotion.mjs';
test('stationary model stays at authored hair pose',()=>{
  const m=createSecondaryMotion();
  for(let i=0;i<300;i++){const p=m.update({yaw:.2,pitch:.1,z:0},1/60);assert.equal(p.front,0);assert.ok(p.pitch.every(x=>x===0));}
});
test('head turn causes delayed bounded signed hair sway that settles',()=>{
  const m=createSecondaryMotion();let p=m.update({},1/60);
  for(let i=0;i<15;i++)p=m.update({yaw:i*.035},1/60);
  assert.ok(p.yaw[0]<0);assert.ok(p.side<0);
  assert.ok(Math.abs(p.yaw[0])>Math.abs(p.yaw[3]));
  for(let i=0;i<240;i++)p=m.update({yaw:.49},1/60);
  assert.ok(Math.abs(p.side)<.001);assert.ok(p.yaw.every(x=>Math.abs(x)<.001));
});
test('step motion and textile response are bounded; reset clears velocity and pose',()=>{
  const m=createSecondaryMotion();let p;
  for(let i=0;i<1000;i++){p=m.update({z:Math.sin(i*.17),yaw:Math.sin(i*.11),flex:1},.033);assert.ok(Math.abs(p.front)<=.28&&Math.abs(p.back)<=.38&&Math.abs(p.side)<=.38);assert.ok(p.fabric>=0&&p.fabric<=.8);}
  p=m.update({},.033,true);assert.equal(p.front,0);assert.equal(p.fabric,0);assert.ok(p.yaw.every(x=>x===0));
  assert.equal(m.update({},2).side,0);
});
test('airborne contact shadow fades and broadens',()=>{
  assert.ok(contactShadow(.06).opacity<contactShadow(0).opacity);
  assert.ok(contactShadow(.06).scale>contactShadow(0).scale);
});
