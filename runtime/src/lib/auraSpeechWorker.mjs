import {classifySpeech,decodeSpeechModel} from './auraSpeechClassifier.mjs';
let modelPromise;
self.onmessage=async({data})=>{
  try{
    modelPromise??=fetch(new URL('./vendor/headaudio/model-en-mixed.bin',import.meta.url),{redirect:'error'}).then(async r=>{if(!r.ok)throw Error('AURA_SPEECH_MODEL_UNAVAILABLE');return decodeSpeechModel(await r.arrayBuffer());});
    const result=classifySpeech(data.samples,data.sampleRate,await modelPromise);
    if(result)self.postMessage(result,[result.ids.buffer,result.levels.buffer]);else self.postMessage(null);
  }catch{self.postMessage(null);}
};
