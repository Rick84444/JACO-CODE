import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { EconomicGovernor } from '../../runtime/src/server/continuum/economicGovernor.mjs';
import { createEconomicBudgetRouter } from '../../runtime/src/server/connected/economicBudget.mjs';
import { manualAuraProviderCompletion } from '../../runtime/src/server/connected/auraOllamaChat.mjs';
import { novaProviderCostUsd } from '../../runtime/src/server/connected/auraOllamaChat.mjs';
import { budgetedNovaOllamaCall } from '../../agents/lib/nova-ollama-cost.mjs';
const express = createRequire(new URL('../../runtime/package.json', import.meta.url))('express');
function governor(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-budget-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return new EconomicGovernor(root,{append(){}});
}

test('DeepSeek and Ollama share the GUI ceiling; unknown prices use the high reference price', t => {
  const g=governor(t);g.updatePolicy({novaOllamaCloudEnabled:true,dailyCloudUsd:1,maxCloudUsdPerTask:1});
  const env={JACO_AURA_PROVIDER_PRICES_JSON:JSON.stringify({'deepseek/configured':{input:1,output:2}}),JACO_OLLAMA_CLOUD_PRICES_JSON:JSON.stringify({configured:{input:1,output:2}})};
  const cost=novaProviderCostUsd('deepseek','configured',200000,200000,env);
  const r=g.authorizeCloud({estimatedUsd:cost,purpose:'nova-ollama-cloud',metadata:{providerId:'deepseek'}});
  assert.equal(r.allowed,true);g.settleCloud(r.reservationId,cost);
  assert.equal(g.authorizeCloud({estimatedUsd:novaProviderCostUsd('ollama-cloud','configured',200000,200000,env),purpose:'nova-ollama-cloud'}).reason,'DAILY_BUDGET_LIMIT');
  assert.equal(novaProviderCostUsd('deepseek','unpriced',1000000,1000000,env),18,'reference 3 + 15 USD per 1M tokens');
  assert.equal(novaProviderCostUsd('openrouter','some-model:free',1000000,1000000,env),0);
});

test('Nova reserves DeepSeek cost before dispatch and never dispatches on denial',async()=>{
  let calls=0;
  await assert.rejects(budgetedNovaOllamaCall({provider:{name:'deepseek',model:'configured',key:'fixture',url:'https://provider.invalid'},requestBody:{max_tokens:32768},runtimeUrl:'http://fixture.invalid',token:'fixture',fetchImpl:async(url,opts)=>{
    calls++;assert.ok(url.endsWith('/reserve'));assert.equal(JSON.parse(opts.body).providerId,'deepseek');
    return Response.json({success:false,error:'DAILY_BUDGET_LIMIT'},{status:403});
  }}),/DAILY_BUDGET_LIMIT/);
  assert.equal(calls,1);
});
test('Aura uses the configured shared ceiling above the old one dollar cap',async t=>{
  const g=governor(t);g.updatePolicy({manualAuraCloudEnabled:true,novaOllamaCloudEnabled:true,dailyCloudUsd:2,maxCloudUsdPerTask:2});
  const initial=g.authorizeCloud({estimatedUsd:1.2,purpose:'nova-ollama-cloud'});assert.equal(initial.allowed,true);g.settleCloud(initial.reservationId,1.2);
  let dispatched=0;
  const providers={list:()=>[{id:'priced',baseUrl:'https://fixture.example/v1',defaultModel:'any-model',credentialConfigured:true}],chat:async()=>{++dispatched;return{content:'fixture',usage:{prompt_tokens:2,completion_tokens:3}};}};
  const call=()=>manualAuraProviderCompletion({providerId:'priced',model:'any-model',system:'s',user:'u'},{providers,economic:g,env:{JACO_AURA_PROVIDER_PRICES_JSON:'{"priced/any-model":{"input":1,"output":2}}'}});
  assert.equal((await call()).costStatus,'SETTLED');assert.equal(dispatched,1);
  g.updatePolicy({dailyCloudUsd:1});
  await assert.rejects(call,/DAILY_BUDGET_LIMIT/);assert.equal(dispatched,1);
});
test('reservations remain effective after lowering limits and restarting',t=>{
  const g=governor(t);g.updatePolicy({dailyCloudUsd:2,manualAuraCloudEnabled:true,novaOllamaCloudEnabled:true});
  const r=g.authorizeCloud({estimatedUsd:0.2,purpose:'manual-aura-chat'});g.markCloudOutcomeUnknown(r.reservationId);
  g.updatePolicy({dailyCloudUsd:0.1});
  const recovered=new EconomicGovernor(path.dirname(g.policyFile),{append(){}});
  assert.equal(recovered.snapshot().policy.dailyCloudUsd,0.1);
  assert.equal(recovered.snapshot().state.reservedUsd,0.2);
  assert.equal(recovered.authorizeCloud({estimatedUsd:0.01,purpose:'nova-ollama-cloud'}).reason,'DAILY_BUDGET_LIMIT');
});
test('invalid policy patches cannot mutate saved or in-memory policy',t=>{
  const g=governor(t);g.updatePolicy({dailyCloudUsd:1});const before=fs.readFileSync(g.policyFile,'utf8'),policy=g.snapshot().policy;
  for(const patch of [{dailyCloudUsd:-1},{dailyCloudUsd:Infinity},{dailyCloudUsd:'2'},{monthlyCloudUsd:null},{cloudEnabled:'false'},{warningAtPercent:101}])assert.throws(()=>g.updatePolicy(patch),/ECONOMIC_POLICY/);
  assert.equal(fs.readFileSync(g.policyFile,'utf8'),before);assert.deepEqual(g.snapshot().policy,policy);
});
test('a saved operator cloud-off policy overrides stale environment opt-in',t=>{
  const g=governor(t);g.updatePolicy({cloudEnabled:false});
  const old=process.env.JACO_CLOUD_ENABLED;process.env.JACO_CLOUD_ENABLED='true';
  try{const recovered=new EconomicGovernor(path.dirname(g.policyFile),{append(){}});assert.equal(recovered.snapshot().policy.cloudEnabled,false);}
  finally{if(old===undefined)delete process.env.JACO_CLOUD_ENABLED;else process.env.JACO_CLOUD_ENABLED=old;}
});
test('failed persistence does not activate a new budget in memory',t=>{
  const g=governor(t);g.updatePolicy({dailyCloudUsd:1});const before=g.snapshot().policy;
  fs.unlinkSync(g.policyFile);fs.mkdirSync(g.policyFile);
  assert.throws(()=>g.updatePolicy({dailyCloudUsd:100}));assert.deepEqual(g.snapshot().policy,before);
});
test('operator budget HTTP route validates permission, origin and fields and persists through reload',async t=>{
  const g=governor(t),app=express();app.use(express.json());
  app.use('/budget',createEconomicBudgetRouter({economic:g,requireOperatorUi:(req,res,next)=>req.get('x-test-operator')==='yes'?next():res.status(403).json({success:false})}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port+'/budget';
  assert.equal((await fetch(url)).status,403);
  const headers={'x-test-operator':'yes','content-type':'application/json'};
  assert.equal((await fetch(url,{method:'PATCH',headers:{...headers,origin:'https://foreign.example'},body:'{"dailyCloudUsd":2}'})).status,403);
  for(const body of [{dailyCloudUsd:'2'},{dailyCloudUsd:-1},{cloudEnabled:'true'},{autoApprove:true},{}])assert.equal((await fetch(url,{method:'PATCH',headers,body:JSON.stringify(body)})).status,400);
  const changed=await fetch(url,{method:'PATCH',headers,body:'{"dailyCloudUsd":2,"monthlyCloudUsd":20,"maxCloudUsdPerTask":0.05}'}).then(r=>r.json());
  assert.equal(changed.success,true);assert.equal(changed.economic.policy.dailyCloudUsd,2);assert.equal(changed.economic.policy.cloudEnabled,false);
  const observed=await fetch(url,{headers}).then(r=>r.json());assert.equal(observed.economic.policy.maxCloudUsdPerTask,0.05);
  const restarted=new EconomicGovernor(path.dirname(g.policyFile),{append(){}});assert.equal(restarted.snapshot().policy.dailyCloudUsd,2);
});

test('an unsettled reservation stops holding headroom once it is older than any call: counted as spent on its own day', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-budget-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString();
  const stale = new Date(now.getTime() - 40 * 60_000).toISOString();
  const fresh = new Date(now.getTime() - 60_000).toISOString();
  const res = (id, createdAt, usd) => [id, { reservationId: id, estimatedUsd: usd, purpose: 'nova-ollama-cloud', createdAt }];
  fs.writeFileSync(path.join(root, 'economic-policy.json'), JSON.stringify({ novaOllamaCloudEnabled: true, dailyCloudUsd: 10, monthlyCloudUsd: 100, maxCloudUsdPerTask: 1 }));
  fs.writeFileSync(path.join(root, 'economic-state.json'), JSON.stringify({ day, month: day.slice(0, 7), dailySpentUsd: 1, monthlySpentUsd: 1, reservedUsd: 3.5, revenueUsd: 0,
    reservations: Object.fromEntries([res('old', yesterday, 2), res('stale', stale, 1), res('fresh', fresh, 0.5)]) }));
  const events = [];
  const g = new EconomicGovernor(root, { append: e => events.push(e) });
  const s = g.snapshot().state;
  assert.deepEqual(Object.keys(s.reservations), ['fresh'], 'a call still running keeps its reservation');
  assert.equal(s.reservedUsd, 0.5);
  assert.equal(s.monthlySpentUsd, 4, 'both expired ones count as spent this month');
  if (stale.slice(0, 10) === day && yesterday.slice(0, 7) === day.slice(0, 7)) assert.equal(s.dailySpentUsd, 2, 'only today\'s counts against today');
  assert.equal(events.filter(e => e.type === 'cloud.cost_expired').length, 2);
  assert.equal(g.authorizeCloud({ estimatedUsd: 0.5, purpose: 'nova-ollama-cloud' }).allowed, true);
});
