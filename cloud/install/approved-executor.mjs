// Fixed local installer actions. NOT an HTTP route or a generic shell bridge.
// A paired local host must supply trusted approval verification plus a durable,
// atomic once-only installation claim and append-only result recorder.
// No remote recipe may supply a command, arguments, URL or filesystem path.
import {execFile as execFileCb} from 'node:child_process';
import {promisify} from 'node:util';
import {installRecipe} from '../../site/jacocode.com/install-recipes.mjs';

const execFile=promisify(execFileCb);
const EXECUTABLE=new Set(['ollama-windows','ollama-qwen-coder-1p5b-windows']);
const MODEL='qwen2.5-coder:1.5b';
const ORIGIN='http://127.0.0.1:11434';
const APPROVAL_ID=/^[A-Za-z0-9._:-]{12,128}$/;
const DEVICE_ID=/^[A-Za-z0-9_-]{8,100}$/;

export class InstallExecutionError extends Error {
  constructor(code) { super(code);this.name='InstallExecutionError';this.code=code; }
}
export async function defaultRunCommand(file,args,{timeoutMs=20*60_000}={}) {
  if(!Array.isArray(args)||args.some(x=>typeof x!=='string')) throw new InstallExecutionError('ARGUMENTS_INVALID');
  // execFile never invokes a command shell. No remote command strings accepted.
  const {stdout,stderr}=await execFile(file,args,{
    windowsHide:true,shell:false,timeout:timeoutMs,maxBuffer:128*1024,
  });
  return {exitCode:0,stdout:String(stdout).slice(0,2048),stderr:String(stderr).slice(0,2048)};
}
async function jsonApi(fetchImpl,path,{method='GET',body}={}) {
  const url=ORIGIN+path;
  const response=await fetchImpl(url,{
    method,headers:body?{'content-type':'application/json'}:{},
    body:body?JSON.stringify(body):undefined,
    signal:AbortSignal.timeout(10_000),
  });
  if(!response?.ok) throw new InstallExecutionError('MODEL_API_NOT_READY');
  // Bound response to avoid untrusted local endpoint returning infinite data.
  const raw=await response.text();
  if(raw.length>256_000) throw new InstallExecutionError('MODEL_API_RESPONSE_TOO_LARGE');
  try{return JSON.parse(raw);}catch{throw new InstallExecutionError('MODEL_API_RESPONSE_INVALID');}
}
async function checkOllama({runCommand,fetchImpl}) {
  const binary=await runCommand('ollama',['--version'],{timeoutMs:10_000});
  if(binary.exitCode!==0) throw new InstallExecutionError('OLLAMA_CLI_FAILED');
  const version=await jsonApi(fetchImpl,'/api/version');
  if(typeof version.version!=='string'||!version.version.trim()) throw new InstallExecutionError('OLLAMA_VERSION_UNVERIFIED');
  return {version:version.version,endpoint:ORIGIN};
}
async function runOllamaInstall(deps) {
  const receipt=await deps.runCommand('winget',[
    'install','--exact','--id','Ollama.Ollama','--source','winget',
    '--silent','--accept-package-agreements','--accept-source-agreements',
  ],{timeoutMs:20*60_000});
  if(receipt.exitCode!==0) throw new InstallExecutionError('WINGET_INSTALL_FAILED');
  const checked=await checkOllama(deps);
  return {...checked,package:'Ollama.Ollama',packageVerification:'LOCAL_CLI_AND_API_PROBED'};
}
async function runQwenInstall(deps) {
  await checkOllama(deps);
  const result=await deps.runCommand('ollama',['pull',MODEL],{timeoutMs:40*60_000});
  if(result.exitCode!==0) throw new InstallExecutionError('OLLAMA_PULL_FAILED');
  const list=await jsonApi(deps.fetchImpl,'/api/tags');
  const found=list.models?.find(model=>model.name===MODEL || model.model===MODEL);
  if(!found||typeof found.digest!=='string'||!(/^[0-9a-f]{64}$/i.test(found.digest))) {
    throw new InstallExecutionError('MODEL_DIGEST_NOT_VERIFIED');
  }
  const generated=await jsonApi(deps.fetchImpl,'/api/generate',{
    method:'POST',body:{model:MODEL,prompt:'Reply with the word READY.',stream:false,options:{num_predict:24}},
  });
  if(typeof generated.response!=='string'||!generated.response.trim()) {
    throw new InstallExecutionError('MODEL_INFERENCE_FAILED');
  }
  return {provider:'ollama',model:MODEL,digest:found.digest,inference:'VERIFIED',endpoint:ORIGIN};
}

/**
 * The caller is an authenticated *local* Sentinel installation integration.
 * approvalVerifier is responsible for a signed decision bound to tenant,
 * current paired device, scopes, package, expiry and revocation.
 * onceClaim must be backed by a persistent atomic UNIQUE approval ID constraint.
 * writeReceipt must append a durable signed receipt (may throw on storage failure).
 */
export async function executeApprovedInstall({
  recipeId, deviceId, approvalToken, localPlatform=process.platform,
  approvalVerifier, onceClaim, writeReceipt, runCommand=defaultRunCommand,
  fetchImpl=globalThis.fetch,
}) {
  if(localPlatform!=='win32') throw new InstallExecutionError('WINDOWS_ONLY');
  if(typeof deviceId!=='string'||!DEVICE_ID.test(deviceId)) throw new InstallExecutionError('DEVICE_INVALID');
  if(typeof approvalVerifier!=='function'||typeof onceClaim!=='function'||
     typeof writeReceipt!=='function'||typeof runCommand!=='function'||
     typeof fetchImpl!=='function') throw new InstallExecutionError('TRUSTED_DEPENDENCY_MISSING');
  let recipe;
  try { recipe=installRecipe(recipeId,'windows'); }
  catch {throw new InstallExecutionError('RECIPE_NOT_ALLOWED');}
  if(!EXECUTABLE.has(recipeId)||recipe.status!=='RUNNER_IMPLEMENTED')
    throw new InstallExecutionError('RECIPE_NOT_EXECUTABLE');
  const grant=await approvalVerifier({
    approvalToken,deviceId,recipeId,recipeVersion:recipe.version,
    permissions:recipe.approvals,
  });
  if(!grant || grant.approved!==true || grant.deviceId!==deviceId ||
     grant.recipeId!==recipeId || grant.recipeVersion!==recipe.version ||
     typeof grant.tenantId!=='string'||!grant.tenantId ||
     typeof grant.subject!=='string'||!grant.subject ||
     !Array.isArray(grant.scopes)||!grant.scopes.includes('install:execute') ||
     !Array.isArray(grant.permissions)||
     !recipe.approvals.every(p=>grant.permissions.includes(p)) ||
     typeof grant.approvalId!=='string' || !APPROVAL_ID.test(grant.approvalId) ||
     typeof grant.expiresAt!=='string' || !Number.isFinite(Date.parse(grant.expiresAt)) ||
     Date.parse(grant.expiresAt)<=Date.now()) {
    throw new InstallExecutionError('APPROVAL_NOT_VALID');
  }
  // Claim before first side effect. Ambiguous network/host crash is UNKNOWN,
  // never an automatic second install; a separate audited reconcile is needed.
  const claimed=await onceClaim({
    approvalId:grant.approvalId,tenantId:grant.tenantId,deviceId,
    recipeId,recipeVersion:recipe.version,
  });
  if(!claimed || claimed.claimed!==true || !APPROVAL_ID.test(String(claimed.executionId||''))) {
    throw new InstallExecutionError('INSTALL_ALREADY_CLAIMED');
  }
  const base={schema:'jaco.install-receipt/v1',
    executionId:claimed.executionId,approvalId:grant.approvalId,
    tenantId:grant.tenantId,deviceId,recipeId,recipeVersion:recipe.version,agent:'Aura',agentCount:1,
  };
  let details=null, failure=null;
  try {
    const deps={runCommand,fetchImpl};
    details=recipeId==='ollama-windows'?await runOllamaInstall(deps):await runQwenInstall(deps);
  } catch(e) {
    failure=e instanceof InstallExecutionError?e.code:'INSTALL_OUTCOME_UNKNOWN';
  }
  const receipt={...base,state:failure?'FAILED_OR_UNKNOWN':'VERIFIED',
    result:details,error:failure,rollback:'MANUAL_RECONCILIATION_REQUIRED',
    // Installing or downloading externally managed programs cannot be safely
    // undone automatically without checking other workloads/users.
  };
  await writeReceipt(receipt);
  return receipt;
}
