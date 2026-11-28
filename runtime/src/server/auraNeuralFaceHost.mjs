import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {parseNeuralTimeline} from '../lib/auraNeuralFace.mjs';
const MAX_SAMPLES=320000,MAX_OUTPUT=2*1024*1024;
export function createNeuralFaceHost(env=process.env){
  const executable=env.JACO_A2F_EXECUTABLE||'',model=env.JACO_A2F_MODEL_JSON||'';
  const mode=env.JACO_A2F_MODEL_KIND==='diffusion'?'diffusion':'regression';
  let busy=false,backoff=0;
  async function available(){
    if(env.JACO_A2F_ENABLED!=='1'||!isAbsolute(executable)||!isAbsolute(model)||Date.now()<backoff)return false;
    try{await Promise.all([access(executable),access(model)]);return true;}catch{return false;}
  }
  return {available,async analyze(base64,signal){
    if(busy||signal?.aborted||!await available()||busy)return null;
    if(typeof base64!=='string'||base64.length>Math.ceil(MAX_SAMPLES*4/3)*4+4||!(/^[A-Za-z0-9+/]+={0,2}$/).test(base64))return null;
    const pcm=Buffer.from(base64,'base64');
    if(pcm.length%4||pcm.length<320||pcm.length>MAX_SAMPLES*4)return null;
    for(let i=0;i<pcm.length;i+=4){const x=pcm.readFloatLE(i);if(!Number.isFinite(x)||Math.abs(x)>1.01)return null;}
    busy=true;let dir;
    try{
      dir=await mkdtemp(join(tmpdir(),'jaco-a2f-'));
      const input=join(dir,'audio.f32le');await writeFile(input,pcm,{mode:0o600});
      if(signal?.aborted)return null;
      const raw=await new Promise((resolve,reject)=>{
        const child=spawn(executable,[model,mode,input],{shell:false,windowsHide:true,stdio:['ignore','pipe','ignore']});
        let chunks=[],length=0,settled=false;
        const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);error?reject(error):resolve(result);};
        const cancel=()=>{child.kill();finish(Error('A2F_CANCELLED'));};
        const timer=setTimeout(()=>{child.kill();finish(Error('A2F_TIMEOUT'));},8000);
        signal?.addEventListener('abort',cancel,{once:true});
        child.stdout.on('data',data=>{length+=data.length;if(length>MAX_OUTPUT){child.kill();finish(Error('A2F_OUTPUT_LIMIT'));}else chunks.push(data);});
        child.on('error',finish);
        child.on('close',code=>{try{if(code!==0)throw Error('A2F_FAILED');finish(null,JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(error){finish(error);}});
      });
      return parseNeuralTimeline(raw,pcm.length/64000)?raw:null;
    }catch{if(!signal?.aborted)backoff=Date.now()+30000;return null;}
    finally{if(dir)await rm(dir,{recursive:true,force:true}).catch(()=>{});busy=false;}
  }};
}
