import test from 'node:test';
import assert from 'node:assert/strict';
import { auraChatViaSeer } from '../../agents/lib/aura-seer-chat.mjs';
import { auraChatProviderCatalog, manualAuraProviderCompletion } from '../../runtime/src/server/connected/auraOllamaChat.mjs';

function fixture({local=false,usage={prompt_tokens:2,completion_tokens:3},fail=null}={}) {
  const calls=[],costs=[];
  const providers={list:()=>[{id:'custom',baseUrl:local?'http://127.0.0.1:9000/v1':'https://provider.example/v1',defaultModel:'fast',credentialConfigured:true}],chat:async input=>{calls.push(input);if(fail)throw Error(fail);return{content:'answer',model:input.model,usage};}};
  const economic={snapshot:()=>({state:{dailySpentUsd:0,reservedUsd:0}}),authorizeCloud:input=>{costs.push(['reserve',input]);return{allowed:true,reservationId:'r'};},settleCloud:(...args)=>costs.push(['settle',...args]),markCloudOutcomeUnknown:(...args)=>costs.push(['unknown',...args]),releaseReservation:(...args)=>costs.push(['release',...args])};
  return {providers,economic,calls,costs};
}
const prompt={providerId:'custom',model:'fast',system:'system',user:'user'};
const env={JACO_AURA_PROVIDER_PRICES_JSON:JSON.stringify({'custom/fast':{input:0.1,output:0.4}})};
test('Aura receipt attributes a local completion to the selected provider without unknown cloud cost',async()=>{
  const result=await auraChatViaSeer({message:'Explain this file',complete:async()=>({text:'answer',provider:'custom',model:'fast',local:true,costStatus:'LOCAL'})});
  assert.equal(result.providerReceipt.source,'custom/manual-aura-chat');
  assert.equal(result.providerReceipt.costStatus,'LOCAL');
});
test('registered provider catalog excludes credentials and allows configured models',()=>{
  const f=fixture();const list=auraChatProviderCatalog(f.providers,env);
  assert.deepEqual(list[0].pricedModels,['fast']);assert.equal(list[0].credentialReady,true);
  assert.ok(!JSON.stringify(list).includes('baseUrl'));
});
test('loopback providers accept an unset optional credential while remote providers do not',()=>{
  const providers={list:()=>[
    {id:'local',baseUrl:'http://127.0.0.1:11434/v1',apiKeyEnv:'OPTIONAL_KEY',credentialConfigured:false},
    {id:'remote',baseUrl:'https://provider.example/v1',apiKeyEnv:'REQUIRED_KEY',credentialConfigured:false},
  ]};
  const list=auraChatProviderCatalog(providers,{});
  assert.equal(list[0].credentialReady,true);assert.equal(list[1].credentialReady,false);
});
test('selected local provider failure propagates without a second provider call',async()=>{
  const f=fixture({local:true,fail:'SELECTED_PROVIDER_OFFLINE'});
  await assert.rejects(()=>manualAuraProviderCompletion(prompt,{...f,env:{}}),/SELECTED_PROVIDER_OFFLINE/);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].providerId,'custom');
});
test('explicit local provider/model dispatch has no fallback or cloud reservation',async()=>{
  const f=fixture({local:true});const r=await manualAuraProviderCompletion(prompt,{...f,env:{}});
  assert.equal(r.provider,'custom');assert.equal(r.local,true);assert.equal(f.calls[0].model,'fast');assert.equal(f.costs.length,0);
});
test('an unpriced remote model is accounted at the high reference price instead of being refused',async()=>{
  const f=fixture();const r=await manualAuraProviderCompletion(prompt,{...f,env:{}});
  assert.equal(r.costStatus,'SETTLED');assert.equal(f.calls.length,1);
  const reserved=f.costs.find(x=>x[0]==='reserve')[1].estimatedUsd;assert.ok(reserved>0&&reserved<0.25,'worst case stays under the per-task limit');
});
test('cloud suffix cannot bypass budget via localhost',async()=>{
  const f=fixture({local:true});const r=await manualAuraProviderCompletion({...prompt,model:'fast:cloud'},{...f,env:{}});
  assert.equal(r.costStatus,'SETTLED');assert.deepEqual(f.costs.map(x=>x[0]),['reserve','settle'],'reserved and settled like any cloud model');
});
test('priced provider reserves and settles the shared manual-chat budget',async()=>{
  const f=fixture();const r=await manualAuraProviderCompletion(prompt,{...f,env});
  assert.equal(r.costStatus,'SETTLED');assert.deepEqual(f.costs.map(x=>x[0]),['reserve','settle']);assert.equal(f.calls.length,1);
});
test('budget exhaustion prevents dispatch',async()=>{
  const f=fixture();f.economic.authorizeCloud=()=>({allowed:false,reason:'DAILY_BUDGET_LIMIT'});
  await assert.rejects(()=>manualAuraProviderCompletion(prompt,{...f,env}),/DAILY_BUDGET_LIMIT/);assert.equal(f.calls.length,0);
});
test('missing usage and dispatched transport failure remain unknown',async()=>{
  for(const options of [{usage:{}},{fail:'network disconnected'}]) {
    const f=fixture(options);try{await manualAuraProviderCompletion(prompt,{...f,env});}catch{}
    assert.deepEqual(f.costs.map(x=>x[0]),['reserve','unknown']);assert.equal(f.calls.length,1);
  }
});
