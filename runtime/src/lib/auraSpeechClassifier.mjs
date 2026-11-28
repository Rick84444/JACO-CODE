import {Processor} from './vendor/headaudio/processor.mjs';
import {Training} from './vendor/headaudio/training.mjs';
import * as params from './vendor/headaudio/parameters.mjs';
import {FRAME_SECONDS,SILENCE} from './auraSpeechTimeline.mjs';

export function decodeSpeechModel(buffer){
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==14352||buffer.byteLength%params.RECORD_OFFSET)throw Error('AURA_SPEECH_MODEL_INVALID');
  const training=new Training(),model=[];
  for(let offset=0;offset<buffer.byteLength;offset+=params.RECORD_OFFSET){
    const item=training.decodeBinaryRecord(new Float32Array(buffer,offset,params.RECORD_LEN));
    if(item.viseme<0||item.viseme>14||!item.mu.every(Number.isFinite)||!item.sigmaInvLower.every(Number.isFinite))throw Error('AURA_SPEECH_MODEL_RECORD');
    model.push(item);
  }
  return model;
}
export function classifySpeech(samples,sampleRate,model){
  if(!(samples instanceof Float32Array)||sampleRate!==16000||!samples.length||samples.length>720000||!Array.isArray(model)||!model.length)throw Error('AURA_SPEECH_INPUT');
  const duration=samples.length/sampleRate;
  const n=Math.ceil(duration/FRAME_SECONDS);
  const ids=new Uint8Array(n).fill(SILENCE),levels=new Float32Array(n);
  const events=[];
  const processor=new Processor({sampleRate,processorOptions:{visemeEventsEnabled:false},parameterData:{vadMode:1,silMode:0,vadGateActiveDb:-45,vadGateInactiveDb:-55}}, {port:{postMessage(o){
    if(o.event==='viseme'&&Number.isInteger(o.viseme)&&o.viseme>=0&&o.viseme<14)events.push({t:Math.max(0,o.t-.032),id:o.viseme});
    if(o.event==='ended')events.push({t:Math.max(0,o.t-.032),id:SILENCE});
  }}});
  processor.classifier.import({model,reset:true});
  // Chunking retains the upstream filter and classifier state across all frames.
  for(let i=0;i<samples.length;i+=512)processor.process(samples.subarray(i,i+512));
  events.sort((a,b)=>a.t-b.t);
  let peak=0;
  for(let i=0;i<n;i++){
    const start=i*256,end=Math.min(samples.length,start+256);let sum=0;
    for(let k=start;k<end;k++){const x=samples[k];if(!Number.isFinite(x))throw Error('AURA_SPEECH_NONFINITE');sum+=x*x;}
    levels[i]=Math.sqrt(sum/Math.max(1,end-start));peak=Math.max(peak,levels[i]);
  }
  const floor=Math.max(.0015,peak*.018),scale=Math.max(.012,peak*.50);
  let cursor=0,last=null,classified=0,audible=0;
  for(let i=0;i<n;i++){
    const t=i*FRAME_SECONDS+FRAME_SECONDS*.5;
    while(cursor<events.length&&events[cursor].t<=t)last=events[cursor++];
    const rms=levels[i];
    if(rms<=floor){levels[i]=0;continue;}
    audible++;
    levels[i]=Math.min(1,rms/scale);
    if(last&&t-last.t<.10&&last.id!==SILENCE){ids[i]=last.id;classified++;}
  }
  // Reject an unproductive classifier instead of advertising silence as good sync.
  if(audible>8&&classified/audible<.15)return null;
  return {ids,levels,duration,source:'head-audio-english-experimental'};
}
