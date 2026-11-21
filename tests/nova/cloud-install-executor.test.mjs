import test from 'node:test';
import assert from 'node:assert/strict';
import {executeApprovedInstall,InstallExecutionError} from '../../cloud/install/approved-executor.mjs';
const deviceId='jaco-device-abc123';
const expiry='2031-11-21T00:00:00.000Z';
const sha='a'.repeat(64);
const approval=(recipeId,extra={})=>({
  approved:true,deviceId,recipeId,recipeVersion:'1.0.0',
  approvalId:'approval-test-0001',expiresAt:expiry,...extra,
});
const assertCode=(code)=>e=>e instanceof InstallExecutionError&&e.code===code;
function kit({recipeId='ollama-windows',allow=true,version='0.15.0',wrongModel=false}={}) {
  const commands=[],calls=[],receipts=[],claims=new Set();
  const runCommand=async(file,args,opts)=>{
    commands.push({file,args,opts});
    return {exitCode:0,stdout:'ok',stderr:''};
  };
  const fetchImpl=async(url,options={})=>{
    calls.push({url,options});
    if(url.endsWith('/api/version'))return Response.json({version});
    if(url.endsWith('/api/tags'))return Response.json({models:wrongModel?[]:[{model:'qwen2.5-coder:1.5b',name:'qwen2.5-coder:1.5b',digest:sha}]});
    if(url.endsWith('/api/generate'))return Response.json({response:'READY'});
    return new Response(null,{status:404});
  };
  const grant=approval(recipeId);
  const args={
    recipeId,deviceId,approvalToken:'trusted-grant',localPlatform:'win32',
    approvalVerifier:async()=>allow?{...grant}:null,
    onceClaim:async({approvalId})=>{
      if(claims.has(approvalId))return {claimed:false};
      claims.add(approvalId);
      return {claimed:true,executionId:'execution-test-0001'};
    },
    writeReceipt:async x=>receipts.push(x),
    runCommand,fetchImpl,
  };
  return {args,commands,calls,receipts,claims};
}
test('WinGet installation executes one exact package, no shell, and verifies running Ollama API',async()=>{
  const k=kit();
  const result=await executeApprovedInstall(k.args);
  assert.equal(result.state,'VERIFIED');
  assert.equal(result.result.version,'0.15.0');
  assert.equal(result.agentCount,1);
  assert.deepEqual(k.commands.map(x=>x.file),['winget','ollama']);
  assert.deepEqual(k.commands[0].args,[
    'install','--exact','--id','Ollama.Ollama','--source','winget',
    '--silent','--accept-package-agreements','--accept-source-agreements',
  ]);
  assert.deepEqual(k.commands[1].args,['--version']);
  assert.equal(k.calls[0].url,'http://127.0.0.1:11434/api/version');
  assert.equal(k.receipts.length,1);
});
test('Qwen model pull requires existing Ollama, recorded digest and real completion',async()=>{
  const k=kit({recipeId:'ollama-qwen-coder-1p5b-windows'});
  const result=await executeApprovedInstall(k.args);
  assert.equal(result.state,'VERIFIED');
  assert.equal(result.result.digest,sha);
  assert.equal(result.result.inference,'VERIFIED');
  assert.deepEqual(k.commands.map(x=>[x.file,...x.args]),[
    ['ollama','--version'],['ollama','pull','qwen2.5-coder:1.5b'],
  ]);
  assert.deepEqual(k.calls.map(x=>x.url),[
    'http://127.0.0.1:11434/api/version','http://127.0.0.1:11434/api/tags',
    'http://127.0.0.1:11434/api/generate',
  ]);
  assert.equal(JSON.parse(k.calls[2].options.body).stream,false);
});
test('denied/mismatched/expired/unsupported approval cannot execute or claim',async()=>{
  const k=kit();
  for(const override of [
    {localPlatform:'linux'},
    {approvalVerifier:async()=>null},
    {approvalVerifier:async()=>approval('ollama-windows',{expiresAt:'2020-01-01T00:00:00Z'})},
    {approvalVerifier:async()=>approval('ollama-windows',{deviceId:'other-device-1234'})},
    {approvalVerifier:async()=>approval('ollama-windows',{recipeVersion:'2.0.0'})},
    {approvalVerifier:async()=>approval('ollama-windows',{approvalId:'bad'})},
    {recipeId:'bonsai-llamacpp-existing-windows'},
    {recipeId:'unknown-recipe-id'},
  ]) {
    await assert.rejects(()=>executeApprovedInstall({...k.args,...override}),InstallExecutionError);
  }
  assert.equal(k.commands.length,0);
  assert.equal(k.claims.size,0);
  assert.equal(k.receipts.length,0);
});
test('once-only durable claim prevents duplicate local package installation',async()=>{
  const k=kit();
  await executeApprovedInstall(k.args);
  await assert.rejects(()=>executeApprovedInstall(k.args),assertCode('INSTALL_ALREADY_CLAIMED'));
  assert.equal(k.commands.length,2);
  assert.equal(k.receipts.length,1);
});
test('missing model digest yields failed-or-unknown receipt, never verified',async()=>{
  const k=kit({recipeId:'ollama-qwen-coder-1p5b-windows',wrongModel:true});
  const result=await executeApprovedInstall(k.args);
  assert.equal(result.state,'FAILED_OR_UNKNOWN');
  assert.equal(result.error,'MODEL_DIGEST_NOT_VERIFIED');
  assert.equal(result.result,null);
  assert.equal(k.receipts.length,1);
  assert.equal(result.rollback,'MANUAL_RECONCILIATION_REQUIRED');
});
test('unavailable local API cannot be claimed as a healthy Ollama server',async()=>{
  const k=kit();
  k.args.fetchImpl=async()=>new Response('not ready',{status:503});
  const result=await executeApprovedInstall(k.args);
  assert.equal(result.state,'FAILED_OR_UNKNOWN');
  assert.equal(result.error,'MODEL_API_NOT_READY');
});
test('untrusted remote execution with callback omissions fails closed',async()=>{
  const k=kit();
  await assert.rejects(()=>executeApprovedInstall({...k.args,approvalVerifier:undefined}),assertCode('TRUSTED_DEPENDENCY_MISSING'));
  await assert.rejects(()=>executeApprovedInstall({...k.args,onceClaim:undefined}),assertCode('TRUSTED_DEPENDENCY_MISSING'));
  await assert.rejects(()=>executeApprovedInstall({...k.args,writeReceipt:undefined}),assertCode('TRUSTED_DEPENDENCY_MISSING'));
  assert.equal(k.commands.length,0);
});
