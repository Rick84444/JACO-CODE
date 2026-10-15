import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverLiteLocalCandidates, liteChatAnswer } from '../../runtime/src/server/connected/liteChatRouter.mjs';

const registry = (entries, probes) => ({
  list: () => entries,
  probe: async id => {
    const value = probes[id];
    if (value instanceof Error) throw value;
    return value || { ok:false, status:null, error:'ECONNREFUSED' };
  },
});
const local = (id,baseUrl,defaultModel='')=>({id,baseUrl,defaultModel});

test('Lite discovers model IDs on live local endpoints, ignores stale defaults and unsupported models',async()=>{
  const providers = registry([
    local('ollama','http://127.0.0.1:11434/v1','stale-ollama'),
    local('litert','http://127.0.0.1:9379/v1','stale-gemma'),
    local('deepseek','https://api.deepseek.com/v1','remote'),
    local('llamacpp','http://localhost:11435/v1','bonsai-q1'),
  ],{
    litert:{ok:true,models:['gemma4-e2b','vector-embed']},
    llamacpp:{ok:true,models:['bonsai-q1']},
    ollama:{ok:true,models:['qwen2.5-coder:1.5b']},
  });
  const detected=await discoverLiteLocalCandidates(providers);
  assert.deepEqual(detected.candidates,[
    {providerId:'litert',model:'gemma4-e2b'},
    {providerId:'llamacpp',model:'bonsai-q1'},
    {providerId:'ollama',model:'qwen2.5-coder:1.5b'},
  ]);
  assert.equal(detected.observations.some(o=>o.provider==='deepseek'),false,'Never probe remote service as local');
});

test('Lite answers directly using LiteRT with no SEER calls or cloud key',async()=>{
  const providers=registry([local('litert','http://127.0.0.1:9379/v1')],{litert:{ok:true,models:['gemma4-e2b']}});
  const calls=[];
  const result=await liteChatAnswer({providers,ask:async choice=>{
    calls.push(choice);
    return {success:true,reply:'GEMMA_READY',provider:'litert',model:choice.model};
  }});
  assert.equal(result.reply,'GEMMA_READY');
  assert.deepEqual(calls,[{providerId:'litert',model:'gemma4-e2b'}]);
});

test('Lite falls through unreachable LiteRT to a working local llama.cpp model, ahead of cloud',async()=>{
  const providers=registry([
    local('litert','http://127.0.0.1:9379/v1'),
    local('llamacpp','http://127.0.0.1:11435/v1'),
  ],{litert:{ok:false,error:'ECONNREFUSED'},llamacpp:{ok:true,models:['bonsai-q1']}});
  const calls=[];
  const r=await liteChatAnswer({providers,cloudChoice:()=>({providerId:'openai',model:'paid'}),
    ask:async c=>{calls.push(c);return {reply:'BONSAI_READY',provider:c.providerId,model:c.model};}});
  assert.equal(r.reply,'BONSAI_READY');
  assert.deepEqual(calls,[{providerId:'llamacpp',model:'bonsai-q1'}]);
});

test('Lite falls through failed explicit provider and failed local completion to next reachable local',async()=>{
  const providers=registry([
    local('litert','http://127.0.0.1:9379/v1'),
    local('ollama','http://127.0.0.1:11434/v1'),
  ],{litert:{ok:true,models:['gemma4-e2b']},ollama:{ok:true,models:['qwen']}});
  const calls=[];
  let fallback;
  const result=await liteChatAnswer({providers,choice:{providerId:'deepseek',model:'deepseek-chat'},
    cloudChoice:()=>({providerId:'deepseek',model:'deepseek-chat'}),onFallback:v=>{fallback=v;},
    ask:async c=>{
      calls.push(c.providerId);
      if(c.providerId==='deepseek')throw Error('PROVIDER_HTTP_402: Insufficient Balance');
      if(c.providerId==='litert')throw Error('PROVIDER_HTTP_503');
      return {reply:'OLLAMA_READY',provider:'ollama',model:'qwen'};
    }});
  assert.equal(result.reply,'OLLAMA_READY');
  assert.deepEqual(calls,['deepseek','litert','ollama']);
  assert.deepEqual(result.fallback.from,'deepseek/deepseek-chat');
  assert.equal(fallback.provider,'ollama');
});

test('Lite returns detailed absence evidence without claiming SEER failure',async()=>{
  const providers=registry([local('litert','http://127.0.0.1:9379/v1')],{litert:{ok:false,error:'fetch failed'}});
  let calls=0;
  const result=await liteChatAnswer({providers,ask:async()=>{calls++;return {reply:'should not run'};}});
  assert.equal(result.degraded,true);
  assert.equal(calls,0);
  assert.ok(result.failures.some(f=>f.includes('LITE_NO_AVAILABLE_MODELS')));
  assert.ok(result.failures.some(f=>f.includes('litert: UNREACHABLE')));
  assert.ok(!result.failures.join(' ').includes('SEER'));
});

test('Lite attempts each discovered candidate once; empty replies do not count as model answers',async()=>{
  const providers=registry([local('litert','http://127.0.0.1:9379/v1')],{litert:{ok:true,models:['gemma4-e2b']}});
  let calls=0;
  const r=await liteChatAnswer({providers,choice:{providerId:'litert',model:'gemma4-e2b'},
    ask:async()=>{calls++;return {reply:'  '};}});
  assert.equal(calls,1);
  assert.equal(r.degraded,true);
  assert.ok(r.failures.some(f=>f.includes('AURA_EMPTY_REPLY')));
});
