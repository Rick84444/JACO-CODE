import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CATALOG, keyCandidates, catalogProvider } from '../../runtime/src/server/connected/providerCatalog.mjs';
import { identifyKey } from '../../runtime/src/server/connected/providerDiscovery.mjs';
import { ProviderRegistry } from '../../runtime/src/server/connected/providerRegistry.mjs';

const hex32 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const reply = (status, json) => async () => ({ status, text: async () => JSON.stringify(json) });
const spy = (status, json) => { const calls = []; const f = async (href, init) => { calls.push({ href, auth: init?.headers?.authorization }); return reply(status, json)(); }; f.calls = calls; return f; };

test('key shapes name the service, and shared shapes name every candidate', () => {
  assert.deepEqual(keyCandidates('gsk_abc123').map(c => c.id), ['groq']);
  assert.deepEqual(keyCandidates('sk-or-v1-abc').map(c => c.id), ['openrouter']);
  assert.deepEqual(keyCandidates('sk-ant-api03-abc').map(c => c.id), ['anthropic']);
  assert.deepEqual(keyCandidates(`sk-${hex32}`).map(c => c.id).sort(), ['deepseek', 'qwen']);
  assert.deepEqual(keyCandidates('nothing-we-know'), []);
});

test('a recognised key is checked against its own service only, and never returned', async () => {
  const f = spy(200, { data: [{ id: 'openai/gpt-oss-120b' }, { id: 'whisper-large' }] });
  const r = await identifyKey('gsk_secretvalue', { fetchImpl: f });
  assert.equal(r.state, 'READY');
  assert.equal(r.id, 'groq');
  assert.equal(r.apiKeyEnv, 'GROQ_API_KEY');
  assert.equal(r.defaultModel, 'openai/gpt-oss-120b');
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].href, /^https:\/\/api\.groq\.com\//);
  assert.ok(!JSON.stringify(r).includes('secretvalue'));
});

test('an ambiguous or unknown key is not sent anywhere', async () => {
  const f = spy(200, { data: [] });
  const shared = await identifyKey(`sk-${hex32}`, { fetchImpl: f });
  assert.equal(shared.state, 'AMBIGUOUS');
  assert.deepEqual([...shared.candidates].sort(), ['deepseek', 'qwen']);
  assert.equal((await identifyKey('mystery', { fetchImpl: f })).state, 'UNKNOWN_KEY');
  assert.equal(f.calls.length, 0);
  // choosing the service sends it there, and only there
  assert.equal((await identifyKey(`sk-${hex32}`, { provider: 'deepseek', fetchImpl: f })).state, 'READY');
  assert.deepEqual(f.calls.map(c => c.href), ['https://api.deepseek.com/v1/models']);
});

test('a refused key and an unreachable service are told apart', async () => {
  assert.equal((await identifyKey('gsk_x', { fetchImpl: spy(401, {}) })).state, 'KEY_REJECTED');
  assert.equal((await identifyKey('gsk_x', { fetchImpl: spy(503, {}) })).state, 'UNREACHABLE');
});

test('the registry builds a provider for every catalog service that has a key, nothing hard-coded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-'));
  const env = { JACO_STATE_DIR: dir, MISTRAL_API_KEY: 'k1', XAI_API_KEY: 'k2', GROQ_API_KEY: 'k3', GROQ_MODEL: 'my-model' };
  const reg = new ProviderRegistry(dir, env);
  const ids = reg.list().map(p => p.id);
  for (const id of ['mistral', 'xai', 'groq']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('deepseek'), 'no key, no provider');
  assert.equal(reg.list().find(p => p.id === 'groq').defaultModel, 'my-model');
  assert.equal(catalogProvider(CATALOG.find(c => c.id === 'qwen'), { QWEN_BASE_URL: 'https://x.test/v1/' }).baseUrl, 'https://x.test/v1');
});

test('scan reports active, keyless and refused providers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-'));
  const reg = new ProviderRegistry(dir, { JACO_STATE_DIR: dir, GROQ_API_KEY: 'k', MISTRAL_API_KEY: 'k' });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async href => String(href).includes('groq.com')
    ? { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'm1' }] }) }
    : String(href).includes('mistral.ai') ? { ok: false, status: 401, text: async () => '{}' } : { ok: false, status: 500, text: async () => '{}' };
  try {
    const by = Object.fromEntries((await reg.scan()).map(p => [p.id, p]));
    assert.equal(by.groq.state, 'ACTIVE');
    assert.equal(by.groq.models, 1);
    assert.equal(by.mistral.state, 'KEY_REJECTED');
    assert.equal(by.ollama.state, 'UNREACHABLE');
  } finally { globalThis.fetch = realFetch; }
});

test('a Gemini key refused with 400 is reported as refused, not as an unreachable service', async () => {
  const refused = await identifyKey('AIzaNotAValidKey', { fetchImpl: spy(400, { error: { message: 'Please pass a valid API key' } }) });
  assert.equal(refused.id, 'gemini'); assert.equal(refused.state, 'KEY_REJECTED');
});
