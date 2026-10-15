import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProviderRegistry } from '../../runtime/src/server/connected/providerRegistry.mjs';

test('ProviderRegistry exposes canonical llama.cpp/Bonsai provider from runtime env',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-provider-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const registry=new ProviderRegistry(dir,{
    JACO_LLAMACPP_URL:'http://127.0.0.1:9380/v1',
    JACO_LLAMACPP_MODEL:'/home/test/models/Bonsai-27B-Q1_0.gguf',
  });
  const provider=registry.list().find(item=>item.id==='llamacpp');
  assert.ok(provider);
  assert.equal(provider.baseUrl,'http://127.0.0.1:9380/v1');
  assert.equal(provider.defaultModel,'Bonsai-27B-Q1_0.gguf');
  assert.equal(provider.apiKeyEnv,null);
  assert.equal(provider.credentialConfigured,false);
});

test('ProviderRegistry does not invent llama.cpp when runtime env does not declare it',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-provider-none-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const registry=new ProviderRegistry(dir,{});
  assert.equal(registry.list().some(item=>item.id==='llamacpp'),false);
});

test('Aura registers the same configured LiteRT model as SEER and refreshes stale saved settings', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-litert-provider-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { JACO_LITERT_URL: 'http://127.0.0.1:9379/', JACO_LITERT_MODEL: 'gemma4-e2b' };
  const first = new ProviderRegistry(dir, env);
  const provider = first.list().find(item => item.id === 'litert');
  assert.equal(provider.baseUrl, 'http://127.0.0.1:9379/v1');
  assert.equal(provider.defaultModel, 'gemma4-e2b');
  assert.equal(provider.apiKeyEnv, null);
  first.register({ id: 'litert', baseUrl: 'http://127.0.0.1:9000/v1', defaultModel: 'stale-model' });
  const restarted = new ProviderRegistry(dir, env).list().find(item => item.id === 'litert');
  assert.equal(restarted.baseUrl, provider.baseUrl);
  assert.equal(restarted.defaultModel, 'gemma4-e2b');
});

test('Aura does not invent a LiteRT model ID when SEER will discover the registry', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-litert-auto-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const registry = new ProviderRegistry(dir, { JACO_LITERT_URL: 'http://127.0.0.1:9379/v1' });
  assert.equal(registry.list().find(item => item.id === 'litert').defaultModel, '');
});


test('Anthropic OpenAI-compat chat omits invalid low temperature', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-anthropic-provider-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const registry = new ProviderRegistry(dir, { JACO_STATE_DIR: dir, ANTHROPIC_API_KEY: 'sk-ant-test' });
  const realFetch = globalThis.fetch;
  let seenBody = null;
  globalThis.fetch = async (href, init = {}) => {
    seenBody = JSON.parse(String(init.body || '{}'));
    return { ok: true, status: 200, text: async () => JSON.stringify({ model: 'claude-opus-5-5', choices: [{ message: { content: 'OK' } }] }) };
  };
  try {
    const result = await registry.chat({ providerId: 'anthropic', model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(result.content, 'OK');
    assert.equal(Object.hasOwn(seenBody, 'temperature'), false, 'Claude compatibility request must not send temperature 0.2');
  } finally { globalThis.fetch = realFetch; }
});
