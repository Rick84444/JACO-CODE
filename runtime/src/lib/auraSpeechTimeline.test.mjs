import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {VISEMES,SILENCE,FRAME_SECONDS,sampleSpeechPose,approachSpeechPose,emptySpeechPose,createNaturalBlink} from './auraSpeechTimeline.mjs';
import {classifySpeech,decodeSpeechModel} from './auraSpeechClassifier.mjs';
const timeline=(ids,levels=ids.map(i=>i===SILENCE?0:1))=>({ids:Uint8Array.from(ids),levels:Float32Array.from(levels),duration:ids.length*FRAME_SECONDS});
test('all 14 authored mouth shapes are selected by audio clock; silence returns neutral',()=>{
  const t=timeline([...VISEMES.keys(),SILENCE]);
  for(let i=0;i<14;i++){
    const p=sampleSpeechPose(t,i*FRAME_SECONDS);
    assert.ok(p.weights[i]>.65,VISEMES[i]);assert.ok(p.weights.every(Number.isFinite));
    assert.ok(p.jaw<=.20);
  }
  assert.equal(sampleSpeechPose(t,14*FRAME_SECONDS).weights.reduce((a,b)=>a+b),0);
  assert.equal(sampleSpeechPose(t,t.duration).jaw,0);
});
test('bilabial closure wins over open jaw and seeking uses the media clock',()=>{
  const t=timeline([0,5,9,SILENCE]);
  assert.ok(sampleSpeechPose(t,0).jaw>.1);
  const closed=sampleSpeechPose(t,FRAME_SECONDS);
  assert.equal(closed.jaw,0);assert.ok(closed.press>.1);assert.ok(closed.weights[5]>.8);
  assert.ok(sampleSpeechPose(t,FRAME_SECONDS*2).weights[9]>.7);
  assert.ok(sampleSpeechPose(t,0).weights[0]>.7);
});
test('coarticulation is bounded and smooths by elapsed time, not FPS',()=>{
  const t=timeline([0,3]);const p=sampleSpeechPose(t,FRAME_SECONDS*.5);
  assert.ok(p.weights[0]>.3&&p.weights[3]>.3);
  assert.ok(p.weights.reduce((a,b)=>a+b)<=.9);
  const a=emptySpeechPose(),b=emptySpeechPose(),target=sampleSpeechPose(t,0);
  for(let i=0;i<6;i++)approachSpeechPose(a,target,1/60);
  for(let i=0;i<3;i++)approachSpeechPose(b,target,1/30);
  assert.ok(Math.abs(a.jaw-b.jaw)<1e-5);
});
test('blink timing varies and every output is bounded',()=>{
  const blink=createNaturalBlink();let rises=[],prior=0;
  for(let t=0;t<40;t+=.01){const value=blink(t);assert.ok(value>=0&&value<=1);if(value>.3&&prior<=.3)rises.push(t);prior=value;}
  assert.ok(rises.length>=5);assert.ok(new Set(rises.slice(1).map((r,i)=>Math.round((r-rises[i])*10))).size>2);
});
test('real pinned upstream model runs on PCM; all-silence is neutral; malformed inputs rejected',async()=>{
  const bytes=await readFile(new URL('./vendor/headaudio/model-en-mixed.bin',import.meta.url));
  const model=decodeSpeechModel(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  assert.ok(model.length>20);
  const silent=classifySpeech(new Float32Array(16000),16000,model);
  assert.ok(silent);assert.ok(silent.ids.every(i=>i===SILENCE));assert.ok(silent.levels.every(x=>x===0));
  const signal=Float32Array.from({length:16000},(_,i)=>i<4000||i>12000?0:.18*Math.sin(i*.07)+.08*Math.sin(i*.28));
  const result=classifySpeech(signal,16000,model);
  if(result){assert.ok(result.ids.every(i=>i<=14));assert.ok(result.levels.every(x=>Number.isFinite(x)&&x>=0&&x<=1));assert.equal(result.levels[0],0);assert.equal(result.levels.at(-1),0);}
  assert.throws(()=>decodeSpeechModel(new ArrayBuffer(16)),/INVALID/);
  assert.throws(()=>classifySpeech(signal,48000,model),/INPUT/);
});
