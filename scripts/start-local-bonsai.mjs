// Explicit operator-selected local profile for the existing Android Debian Bonsai 4B server.
// No downloads, no second runtime/model, no cloud inference and no secret output.
import fs from 'node:fs';
import path from 'node:path';
import { configuration, activate } from '../agents/lib/local-stack.mjs';
import { testPlannerModel } from '../agents/lib/planner-choice.mjs';
import { synchronizeAuraHarnessModel } from '../agents/lib/aura-harness-model-choice.mjs';

const endpoint='http://127.0.0.1:9380/v1', model='bonsai-4b';
async function main(){
  Object.assign(process.env,{
    JACO_START_MODE:'source-static',JACO_AURA_UNIFIED_RUNTIME:'1',
    JACO_AURA_LEAN:'1',JACO_AUTO_START_TOOLS:'0',
    JACO_LOCAL_ONLY:'1',JACO_ALLOW_PAID_MODELS:'0',JACO_ENABLE_OLLAMA:'0',
    JACO_LLAMACPP_URL:endpoint,JACO_LLAMACPP_MODEL:model,JACO_LLAMACPP_MODEL_ALIAS:model,
    JACO_NOVA_NATIVE_TOOLS:'0',NOVA_CONTEXT_PROFILE:'compact',
    JACO_WORKPLACE_SUPERVISE_MODEL:'0',
    JACO_ENABLE_CDP:'0',JACO_ENABLE_CHATGPT_GATEWAY:'0',JACO_START_TUNNEL:'0'
  });
  const c=configuration();
  if(c.env.GATEWAY_TOKEN.length<24)throw Error('GATEWAY_TOKEN_REQUIRED_MIN_24');
  if(fs.existsSync(path.join(c.dataRoot,'.jaco-emergency-stop.json')))throw Error('EMERGENCY_STOP_ACTIVE');
  const lock=path.join(c.dataRoot,'logs/startup/startup.lock');
  if(fs.existsSync(lock)){
    const pid=Number(fs.readFileSync(lock,'utf8'));
    if(!Number.isSafeInteger(pid)||pid<1)throw Error('STARTUP_LOCK_INVALID:inspect legacy lock before retry');
    try { process.kill(pid,0);throw Error('STARTUP_ALREADY_IN_PROGRESS'); }
    catch(e){if(e.code!=='ESRCH')throw e;}
  }
  const response=await fetch(endpoint+'/models',{redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('BONSAI_MODELS_HTTP_'+response.status);
  const listed=(await response.json()).data;
  const entry=Array.isArray(listed)&&listed.find(x=>x.id===model);
  if(!entry)throw Error('BONSAI_4B_NOT_LISTED');
  const ctx=entry.meta?.n_ctx;
  if(!Number.isInteger(ctx)||ctx<4096)throw Error('BONSAI_CONTEXT_UNVERIFIED');
  c.env.JACO_LLAMACPP_CTX=String(ctx);
  process.env.JACO_LLAMACPP_CTX=String(ctx);
  const extra={llamacpp:{label:'llama.cpp local',paid:false,keyEnv:null,url:endpoint+'/chat/completions',models:[model]}};
  const proof=await testPlannerModel({provider:'llamacpp',model},{env:c.env,extra,timeoutMs:90000});
  if(!proof.ok||!proof.verifiedText)throw Error('BONSAI_TEXT_PROBE_FAILED:'+String(proof.error||'no text'));
  await synchronizeAuraHarnessModel({providerId:'llamacpp',model},{file:c.env.JACO_PLANNER_CHOICE_FILE,env:c.env,connectedChoices:extra,probe:async()=>proof});
  console.log('BONSAI TEXT VERIFIED',model,'context='+ctx,'ms='+proof.latencyMs,'native-tools=UNVERIFIED');
  const result=await activate(c,{open:false});
  console.log(JSON.stringify(result,null,2));
  const core=result.services?.find(x=>x.id==='runtime'&&x.state==='READY');
  if(core)console.log('JACO GUI',new URL(core.url).origin);
  if(result.state!=='READY')process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
