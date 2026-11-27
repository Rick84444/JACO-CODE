import test from 'node:test';
import assert from 'node:assert/strict';
import {createHeadAudioBridge,validateHeadAudioModel,HEAD_AUDIO_VISEMES} from '../../runtime/src/lib/auraHeadAudio.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  const buffer=new ArrayBuffer(15*368),view=new DataView(buffer);
  for(let j=0;j<15;j++){
    const p=j*368;view.setUint8(p+7,j);
    for(let i=0;i<12;i++)view.setFloat32(p+56+4*(i*(i+1)/2+i),1,true);
  }
  return buffer;
}
test('validate full 15-class model record format, reject malformed or incomplete data',()=>{
  assert.equal(HEAD_AUDIO_VISEMES.length,15);
  assert.equal(validateHeadAudioModel(fixture()).byteLength,5520);
  assert.throws(()=>validateHeadAudioModel(new ArrayBuffer(12)),/SIZE/);
  let b=fixture(),v=new DataView(b);v.setUint8(7,15);assert.throws(()=>validateHeadAudioModel(b),/ID/);
  b=fixture();v=new DataView(b);v.setFloat32(8,NaN,true);assert.throws(()=>validateHeadAudioModel(b),/VALUE/);
  b=fixture();v=new DataView(b);v.setFloat32(56,0,true);assert.throws(()=>validateHeadAudioModel(b),/COVARIANCE/);
  b=fixture();v=new DataView(b);v.setUint8(7,1);assert.throws(()=>validateHeadAudioModel(b),/COVERAGE/);
});
test('bridge observes real event heartbeat, disconnects only its branch and clears stale data',async()=>{
  let t=0,stopped=0,closed=0,connected=0,disconnected=0;
  const n={stop(){stopped++},port:{close(){closed++}},update(){this.onvalue('viseme_PP',.7);this.onvalue('bad',1)}};
  const source={connect(x){assert.equal(x,n);connected++},disconnect(x){assert.equal(x,n);disconnected++}};
  const ctx={state:'running'},b=createHeadAudioBridge({load:async()=>n,now:()=>t});
  assert.equal(b.sample(ctx,source,16,true),null);await flush();
  assert.equal(connected,1);assert.equal(b.sample(ctx,source,16,true),null);
  n.onviseme({viseme:5});assert.equal(b.sample(ctx,source,16,true).viseme_PP,.7);
  t=251;assert.equal(b.sample(ctx,source,16,true),null);
  assert.equal(b.sample(ctx,source,16,false),null);
  assert.equal(disconnected,1);assert.equal(stopped,1);assert.equal(closed,1);
});
test('late async worklet cannot reconnect after detach',async()=>{
  let resolve,connected=0,closed=0;
  const n={stop(){},port:{close(){closed++}}},ctx={state:'running'},source={connect(){connected++}};
  const b=createHeadAudioBridge({load:()=>new Promise(r=>{resolve=r;})});
  b.sample(ctx,source,16,true);await flush();b.detach();resolve(n);await flush();
  assert.equal(connected,0);assert.equal(closed,1);
});
test('missing model is explicit fallback, not repeated fetches per frame',async()=>{
  let calls=0;const b=createHeadAudioBridge({load:async()=>{calls++;throw Error('missing')}});
  const ctx={state:'running'},source={};
  b.sample(ctx,source,16,true);await flush();
  for(let i=0;i<100;i++)assert.equal(b.sample(ctx,source,16,true),null);
  assert.equal(calls,1);b.detach();
});
