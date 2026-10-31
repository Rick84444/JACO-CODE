import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createToolHandlers,JACO_MCP_TOOL_NAMES } from '../src/tool-handlers.mjs';
import { createToolRegistry } from '../src/tool-registry.mjs';
import { projectCognitiveContext,projectKnowledgeSearch,validatedKnowledgeNote } from '../src/cognitive-context.mjs';
import { KnowledgeStore } from '../../src/server/continuum/knowledgeStore.mjs';

test('MCP advertises a bounded cognitive runtime and read-only knowledge search',()=>{
  const core={};
  const system={};
  const registry=createToolRegistry({core,system,modelId:'external-chatgpt',env:{}});
  assert.equal(registry.length,42);
  const names=registry.map(t=>t.name);
  assert.deepEqual(names.filter(n=>n.startsWith('jaco_cognitive_context')||n.startsWith('jaco_knowledge_')),
    ['jaco_cognitive_context','jaco_knowledge_search','jaco_knowledge_note']);
  assert.deepEqual(names,JACO_MCP_TOOL_NAMES);
  assert.equal(registry.find(x=>x.name==='jaco_cognitive_context').config.annotations.readOnlyHint,true);
  assert.equal(registry.find(x=>x.name==='jaco_knowledge_search').config.annotations.readOnlyHint,true);
  assert.equal(registry.find(x=>x.name==='jaco_knowledge_note').config.annotations.readOnlyHint,false);
});

test('Fresh context uses canonical Continuum envelope and economic policy, strips private fields',async()=>{
  const requests=[];
  const fakeCore={
    async continuityEnvelope(){requests.push('continuity');return {envelope:{
      schema:'jaco.cognitive-continuity-envelope.v1',revision:14,missionAuthority:'CONNECTED_DURABLE_NOVA',
      objective:'Fix current PR',workingState:{branch:'main',sessionToken:'MUST_NOT_LEAK',scope:'read-only'},
      focus:{goal:'diagnose'},unresolved:['verify Windows host'],
      epistemic:{status:'UNVERIFIED',apiKey:'MUST_NOT_LEAK'},invariants:['do not delete .env'],
    }};},
    async economicSnapshot(){requests.push('economic');return {economic:{
      policy:{cloudEnabled:false,manualAuraCloudEnabled:true,novaOllamaCloudEnabled:true,
        dailyCloudUsd:1,monthlyCloudUsd:15,maxCloudUsdPerTask:0.5,maxAutonomousCloudCallsPer15m:12},
      state:{dailySpentUsd:0.13,reservedUsd:0.04,credentials:'MUST_NOT_LEAK'},
      headroom:{dailyUsd:0.83},
    }};},
  };
  const sys={health:async()=>{requests.push('health');return {status:'READY',core:{up:true},workplace:{state:'RUNNING',novaState:'RUNNING'}};}};
  const h=createToolHandlers({core:fakeCore,system:sys,modelId:'m'});
  const context=await h.jaco_cognitive_context();
  assert.equal(context.schema,'jaco.chatgpt-cognitive-context/v1');
  assert.equal(context.service.core,'UP');
  assert.equal(context.service.aura,'NOT_INDEPENDENTLY_PROBED');
  assert.equal(context.continuity.revision,14);
  assert.equal(context.economic.cloudEnabled,false);
  assert.equal(context.economic.dailyCapUsd,1);
  assert.equal(context.economic.autonomousCallsPer15m,12);
  assert.equal(context.authority.mayExecuteToolsDirectly,false);
  assert.equal(requests.length,3);
  assert.ok(!JSON.stringify(context).includes('MUST_NOT_LEAK'),'restricted fields must not leak');
});

test('Continuum context fails closed when real canonical Core is unavailable',async()=>{
  const core={continuityEnvelope:async()=>{throw Error('JACO_CORE_UNAVAILABLE');},economicSnapshot:async()=>({})};
  const system={health:async()=>({status:'READY'})};
  const h=createToolHandlers({core,system,modelId:'m'});
  await assert.rejects(()=>h.jaco_cognitive_context(),/JACO_CORE_UNAVAILABLE/);
  assert.equal(projectCognitiveContext({}).continuity.state,'UNAVAILABLE');
});

test('Knowledge search is bounded, preserves evidence and verification states, excludes implementation',async()=>{
  let received;
  const core={knowledgeSearch:async(q,n)=>{received={q,n};return {knowledge:Array.from({length:20},(_,i)=>({
    id:'k'+i,kind:'code',purpose:'Safe retry',verificationStatus:i===0?'VERIFIED':'UNVERIFIED',
    implementation:'private code and credentials',confidence:0.9,revision:4,
    evidenceRefs:['receipt:1'],reasoningSummary:'Why it worked',contentHash:'sha256:test',
  }))};}};
  const h=createToolHandlers({core,system:{},modelId:'m'});
  const result=await h.jaco_knowledge_search({query:'retry',limit:10});
  assert.deepEqual(received,{q:'retry',n:10});
  assert.equal(result.results.length,10);
  assert.equal(result.results[0].verificationStatus,'VERIFIED');
  assert.equal(result.results[0].evidenceRefs[0],'receipt:1');
  assert.ok(!JSON.stringify(result).includes('private code'));
  const projection=projectKnowledgeSearch({knowledge:[{id:'x',verificationStatus:'UNVERIFIED'}]});
  assert.equal(projection.results[0].verificationStatus,'UNVERIFIED');
});

test('Knowledge mutation fails closed by default and rejects secret-like content',async()=>{
  let writes=0;
  const core={knowledgeNote:async()=>{writes++;throw Error('SHOULD_NOT_EXECUTE');}};
  const h=createToolHandlers({core,system:{},modelId:'m',env:{}});
  await assert.rejects(()=>h.jaco_knowledge_note({topic:'Retry strategy',note:'Use two retries for idempotent calls only'}),/JACO_KNOWLEDGE_WRITE_DISABLED/);
  assert.equal(writes,0);
  assert.throws(()=>validatedKnowledgeNote({topic:'Secrets',note:'our apiKey = sk-proj-abcde1234567890abcdefghijkl'}),/SECRET_REFUSED/);
  assert.throws(()=>validatedKnowledgeNote({topic:'x',note:'short'}),/NOTE_INVALID/);
});

test('Explicit opt-in writes ONLY an unverified note to real durable KnowledgeStore',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-cognitive-mcp-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const events=[];
  const store=new KnowledgeStore(root,{append:e=>events.push(e)});
  const core={knowledgeNote:async body=>({knowledge:store.put(body,'chatgpt-mcp')}),
    knowledgeSearch:async q=>({knowledge:store.search(q)})};
  const h=createToolHandlers({core,system:{},modelId:'m',
    env:{JACO_MCP_ALLOW_KNOWLEDGE_WRITE:'1'}});
  const saved=await h.jaco_knowledge_note({topic:'Stable context and rollback',
    note:'An assistant proposal: keep rollback receipts. Needs review before promoting any verified skill.'});
  assert.equal(saved.verificationStatus,'UNVERIFIED');
  assert.equal(saved.reusable,false);
  assert.equal(saved.promoted,false);
  assert.ok(saved.id);
  const restored=new KnowledgeStore(root,{append:e=>events.push(e)}).get(saved.id);
  assert.equal(restored.verificationStatus,'UNVERIFIED');
  assert.equal(restored.confidence,0.2);
  assert.equal(restored.reusable,false);
  assert.deepEqual(restored.evidenceRefs,[]);
  assert.equal(restored.kind,'assistant-note');
  assert.ok(events.some(e=>e.type==='knowledge.created'));
  const found=await h.jaco_knowledge_search({query:'rollback',limit:5});
  assert.equal(found.results[0].id,saved.id);
});

test('Memory write does not accept any fake verified receipt from Core',async()=>{
  const h=createToolHandlers({core:{knowledgeNote:async()=>({
    knowledge:{id:'x',kind:'assistant-note',verificationStatus:'VERIFIED'}})},system:{},modelId:'m',
    env:{JACO_MCP_ALLOW_KNOWLEDGE_WRITE:'1'}});
  await assert.rejects(()=>h.jaco_knowledge_note({topic:'Approval rules',note:'This note is not verified without evidence.'}),/JACO_KNOWLEDGE_NOTE_RECEIPT_INVALID/);
});
