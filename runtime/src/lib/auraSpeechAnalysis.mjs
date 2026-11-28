import {validSpeechTimeline} from './auraSpeechTimeline.mjs';
// Analysis is separate from the actual output audio graph. It cannot silence playback.
// Browser audio decoding resamples to 16 kHz; the worker never receives microphone data.
export async function analyzeAuraSpeech(blob,signal){
  if(signal?.aborted||!blob||blob.size>8*1024*1024||typeof Worker==='undefined'||typeof OfflineAudioContext==='undefined')return null;
  try{
    const decoder=new OfflineAudioContext(1,1,16000);
    const decoded=await decoder.decodeAudioData(await blob.arrayBuffer());
    if(signal?.aborted||decoded.sampleRate!==16000||decoded.duration>45||decoded.length>720000||decoded.numberOfChannels>8)return null;
    const samples=new Float32Array(decoded.length);
    for(let c=0;c<decoded.numberOfChannels;c++){
      const channel=decoded.getChannelData(c);
      for(let i=0;i<samples.length;i++)samples[i]+=channel[i]/decoded.numberOfChannels;
    }
    return await new Promise(resolve=>{
      let worker,timer,settled=false;
      const done=value=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker?.terminate();resolve(value);};
      const abort=()=>done(null);
      if(signal?.aborted){done(null);return;}
      try{
        worker=new Worker(new URL('./auraSpeechWorker.mjs',import.meta.url),{type:'module'});
        signal?.addEventListener('abort',abort,{once:true});
        timer=setTimeout(()=>done(null),5000);
        worker.onmessage=e=>done(validSpeechTimeline(e.data)?e.data:null);
        worker.onerror=()=>done(null);
        worker.postMessage({samples,sampleRate:16000},[samples.buffer]);
      }catch{done(null);}
    });
  }catch{return null;}
}
