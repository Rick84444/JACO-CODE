import {parseNeuralTimeline} from './auraNeuralFace.mjs';
let nextProbe=0,ready=false;
export async function analyzeNeuralFace(samples,signal){
  if(signal?.aborted||samples.length>320000||typeof fetch!=='function')return null;
  try{
    if(Date.now()>=nextProbe){
      nextProbe=Date.now()+15000;ready=false;
      const status=await fetch('/api/aura/face/health',{signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(600)]),cache:'no-store'});
      ready=status.ok&&(await status.json()).available===true;
    }
    if(!ready||signal?.aborted)return null;
    const bytes=new Uint8Array(samples.buffer,samples.byteOffset,samples.byteLength);
    let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));
    const r=await fetch('/api/aura/face/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pcm:btoa(s)}),signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(4500)])});
    return r.ok?parseNeuralTimeline(await r.json(),samples.length/16000):null;
  }catch{return null;}
}
