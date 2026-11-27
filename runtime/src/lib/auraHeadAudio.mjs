// Adapter for the unmodified MIT HeadAudio modules under public/vendor.
// Only captured playback is passed in; never acquires media or reroutes output.
export const HEAD_AUDIO_VISEMES=Object.freeze(['aa','E','I','O','U','PP','SS','TH','DD','FF','kk','nn','RR','CH','sil'].map(x=>'viseme_'+x));
export const HEAD_AUDIO_MODEL='/branding/aura-headaudio-model.bin';
const RECORD_BYTES=368,MAX_RECORDS=1024;
const zero=()=>Object.fromEntries(HEAD_AUDIO_VISEMES.map(k=>[k,0]));

export function validateHeadAudioModel(buffer){
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<15*RECORD_BYTES||buffer.byteLength%RECORD_BYTES||buffer.byteLength>MAX_RECORDS*RECORD_BYTES)throw Error('AURA_HEAD_AUDIO_MODEL_SIZE');
  const bytes=new DataView(buffer),ids=new Set();
  for(let offset=0;offset<buffer.byteLength;offset+=RECORD_BYTES){
    const id=bytes.getUint8(offset+7);
    if(id>=15)throw Error('AURA_HEAD_AUDIO_MODEL_ID');
    ids.add(id);
    for(let i=8;i<RECORD_BYTES;i+=4){
      const value=bytes.getFloat32(offset+i,true);
      if(!Number.isFinite(value)||Math.abs(value)>1e8)throw Error('AURA_HEAD_AUDIO_MODEL_VALUE');
    }
    // Packed lower triangle of inverse covariance: positive diagonal.
    for(let i=0;i<12;i++){
      if(bytes.getFloat32(offset+56+4*(i*(i+1)/2+i),true)<=0)throw Error('AURA_HEAD_AUDIO_MODEL_COVARIANCE');
    }
  }
  if(ids.size!==15)throw Error('AURA_HEAD_AUDIO_MODEL_COVERAGE');
  return buffer;
}

async function loadNode(ctx,signal){
  if(!ctx?.audioWorklet||typeof globalThis.AudioWorkletNode!=='function')throw Error('AURA_HEAD_AUDIO_UNAVAILABLE');
  const response=await fetch(HEAD_AUDIO_MODEL,{signal,cache:'no-store'});
  if(!response.ok)throw Error('AURA_HEAD_AUDIO_MODEL_NOT_PROVISIONED');
  const length=Number(response.headers.get('content-length'));
  if(length>RECORD_BYTES*MAX_RECORDS)throw Error('AURA_HEAD_AUDIO_MODEL_SIZE');
  const buffer=validateHeadAudioModel(await response.arrayBuffer());
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  const moduleUrl='/vendor/aura-headaudio/headaudio.mjs';
  const {HeadAudio}=await import(/* @vite-ignore */ moduleUrl);
  await ctx.audioWorklet.addModule('/vendor/aura-headaudio/headworklet.mjs');
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  const node=new HeadAudio(ctx,{processorOptions:{visemeEventsEnabled:true,vadEventsEnabled:true},parameterData:{silMode:0}});
  try{
    const model=[];
    for(let offset=0;offset<buffer.byteLength;offset+=RECORD_BYTES){
      model.push(node.training.decodeBinaryRecord(new Float32Array(buffer,offset,RECORD_BYTES/4)));
    }
    node.port.postMessage({event:'reset'});
    node.port.postMessage({event:'model',model},[buffer]);
    return node;
  }catch(error){try{node.stop();node.port.close();}catch{}throw error;}
}

export function createHeadAudioBridge({load=loadNode,now=()=>performance.now()}={}){
  let node=null,source=null,context=null,controller=null,generation=0,last=-Infinity,weights=zero();
  const close=(n,s)=>{
    if(!n)return;
    n.onvalue=n.onviseme=n.onvad=n.onended=n.onprocessorerror=null;
    try{s?.disconnect(n);}catch{}
    try{n.stop();}catch{}
    try{n.port.close();}catch{}
  };
  function detach(){
    generation++;
    controller?.abort();controller=null;
    close(node,source);node=null;source=null;context=null;last=-Infinity;weights=zero();
  }
  function ensure(ctx,input){
    if(ctx===context&&input===source)return;
    detach();context=ctx;source=input;
    if(!ctx||!input)return;
    const token=generation;
    controller=new AbortController();
    const signal=controller.signal;
    // No repeated load attempts for the same source while a model is missing.
    Promise.resolve().then(()=>load(ctx,signal)).then(candidate=>{
      if(token!==generation||signal.aborted){close(candidate,null);return;}
      try{
        node=candidate;
        node.onvalue=(key,value)=>{
          if(token===generation&&Object.hasOwn(weights,key)&&Number.isFinite(value))weights[key]=Math.max(0,Math.min(1,value));
        };
        node.onviseme=event=>{
          if(token===generation&&Number.isInteger(event?.viseme)&&event.viseme>=0&&event.viseme<15)last=now();
        };
        node.onvad=event=>{
          if(token===generation&&event?.inactive){
            node.visemeActive=-1;
            last=now();
          }
        };
        node.onended=()=>{if(token===generation){node.visemeActive=-1;last=now();}};
        node.onprocessorerror=()=>{
          if(token!==generation)return;
          close(node,source);node=null;last=-Infinity;weights=zero();
        };
        input.connect(node);
      }catch{close(candidate,input);node=null;last=-Infinity;weights=zero();}
    }).catch(()=>{});
  }
  return {
    sample(ctx,input,dt,active){
      if(!active||!ctx||!input){if(source||node)detach();return null;}
      ensure(ctx,input);
      if(!node||ctx.state!=='running'||now()-last>250)return null;
      try{node.update(Math.max(0,Math.min(120,Number.isFinite(dt)?dt:0)));return weights;}
      catch{close(node,source);node=null;last=-Infinity;weights=zero();return null;}
    },
    detach
  };
}
