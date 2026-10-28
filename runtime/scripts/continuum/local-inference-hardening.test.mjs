import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { isOnDeviceModelEndpoint, isCloudModelName, assertInstalledOllamaModel } from '../../src/server/continuum/localInferenceTrust.mjs';
import { ProviderRegistry } from '../../src/server/continuum/providerRegistry.mjs';
import { ContinuumModelRouter } from '../../src/server/continuum/modelRouter.mjs';

function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-local-proof-'));
  const events=[];const store={append:x=>events.push(x)};
  const providers=new ProviderRegistry(dir,store);
  providers.register({id:'ollama-local',protocol:'ollama',local:true,baseUrl:'http://127.0.0.1:11434',model:'test-small',capabilities:['text','reasoning'],enabled:true});
  providers.register({id:'remote-test',protocol:'openai-chat',local:false,baseUrl:'https://remote.invalid/v1',model:'pay',capabilities:['text'],enabled:true});
  let billed=0;
  const economic={authorizeCloud(){billed++;return {allowed:false,reason:'disabled'}},settleCloud(){throw Error('UNEXPECTED_CLOUD_SETTLEMENT')}};
  const router=new ContinuumModelRouter({events:store,economic,providers,operator:{assertExecutionAllowed(){}}});
  return {dir,events,providers,router,get billed(){return billed},dispose(){fs.rmSync(dir,{recursive:true,force:true})}};
}
const success=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
const ollama=(text='ready',done=true)=>success({model:'test-small',response:text,done,eval_count:2});
const chat=(text='yes')=>success({model:'local',choices:[{message:{content:text},finish_reason:'stop'}]});
const installed=(extra={})=>success({models:[{name:'test-small:latest',size:550_000_000,...extra}]});
const ollamaFetch=(text='ready',done=true,info={})=>async(url)=>url.endsWith('/api/tags')?installed(info):ollama(text,done);

// These tests never require a model download or real network. Every mock is
// explicitly separated from the genuine on-device inference probe.
test('only URL-parsed loopback hosts can be trusted as on-device inference',()=>{
  for(const url of ['http://127.0.0.1:11434','http://127.7.8.9:9379/v1','http://localhost:9380/v1','http://[::1]:8000/v1','https://localhost:443/v1'])assert.equal(isOnDeviceModelEndpoint(url),true,url);
  for(const url of ['https://provider.invalid/v1','http://localhost.evil.invalid','http://192.168.1.2:8080/v1','http://0.0.0.0:8080','file:///etc/passwd','http://user:pass@localhost:11434','http://localhost:11434/?proxy=cloud','not a url'])assert.equal(isOnDeviceModelEndpoint(url),false,url);
});
test('registry rejects cloud endpoint mislabeled local without mutating provider store',()=>{
 const x=fixture();try{
  assert.throws(()=>x.providers.register({id:'bad',protocol:'openai-chat',baseUrl:'https://remote.invalid/v1',local:true,model:'bad'}),/LOCAL_MODEL_ENDPOINT_NOT_LOOPBACK/);
  assert.equal(x.providers.list().some(p=>p.id==='bad'),false);
 }finally{x.dispose()}
});
test('local-only inference never calls any remote provider or cloud authorization',async()=>{
 const x=fixture(),before=globalThis.fetch;let calls=[];
 try{globalThis.fetch=async(url,options)=>{calls.push({url,options});return url.endsWith('/api/tags')?installed():ollama()};
  const r=await x.router.reason({prompt:'hi',localOnly:true,requiredCapabilities:['text']});
  assert.equal(r.providerId,'ollama-local');assert.equal(x.billed,0);assert.equal(calls.length,2);assert.match(calls[0].url,/127\.0\.0\.1/);assert.equal(calls[0].options.redirect,'error');assert.equal(calls[1].options.redirect,'error');
 }finally{globalThis.fetch=before;x.dispose()}
});
test('forcing a remote provider with localOnly true fails before fetch or charge',async()=>{
 const x=fixture(),before=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async()=>{calls++;throw Error('SHOULD_NOT_FETCH')};
  await assert.rejects(x.router.reason({prompt:'hi',providerId:'remote-test',localOnly:true}),/NO_ELIGIBLE_LOCAL_PROVIDER/);
  assert.equal(calls,0);assert.equal(x.billed,0);
 }finally{globalThis.fetch=before;x.dispose()}
});
test('the JACO_LOCAL_ONLY environment gate also rejects forced cloud',async()=>{
 const x=fixture(),old=process.env.JACO_LOCAL_ONLY;process.env.JACO_LOCAL_ONLY='1';
 try{await assert.rejects(x.router.reason({prompt:'hi',providerId:'remote-test'}),/NO_ELIGIBLE_LOCAL_PROVIDER/);assert.equal(x.billed,0)}
 finally{old===undefined?delete process.env.JACO_LOCAL_ONLY:process.env.JACO_LOCAL_ONLY=old;x.dispose()}
});
test('legacy corrupted provider claiming local with remote URL cannot be invoked',async()=>{
 const x=fixture(),before=globalThis.fetch;let calls=0;
 try{
  x.providers.state.providers['remote-test'].local=true;globalThis.fetch=async()=>{calls++;throw Error('SHOULD_NOT_FETCH')};
  await assert.rejects(x.router.reason({providerId:'remote-test',prompt:'secret',localOnly:true}),/LOCAL_MODEL_ENDPOINT_NOT_LOOPBACK/);
  assert.equal(calls,0);assert.equal(x.billed,0);
  assert.equal(x.providers.list().find(p=>p.id==='remote-test').localEndpointTrusted,false);
 }finally{globalThis.fetch=before;x.dispose()}
});
test('Ollama HTTP 200 with empty response must not be counted as success',async()=>{
 const x=fixture(),before=globalThis.fetch;
 try{globalThis.fetch=ollamaFetch('',true);
  await assert.rejects(x.router.reason({providerId:'ollama-local',prompt:'say ready',localOnly:true}),/OLLAMA_EMPTY_INFERENCE/);
  assert.equal(x.providers.get('ollama-local').stats.successes,0);
  assert.ok(x.events.some(e=>e.type==='model.provider_failed'));
 }finally{globalThis.fetch=before;x.dispose()}
});
test('Ollama truncated or unfinished reply does not count as inference',async()=>{
 const x=fixture(),before=globalThis.fetch;
 try{globalThis.fetch=ollamaFetch('partial',false);
  await assert.rejects(x.router.reason({providerId:'ollama-local',prompt:'say ready',localOnly:true}),/OLLAMA_INFERENCE_NOT_COMPLETE/);
  assert.equal(x.providers.get('ollama-local').stats.successes,0);
 }finally{globalThis.fetch=before;x.dispose()}
});
test('OpenAI compatible local endpoint must give nonempty content',async()=>{
 const x=fixture(),before=globalThis.fetch;
 try{x.providers.register({id:'llamacpp-local',protocol:'openai-chat',local:true,baseUrl:'http://127.0.0.1:9380/v1',model:'small',capabilities:['text']});
  globalThis.fetch=async()=>chat('');
  await assert.rejects(x.router.reason({providerId:'llamacpp-local',prompt:'say ready',localOnly:true}),/PROVIDER_EMPTY_INFERENCE/);
 }finally{globalThis.fetch=before;x.dispose()}
});
test('local llama.cpp response succeeds without touching remote budget',async()=>{
 const x=fixture(),before=globalThis.fetch;let redirect;
 try{x.providers.register({id:'llamacpp-local',protocol:'openai-chat',local:true,baseUrl:'http://127.0.0.1:9380/v1',model:'small',capabilities:['text']});
  globalThis.fetch=async(_url,opts)=>{redirect=opts.redirect;return chat('on device')};
  const r=await x.router.reason({providerId:'llamacpp-local',prompt:'hi',localOnly:true});
  assert.equal(r.text,'on device');assert.equal(r.costUsd,0);assert.equal(x.billed,0);assert.equal(redirect,'error');
 }finally{globalThis.fetch=before;x.dispose()}
});
test('explicit probe runs real generation contract but never asserts agent/system READY',async()=>{
 const x=fixture(),before=globalThis.fetch;
 try{globalThis.fetch=ollamaFetch('ready');
  const result=await x.router.probeLocalModel({providerId:'ollama-local',timeoutMs:5000});
  assert.equal(result.status,'INFERENCE_VERIFIED');assert.equal(result.cloudUsed,false);assert.equal(result.systemReady,false);assert.equal(result.agentToolsVerified,false);
 }finally{globalThis.fetch=before;x.dispose()}
});
test('explicit probe reports unusable local model as failed, not READY',async()=>{
 const x=fixture(),before=globalThis.fetch;
 try{globalThis.fetch=ollamaFetch('');
  const result=await x.router.probeLocalModel({providerId:'ollama-local',timeoutMs:5000});
  assert.equal(result.status,'INFERENCE_FAILED');assert.equal(result.systemReady,false);
 }finally{globalThis.fetch=before;x.dispose()}
});
test('probe cannot run remote even when provider is specified',async()=>{
 const x=fixture(),before=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async()=>{calls++;throw Error('BAD')};
  const result=await x.router.probeLocalModel({providerId:'remote-test',timeoutMs:5000});
  assert.equal(result.status,'INFERENCE_FAILED');assert.equal(calls,0);assert.equal(x.billed,0);
 }finally{globalThis.fetch=before;x.dispose()}
});
test('probe timeout is bounded; no accidental unbounded CPU stall',async()=>{
 const x=fixture();try{
  await assert.rejects(x.router.probeLocalModel({timeoutMs:Infinity}),/LOCAL_PROBE_TIMEOUT_INVALID/);
  await assert.rejects(x.router.probeLocalModel({timeoutMs:900000}),/LOCAL_PROBE_TIMEOUT_INVALID/);
 }finally{x.dispose()}
});
test('explicitly disabled providers cannot be forced',async()=>{
 const x=fixture(),before=globalThis.fetch;let calls=0;
 try{x.providers.register({id:'ollama-local',protocol:'ollama',local:true,baseUrl:'http://127.0.0.1:11434',model:'test-small',enabled:false});
  globalThis.fetch=async()=>{calls++;return ollama()};
  await assert.rejects(x.router.reason({providerId:'ollama-local',prompt:'hello'}),/PROVIDER_DISABLED/);
  assert.equal(calls,0);
 }finally{globalThis.fetch=before;x.dispose()}
});
test('Ollama inference has a bounded context to reduce on-device memory pressure',async()=>{
 const x=fixture(),before=globalThis.fetch,old=process.env.JACO_OLLAMA_NUM_CTX;
 try{let opts;process.env.JACO_OLLAMA_NUM_CTX='999999999';globalThis.fetch=async(u,o)=>{if(u.endsWith('/api/tags'))return installed();opts=JSON.parse(o.body).options;return ollama()};
  await x.router.reason({providerId:'ollama-local',prompt:'hello',maxOutputTokens:4000});
  assert.equal(opts.num_ctx,4096);assert.ok(opts.num_predict<=1024);
 }finally{globalThis.fetch=before;old===undefined?delete process.env.JACO_OLLAMA_NUM_CTX:process.env.JACO_OLLAMA_NUM_CTX=old;x.dispose()}
});
test('only one potentially expensive inference probe runs at a time',async()=>{
 const x=fixture(),before=globalThis.fetch;let wake;
 try{globalThis.fetch=(url)=>url.endsWith('/api/tags')?Promise.resolve(installed()):new Promise(resolve=>{wake=()=>resolve(ollama())});
  const first=x.router.probeLocalModel({providerId:'ollama-local',timeoutMs:5000});
  const second=await x.router.probeLocalModel({providerId:'ollama-local',timeoutMs:5000});
  assert.equal(second.status,'INFERENCE_BUSY');await new Promise(r=>setImmediate(r));assert.equal(typeof wake,'function');wake();
  assert.equal((await first).status,'INFERENCE_VERIFIED');
 }finally{globalThis.fetch=before;x.dispose()}
});

test('Android LiteRT-LM local model is discoverable by Continuum without cloud',async()=>{
 const vars=['JACO_LITERT_URL','JACO_LITERT_MODEL'];const old=Object.fromEntries(vars.map(k=>[k,process.env[k]]));
 process.env.JACO_LITERT_URL='http://127.0.0.1:9379/v1';process.env.JACO_LITERT_MODEL='local-small';
 const x=fixture(),before=globalThis.fetch;
 try{const p=x.providers.list().find(p=>p.id==='litert-env');
  assert.equal(p.protocol,'openai-chat');assert.equal(p.localEndpointTrusted,true);
  globalThis.fetch=async()=>chat('LiteRT inference works');
  const result=await x.router.reason({providerId:'litert-env',prompt:'hello',localOnly:true});
  assert.equal(result.text,'LiteRT inference works');assert.equal(result.costUsd,0);assert.equal(x.billed,0);
 }finally{globalThis.fetch=before;for(const k of vars)old[k]===undefined?delete process.env[k]:process.env[k]=old[k];x.dispose()}
});

test('Ollama cloud suffix is rejected even through localhost',async()=>{
 const x=fixture(),before=globalThis.fetch;let calls=0;
 try{x.providers.register({id:'ollama-local',protocol:'ollama',local:true,baseUrl:'http://127.0.0.1:11434',model:'gpt-oss:120b-cloud'});
  globalThis.fetch=async()=>{calls++;return installed()};
  await assert.rejects(x.router.reason({providerId:'ollama-local',prompt:'secret',localOnly:true}),/LOCAL_CLOUD_MODEL_FORBIDDEN/);
  assert.equal(calls,0);assert.equal(isCloudModelName('glm-4.7:cloud'),true);
 }finally{globalThis.fetch=before;x.dispose()}
});
test('Ollama installed model manifest must prove a local non-remote weight file',async()=>{
 const x=fixture(),before=globalThis.fetch;
 try{for(const info of [{remote_host:'https://ollama.com'},{remote_model:'gpt-oss:120b-cloud'},{size:0}]){
   globalThis.fetch=ollamaFetch('ready',true,info);
   await assert.rejects(x.router.reason({providerId:'ollama-local',prompt:'no cloud',localOnly:true}),/OLLAMA_MODEL_NOT_VERIFIABLY_LOCAL/);
  }
 }finally{globalThis.fetch=before;x.dispose()}
});
test('missing local Ollama model must fail before POST generate',async()=>{
 const x=fixture(),before=globalThis.fetch;let posts=0;
 try{globalThis.fetch=async(url)=>url.endsWith('/api/tags')?success({models:[]}):(posts++,ollama());
  await assert.rejects(x.router.reason({providerId:'ollama-local',prompt:'no model',localOnly:true}),/OLLAMA_MODEL_NOT_INSTALLED/);
  assert.equal(posts,0);
 }finally{globalThis.fetch=before;x.dispose()}
});
test('local Ollama catalog may not redirect to an external host',async()=>{
 const x=fixture(),before=globalThis.fetch;let redirect;
 try{globalThis.fetch=async(url,o)=>{redirect=o.redirect;return success({models:[]})};
  await assert.rejects(x.router.reason({providerId:'ollama-local',prompt:'test',localOnly:true}),/OLLAMA_MODEL_NOT_INSTALLED/);
  assert.equal(redirect,'error');
 }finally{globalThis.fetch=before;x.dispose()}
});
test('Ollama model manifest trust check is strict for locally cached aliases',async()=>{
 const malformed=async()=>success({models:[{name:'test-small:latest',remote_host:'https://host.invalid',size:123}]});
 await assert.rejects(assertInstalledOllamaModel({baseUrl:'http://127.0.0.1:11434',model:'test-small',fetchImpl:malformed}),/OLLAMA_MODEL_NOT_VERIFIABLY_LOCAL/);
});

test('Termux supervised startup defaults both Continuum and Ollama to local-only',()=>{
 const root=path.resolve(import.meta.dirname,'../../..');
 const ctl=fs.readFileSync(path.join(root,'runtime/bin/jacoctl'),'utf8');
 const run=fs.readFileSync(path.join(root,'runtime/termux/services/jaco-ollama/run'),'utf8');
 assert.match(ctl,/set_config_export JACO_LOCAL_ONLY "\$\{JACO_LOCAL_ONLY:-1\}"/);
 assert.match(ctl,/set_config_export OLLAMA_NO_CLOUD "\$\{OLLAMA_NO_CLOUD:-1\}"/);
 assert.match(run,/export OLLAMA_NO_CLOUD="\$\{OLLAMA_NO_CLOUD:-1\}"/);
});

test('real loopback HTTP transport proves a local manifest and an actual text reply',async()=>{
 const requests=[];
 const server=http.createServer((req,res)=>{
  requests.push(req.url);res.setHeader('content-type','application/json');
  if(req.url==='/api/tags')res.end(JSON.stringify({models:[{name:'test-small:latest',size:10000}]}));
  else if(req.url==='/api/generate')res.end(JSON.stringify({model:'test-small',done:true,response:'local transport works'}));
  else {res.statusCode=404;res.end('{}')}
 });
 await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
 const x=fixture();
 try{const port=server.address().port;
  x.providers.register({id:'ollama-local',protocol:'ollama',local:true,baseUrl:`http://127.0.0.1:${port}`,model:'test-small',enabled:true});
  const r=await x.router.probeLocalModel({providerId:'ollama-local',timeoutMs:5000});
  assert.equal(r.status,'INFERENCE_VERIFIED');assert.equal(x.billed,0);
  assert.deepEqual(requests,['/api/tags','/api/generate']);
 }finally{x.dispose();await new Promise(resolve=>server.close(resolve))}
});
test('real localhost redirect is refused; no external model HTTP call is followed',async()=>{
 const server=http.createServer((req,res)=>{
  if(req.url==='/api/tags'){res.setHeader('content-type','application/json');res.end(JSON.stringify({models:[{name:'test-small:latest',size:5000}]}));return}
  res.statusCode=302;res.setHeader('location','https://untrusted.invalid/collect');res.end();
 });
 await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
 const x=fixture();
 try{x.providers.register({id:'ollama-local',protocol:'ollama',local:true,baseUrl:`http://127.0.0.1:${server.address().port}`,model:'test-small',enabled:true});
  const r=await x.router.probeLocalModel({providerId:'ollama-local',timeoutMs:5000});
  assert.equal(r.status,'INFERENCE_FAILED');assert.equal(x.billed,0);assert.equal(x.providers.get('ollama-local').stats.successes,0);
 }finally{x.dispose();await new Promise(resolve=>server.close(resolve))}
});
