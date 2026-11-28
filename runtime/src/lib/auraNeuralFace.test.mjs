import test from 'node:test';
import assert from 'node:assert/strict';
import {FACE_CHANNELS,parseNeuralTimeline,sampleNeuralFace,createNeuralMixer} from './auraNeuralFace.mjs';
const names=FACE_CHANNELS.slice(0,12);
const frame=(t,v)=>[t,...names.map(()=>v)];
const fixture=()=>({protocol:'jaco-a2f/1',names,frames:Array.from({length:11},(_,i)=>frame(i/10,i/10))});
test('retarget by name and interpolate on the media clock, with no gaze ownership',()=>{
 const t=parseNeuralTimeline(fixture(),1),out=new Float32Array(FACE_CHANNELS.length);
 assert.ok(t);assert.ok(sampleNeuralFace(t,.55,out));assert.ok(Math.abs(out[0]-.55)<.00001);
 assert.ok(FACE_CHANNELS.every(n=>!/^(eye|brow)/.test(n)));
 assert.equal(sampleNeuralFace(t,1.1,out),false);assert.ok(out.every(v=>v===0));
});
test('reject malformed, partial, duplicated, nonfinite and unrecognized neural timelines',()=>{
 for(const bad of [{...fixture(),names:['jawOpen']},{...fixture(),names:[...names.slice(0,-1),names[0]]},{...fixture(),frames:[frame(0,0),frame(1,1)]},{...fixture(),frames:[frame(0,0),frame(.1,NaN)]}])assert.equal(parseNeuralTimeline(bad,1),null);
});
test('neural mixer blends in gradually and resets on cancellation',()=>{
 const t=parseNeuralTimeline(fixture(),1),m=createNeuralMixer();
 const a=m.update(t,.5,.016,true);assert.ok(a.active&&a.blend>0&&a.blend<1);
 for(let i=0;i<60;i++)m.update(t,.5,.016,true);
 assert.ok(m.update(t,.5,.016,true).blend>.99);
 assert.equal(m.update(t,.5,.016,false).blend,0);
});
