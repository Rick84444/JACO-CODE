import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadLocalJacoEnv, loadWindowsModelKeys } from '../../agents/lib/local-credential-discovery.mjs';
import { automaticConnections } from '../../runtime/src/server/connected/automaticConnections.mjs';

const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-local-credentials-'));
  fs.mkdirSync(path.join(root,'runtime'));
  fs.mkdirSync(path.join(root,'agents','lib'), { recursive:true });
  fs.writeFileSync(path.join(root,'runtime','server.ts'),'// JACO');
  fs.writeFileSync(path.join(root,'agents','lib','secret-store.mjs'),'// JACO');
  return root;
};

test('JACO reads only its own local env files into runtime memory without disclosing keys', () => {
  const root=fixture();
  const example='extremely-sensitive-model-secret-not-returned';
  try {
    fs.writeFileSync(path.join(root,'.env'), `DEEPSEEK_API_KEY=${example}\nSTRIPE_SECRET_KEY=local-payment-key\nUSER_PASSWORD=do-not-touch\n`);
    fs.writeFileSync(path.join(root,'runtime','.env.local'), 'GEMINI_API_KEY=another-model-value\n');
    const env = { DEEPSEEK_API_KEY:'environment-wins' };
    const result=loadLocalJacoEnv({ cwd:path.join(root,'runtime'), env });
    assert.equal(result.rootFound,true);
    assert.equal(env.DEEPSEEK_API_KEY,'environment-wins');
    assert.equal(env.GEMINI_API_KEY,'another-model-value');
    assert.equal(env.STRIPE_SECRET_KEY,'local-payment-key');
    assert.equal(env.USER_PASSWORD,undefined);
    assert.deepEqual(result.observedFiles,['.env','runtime/.env.local']);
    assert.ok(!JSON.stringify(result).includes(example));
    assert.ok(!JSON.stringify(result).includes('another-model-value'));
    assert.ok(!JSON.stringify(result).includes('local-payment-key'));
  } finally { fs.rmSync(root,{ recursive:true,force:true }); }
});

test('environment scan does not follow symlinks or traverse unrelated project trees', () => {
  const root=fixture(), external=fs.mkdtempSync(path.join(os.tmpdir(),'outside-credentials-'));
  try {
    fs.writeFileSync(path.join(external,'.env'),'GEMINI_API_KEY=should-not-load');
    fs.symlinkSync(path.join(external,'.env'),path.join(root,'.env'));
    const env={};
    const result=loadLocalJacoEnv({cwd:root,env});
    assert.equal(result.loaded.length,0);
    assert.equal(env.GEMINI_API_KEY,undefined);
    assert.deepEqual(loadLocalJacoEnv({ cwd:external, env }).observedFiles,[]);
  } finally { fs.rmSync(root,{recursive:true,force:true}); fs.rmSync(external,{recursive:true,force:true}); }
});

test('existing Windows vault model credentials are loaded locally without cloud probes or payment secrets', async () => {
  const env={};
  const read=[];
  const result=await loadWindowsModelKeys({
    env,
    list:async()=>({ok:true,keys:['GEMINI_API_KEY','CDP_API_KEY_SECRET','STRIPE_SECRET_KEY','GEMINI_API_KEY']}),
    read:async key=>{read.push(key); return {ok:true,value:'private-gemini-value'};}
  });
  assert.deepEqual(read,['GEMINI_API_KEY','GEMINI_API_KEY']);
  assert.equal(env.GEMINI_API_KEY,'private-gemini-value');
  assert.equal(env.CDP_API_KEY_SECRET,undefined);
  assert.equal(env.STRIPE_SECRET_KEY,undefined);
  assert.deepEqual(result.configured,['GEMINI_API_KEY','GEMINI_API_KEY']);
  assert.ok(!JSON.stringify(result).includes('private-gemini-value'));
});

test('automatic connection waits for bounded Vault boot, then discovers a model', async () => {
  let loaded=0, probed=0;
  const env={};
  const providers=new Map();
  const registry={
    providers,
    ensureDefaults(){if(env.GEMINI_API_KEY)providers.set('gemini',{id:'gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai',apiKeyEnv:'GEMINI_API_KEY',credentialConfigured:true,defaultModel:''});},
    list(){return [...providers.values()];},
    register(p){providers.set(p.id,p);},
    async probe(){probed++;return {ok:true,models:['gemini-flash']};},
  };
  const manager=automaticConnections({registry,mcpHost:null,env,loadCredentials:async()=>{loaded++;env.GEMINI_API_KEY='opaque-secret';}});
  const a=await manager.refresh();
  await manager.refresh({force:true});
  assert.equal(loaded,1);
  assert.equal(probed,2);
  assert.equal(a.providers.find(x=>x.id==='gemini').state,'MODELS_AVAILABLE');
  assert.ok(!JSON.stringify(a).includes('opaque-secret'));
});

test('runtime exposes name-only local environment inventory in authenticated Aura Vault', () => {
  const src=fs.readFileSync(path.resolve('runtime/server.ts'),'utf8');
  assert.match(src,/const localEnvDiscovery = loadLocalJacoEnv\(\)/);
  assert.match(src,/app\.get\('\/api\/aura\/workbench\/vault\/discovery', requireLocalUi/);
  assert.match(src,/localEnvDiscovery\.loaded\.map\(\(item: any\) => item\.name\)/);
  assert.match(src,/windowsModelLoaded: windowsModelDiscovery\.configured/);
  assert.doesNotMatch(src,/res\.json\([^\n]*localEnvDiscovery\.loaded\.map\([^\n]*value/);
});
