import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticConnections } from '../../runtime/src/server/connected/automaticConnections.mjs';

test('automatic connection preserves choices, excludes unusable models, never probes cloud without a key, shares refresh and reconnects', async () => {
  let clock = 100, calls = [], starts = 0, probes = 0;
  const providers = new Map([
    ['local', { id: 'local', baseUrl: 'http://127.0.0.1:1234/v1', defaultModel: 'my-explicit-model' }],
    ['cloud', { id: 'cloud', baseUrl: 'https://example.com/v1', apiKeyEnv: 'PRIVATE_KEY', credentialConfigured: false }],
  ]);
  const registry = { providers, ensureDefaults() {}, list: () => [...providers.values()], register(p) { providers.set(p.id,p); },
    async probe(id) { calls.push(id); probes++; return { ok: true, models: id === 'llamacpp' ? ['embedding-only'] : ['actual-model-id'] }; } };
  const mcpHost = { status: () => [{ id:'editor', status:'STOPPED', agentAccess:'read', tools:[] }], async start(id) { assert.equal(id,'editor'); starts++; return [{name:'read_file'}]; } };
  const connections = automaticConnections({ registry, mcpHost, env:{JACO_LITE:'1'}, now:()=>clock });
  const first = connections.refresh(), same = connections.refresh(); assert.equal(first,same);
  const receipt = await first;
  assert.equal(providers.get('local').defaultModel,'my-explicit-model');
  assert.equal(providers.get('litert').defaultModel,'actual-model-id');
  assert.equal(receipt.providers.find(p=>p.id==='llamacpp').state,'NO_CHAT_MODELS');
  assert.equal(receipt.providers.find(p=>p.id==='cloud').state,'NO_KEY');
  assert.equal(calls.includes('cloud'),false); assert.equal(JSON.stringify(receipt).includes('PRIVATE_KEY'),false);
  assert.ok(receipt.providers.every(p=>!p.toolCapability || p.toolCapability==='UNTESTED'));
  assert.equal(receipt.tools[0].state,'CONNECTED');
  await connections.refresh(); assert.equal(starts,1);
  clock+=30001; await connections.refresh(); assert.equal(starts,2); assert.equal(probes,6);
});

test('unreachable providers are observations and nothing is started when tool auto-start is off', async () => {
  const providers = new Map(); let started=false;
  const registry = { providers, ensureDefaults(){}, list:()=>[...providers.values()], register(p){providers.set(p.id,p);}, probe:async()=>({ok:false}) };
  const mcpHost = { status:()=>[{id:'editor',status:'STOPPED',agentAccess:'read',tools:[]}], start:()=>{started=true;} };
  const c = automaticConnections({registry,mcpHost,env:{JACO_AUTO_START_TOOLS:'0'}});
  const receipt = await c.refresh();
  assert.ok(receipt.providers.every(p=>p.state==='UNREACHABLE'));
  assert.equal(started,false);
  assert.equal(receipt.ok,false);
});

test('the full runtime connects every tool server by itself, restarts a crashed one with a growing pause and says what to do about a failure', async () => {
  let clock = 1_000, announced = [];
  const state = { a: 'STOPPED', b: 'STOPPED', hf: 'STOPPED', off: 'STOPPED' };
  const startCalls = [];
  const behaviour = { b: 'fail' };
  const registry = { providers: new Map(), ensureDefaults(){}, list:()=>[], register(){}, probe:async()=>({ok:false}) };
  const mcpHost = {
    status: () => [
      { id:'a', status:state.a, agentAccess:'read', tools: state.a==='READY'?[{name:'t1'}]:[] },
      { id:'b', status:state.b, agentAccess:'write', tools: [] },
      { id:'hf', status:'STOPPED', agentAccess:'read', tools: [], credentialEnv:'HF_TOKEN', credentialConfigured:false },
      { id:'off', status:'STOPPED', agentAccess:'off', tools: [] },
    ],
    async start(id) { startCalls.push(id); if (id==='b' && behaviour.b==='fail') throw new Error('spawn uvx ENOENT'); state[id]='READY'; return [{name:'t1'}]; },
  };
  const c = automaticConnections({ registry, mcpHost, env:{}, now:()=>clock, onToolsStarted:e=>announced.push(e) });
  let r = await c.refresh({force:true});
  assert.deepEqual(startCalls.sort(), ['a','b'], 'a switched-off server and one waiting for a credential are not started');
  assert.equal(r.tools.find(t=>t.id==='a').state,'CONNECTED');
  assert.equal(r.tools.find(t=>t.id==='hf').state,'NO_KEY');
  assert.match(r.tools.find(t=>t.id==='hf').remedy,/HF_TOKEN/);
  const b = r.tools.find(t=>t.id==='b');
  assert.equal(b.state,'UNREACHABLE'); assert.match(b.remedy,/uv/);
  assert.equal(r.problems.length,1); assert.equal(r.problems[0].id,'b');
  assert.equal(announced.length,1);
  // inside the pause nothing is retried
  clock += 10_000; r = await c.refresh({force:true});
  assert.equal(startCalls.filter(x=>x==='b').length,1); assert.equal(r.tools.find(t=>t.id==='b').state,'RETRY_LATER');
  // after it, one more try; the pause doubles
  clock += 25_000; await c.refresh({force:true});
  assert.equal(startCalls.filter(x=>x==='b').length,2);
  clock += 40_000; await c.refresh({force:true});
  assert.equal(startCalls.filter(x=>x==='b').length,2,'second pause is 60 s, not 30');
  clock += 25_000; behaviour.b='ok'; r = await c.refresh({force:true});
  assert.equal(startCalls.filter(x=>x==='b').length,3);
  assert.equal(r.tools.find(t=>t.id==='b').state,'CONNECTED');
  // a server that crashed later is started again at the next cycle
  state.a='FAILED'; clock += 31_000; await c.refresh({force:true});
  assert.equal(startCalls.filter(x=>x==='a').length,2);
});

test('actual registry keeps a saved operator endpoint and model through reconciliation and restart', async()=>{
  const fs=await import('node:fs'), os=await import('node:os'), path=await import('node:path');
  const {ProviderRegistry}=await import('../../runtime/src/server/connected/providerRegistry.mjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-auto-registry-'));
  try{
    const env={};
    const r=new ProviderRegistry(dir,env);
    r.register({id:'ollama',baseUrl:'http://127.0.0.1:11436/v1',apiKeyEnv:null,defaultModel:'operator-model'});
    r.ensureDefaults({refreshExisting:false});
    const restarted=new ProviderRegistry(dir,env);
    assert.equal(restarted.providers.get('ollama').defaultModel,'operator-model');
    assert.equal(restarted.providers.get('ollama').baseUrl,'http://127.0.0.1:11436/v1');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
