import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuraSplatProvider,presentationState} from '../../runtime/src/lib/auraSplatProvider.mjs';

function fixtures(){
  const events=[];
  class Context {
    state='running';
    createGain(){return {disconnect(){events.push('gain:disconnect');}};}
    createMediaStreamSource(stream){
      events.push(['stream',stream]);
      return {connect(gain){events.push('source:connect');},disconnect(){events.push('source:disconnect');}};
    }
    close(){events.push('context:close');return Promise.resolve();}
  }
  class SplatRenderer {constructor(options){events.push(['renderer',options]);}dispose(){events.push('renderer:dispose');}}
  const head={setState(state){events.push(['state',state]);},cut(){events.push('cut');},pause(){events.push('pause');},resume(){events.push('resume');},dispose(){events.push('head:dispose');}};
  const doc=new EventTarget();doc.hidden=false;
  const mod={SplatRenderer,async createTalkingHead(options){events.push(['options',options]);return head;}};
  return {events,doc,mod,head,options:{loadModule:async()=>mod,AudioContextClass:Context,doc,reducedMotion:()=>false}};
}

test('presentation state maps only existing Aura flags',()=>{
  assert.equal(presentationState({}), 'idle');
  assert.equal(presentationState({active:true}), 'thinking');
  assert.equal(presentationState({active:true,listening:true}), 'listening');
  assert.equal(presentationState({listening:true,speaking:true}), 'speaking');
});
test('local renderer uses only a captured playback tap and never routes to speakers',async()=>{
  const f=fixtures();const provider=await createAuraSplatProvider({},f.options);
  const o=f.events.find(e=>Array.isArray(e)&&e[0]==='options')[1];
  assert.equal(o.destination,null);assert.equal(o.delay,0);assert.equal(o.avatarUrl,'/aura-splat/head.zip');
  assert.equal(o.extractor,'formant');assert.equal(o.fallback,false);
  const stream={getTracks(){throw Error('must not own or stop tracks');}};
  provider.setState({speaking:true,audioSource:stream});
  provider.setState({speaking:true,audioSource:stream});
  assert.equal(f.events.filter(e=>e==='source:connect').length,1);
  provider.setState({speaking:false,audioSource:null});
  assert.ok(f.events.includes('source:disconnect'));assert.ok(f.events.includes('cut'));
  f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));assert.ok(f.events.includes('pause'));
  provider.dispose();provider.dispose();
  assert.equal(f.events.filter(e=>e==='context:close').length,1);
  assert.equal(f.events.filter(e=>e==='head:dispose').length,1);
  provider.setState({speaking:true,audioSource:stream});
  assert.equal(f.events.filter(e=>e==='source:connect').length,1);
});
test('reduced motion fails before loading the module',async()=>{
  const f=fixtures();let loaded=false;
  await assert.rejects(createAuraSplatProvider({}, {...f.options,reducedMotion:()=>true,loadModule:async()=>{loaded=true;return f.mod;}}),/SPLAT_DISABLED/);
  assert.equal(loaded,false);
});
test('initialization rejection closes owned context and renderer',async()=>{
  const f=fixtures();f.mod.createTalkingHead=async()=>{throw Error('missing head');};
  await assert.rejects(createAuraSplatProvider({},f.options),/missing head/);
  assert.ok(f.events.includes('renderer:dispose'));assert.ok(f.events.includes('context:close'));
});
test('late initialization after abort is disposed, not published',async()=>{
  const f=fixtures(),controller=new AbortController();
  let resolveHead,entered;
  const ready=new Promise(resolve=>{entered=resolve;});
  f.mod.createTalkingHead=()=>{entered();return new Promise(resolve=>{resolveHead=resolve;});};
  const pending=createAuraSplatProvider({}, {...f.options,signal:controller.signal});
  await ready;controller.abort();resolveHead(f.head);
  await assert.rejects(pending,/SPLAT_ABORTED/);
  assert.ok(f.events.includes('head:dispose'));
  assert.equal(f.events.filter(e=>e==='context:close').length,1);
});
