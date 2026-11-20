// Real Core smoke test: a clean bundle and source-static must both serve the same UI.
// No model/tool calls or operator state. Run only after both runtime builds.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { waitReady, inspectStaticUi } from '../agents/lib/local-stack.mjs';

const runtime=fileURLToPath(new URL('../runtime/',import.meta.url));
const manifest=JSON.parse(fs.readFileSync(path.join(runtime,'package.json'),'utf8'));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-core-smoke-'));
async function freePort(){
  const s=net.createServer();
  await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);});
  const port=s.address().port;
  await new Promise(resolve=>s.close(resolve));
  return port;
}
const failures=[];
for(const [mode,args] of [['production',['dist/server.cjs']],['source-static',['--import','tsx','server.ts']]]){
  const state=path.join(root,mode);fs.mkdirSync(state);
  const port=await freePort(),token=randomBytes(32).toString('hex');
  const base='http://127.0.0.1:'+port;
  const env={PATH:process.env.PATH,HOME:state,USERPROFILE:state,TMPDIR:state,
    JACO_STATE_DIR:state,JACO_DATA_DIR:state,JACO_WORKSPACE_ROOT:state,
    JACO_RUNTIME_DIR:runtime,JACO_RELEASE_ROOT:runtime,
    JACO_GATEWAY_TOKEN:token,GATEWAY_TOKEN:token,SEER_TOKEN:token,
    NODE_ENV:'production',PORT:String(port),HOST:'127.0.0.1',
    JACO_AURA_UNIFIED_RUNTIME:'1',JACO_AURA_LEAN:'1',JACO_AUTO_START_TOOLS:'0',
    JACO_ALLOW_PAID_MODELS:'0',JACO_LOCAL_ONLY:'1',JACO_ENABLE_OLLAMA:'0',JACO_ENABLE_CDP:'0',
    JACO_WORKPLACE_REQUIRED:'0',JACO_WORKPLACE_URL:'http://127.0.0.1:9',
    SEER_URL:'http://127.0.0.1:9',JACO_RUNTIME_URL:base};
  const child=spawn(process.execPath,args,{cwd:runtime,env,stdio:['ignore','pipe','pipe']});
  let logs='',spawnError=null;
  child.on('error',e=>{spawnError=e;});
  const append=b=>{logs=(logs+b.toString()).slice(-20000);};
  child.stdout.on('data',append);child.stderr.on('data',append);
  const exited=new Promise(resolve=>child.once('close',resolve));
  try{
    await waitReady({id:mode},token,45000,{child,probeImpl:async()=>{
      if(spawnError)throw spawnError;
      try{
        const r=await fetch(base+'/api/runtime/identity',{signal:AbortSignal.timeout(2000)});
        const v=await r.json();
        return {state:r.ok&&v.success&&v.product==='JACO Autonomus IDE'&&v.version===manifest.version?'READY':'UNHEALTHY'};
      }catch{return {state:'UNREACHABLE'};}
    }});
    const ui=await inspectStaticUi(base);
    assert.equal(ui.state,'HTTP_READY',JSON.stringify(ui));
    console.log('PASS',mode,'identity and actual built GUI entry',ui.entry);
  }catch(e){failures.push(mode+': '+e.message);console.error('FAIL',mode,e.message,logs);}
  finally{
    if(child.exitCode===null&&child.signalCode===null&&!spawnError){
      child.kill('SIGTERM');
      const timer=setTimeout(()=>child.kill('SIGKILL'),5000);timer.unref();
      await exited;clearTimeout(timer);
    }else if(!spawnError){await exited;}
  }
}
fs.rmSync(root,{recursive:true,force:true});
if(failures.length)throw Error(failures.join('\n'));
