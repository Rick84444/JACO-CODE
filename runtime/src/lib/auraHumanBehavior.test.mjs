import test from 'node:test';
import assert from 'node:assert/strict';
import {createHumanBehavior} from './auraHumanBehavior.mjs';
test('eyes lead head and presentation target releases to neutral',()=>{
  const b=createHumanBehavior();
  const first={...b.update({speaking:true,x:1},.033)};
  assert.ok(first.eyeX>first.headYaw*2);
  let p;for(let i=0;i<60;i++)p=b.update({speaking:true,x:1},.033);
  assert.ok(p.headYaw>.2);
  for(let i=0;i<45;i++)p=b.update({speaking:true},.033);
  assert.ok(Math.abs(p.headYaw)<.035);
});
test('listening overrides speaking and stale panel target',()=>{
  const b=createHumanBehavior();b.cue('present-right');
  let p;for(let i=0;i<20;i++)p=b.update({speaking:true,x:1,level:.8},.033);
  for(let i=0;i<40;i++)p=b.update({listening:true,speaking:true,x:1,level:1},.033);
  assert.equal(p.mode,'listening');assert.equal(p.handBeat,0);assert.equal(p.accent,0);assert.ok(Math.abs(p.headYaw)<.025);
});
test('speech emphasis requires real onset and is refractory',()=>{
  const b=createHumanBehavior();
  let p=b.update({speaking:true,level:0},.033);
  assert.equal(p.handBeat,0);
  p=b.update({speaking:true,level:.8},.033);assert.ok(p.accent>.5);
  let max=0;for(let i=0;i<14;i++){p=b.update({speaking:true,level:.8},.033);max=Math.max(max,p.handBeat);}
  assert.ok(max>.4);
  for(let i=0;i<60;i++)p=b.update({speaking:true,level:0},.033);
  assert.equal(p.handBeat,0);
});
test('reduced motion resets all channels and invalid input stays finite',()=>{
  const b=createHumanBehavior();b.cue('present-right');b.update({x:1,level:1,speaking:true},.1);
  const p=b.update({},.033,true);
  for(const [k,v] of Object.entries(p))if(k!=='mode')assert.equal(v,0,k);
  assert.equal(b.cue('shell'),false);
  for(const v of Object.values(b.update({x:NaN,y:Infinity,level:NaN},NaN)))if(typeof v==='number')assert.ok(Number.isFinite(v));
});
test('idle avoids talk beats, breath and weight remain bounded',()=>{
  const b=createHumanBehavior();for(let i=0;i<3000;i++){const p=b.update({},.033);assert.equal(p.handBeat,0);assert.ok(Math.abs(p.breath)<=1);assert.ok(Math.abs(p.weight)<=.013);}
});
