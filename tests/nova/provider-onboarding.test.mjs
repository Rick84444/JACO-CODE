import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { discoverProvider, identifyKey, normalizeProviderUrl } from '../../runtime/src/server/connected/providerDiscovery.mjs';

const routes = {};
const spy = async (url, init) => {
  spy.calls.push({ url: String(url), auth: init.headers.authorization || null, redirect: init.redirect });
  const response = routes[String(url)] || { status: 404, body: {} };
  return new Response(JSON.stringify(response.body), { status: response.status });
};
spy.calls = [];

test('explicitly selected Gemini provider accepts a non-standard key format without guessing', async () => {
  spy.calls = [];
  routes['https://generativelanguage.googleapis.com/v1beta/openai/models'] = {
    status: 200, body: { data: [{ id: 'gemini-2.5-flash' }] },
  };
  const r = await identifyKey('not-a-prefix-key', { provider: 'gemini', fetchImpl: spy });
  assert.equal(r.state, 'READY');
  assert.equal(r.apiKeyEnv, 'GEMINI_API_KEY');
  assert.equal(r.defaultModel, 'gemini-2.5-flash');
  assert.deepEqual(spy.calls.map(c => c.url), ['https://generativelanguage.googleapis.com/v1beta/openai/models']);
  assert.equal(spy.calls[0].auth, 'Bearer not-a-prefix-key');
  assert.equal(spy.calls[0].redirect, 'error');
  assert.ok(!JSON.stringify(r).includes('not-a-prefix-key'), 'never echo the secret');
  delete routes['https://generativelanguage.googleapis.com/v1beta/openai/models'];
});

test('one-step custom OpenAI-compatible HTTPS endpoint with a key lists real models', async () => {
  spy.calls = [];
  routes['https://llm.example.org/v1/models'] = { status: 200, body: { data: [{ id: 'model-alpha' }, { id: 'embed-v1' }] } };
  const key = 'custom-secret-without-known-prefix';
  const r = await discoverProvider('https://llm.example.org/v1', {
    env: {}, fetchImpl: spy, keyFor: () => key,
  });
  assert.equal(r.state, 'READY');
  assert.equal(r.id, 'llm');
  assert.equal(r.defaultModel, 'model-alpha');
  assert.equal(r.apiKeyEnv, 'LLM_API_KEY');
  assert.equal(spy.calls.length, 1);
  assert.equal(spy.calls[0].auth, `Bearer ${key}`);
  assert.equal(spy.calls[0].redirect, 'error');
  assert.ok(!JSON.stringify(r).includes(key));
  delete routes['https://llm.example.org/v1/models'];
});

test('unknown services with no key can register only an observed authentication wall', async () => {
  spy.calls = [];
  routes['https://llm.example.org/v1/models'] = { status: 401, body: {} };
  const r = await discoverProvider('https://llm.example.org/v1', { env: {}, fetchImpl: spy });
  assert.equal(r.state, 'NEEDS_KEY');
  assert.equal(r.credentialConfigured, false);
  delete routes['https://llm.example.org/v1/models'];
});

test('invalid URLs and remote plaintext API secrets fail before any network request', async () => {
  assert.throws(() => normalizeProviderUrl('gemeni api'), /INVALID_PROVIDER_URL/);
  assert.throws(() => normalizeProviderUrl('https://user:password@llm.example.org'), /PROVIDER_URL_MUST_NOT_CONTAIN_CREDENTIALS/);
  spy.calls = [];
  await assert.rejects(discoverProvider('http://llm.example.org/v1', {
    env: {}, fetchImpl: spy, keyFor: () => 'secret',
  }), /PROVIDER_KEY_REQUIRES_HTTPS/);
  assert.equal(spy.calls.length, 0);
});

test('custom URL cannot impersonate a catalog ID and replace catalog credentials', async () => {
  spy.calls = [];
  routes['https://deepseek.example.org/v1/models'] = { status: 200, body: { data: [{ id: 'my-model' }] } };
  const r = await discoverProvider('https://deepseek.example.org/v1', {
    env: {}, fetchImpl: spy, keyFor: () => 'my-secret',
  });
  assert.equal(r.id, 'custom-deepseek');
  assert.equal(r.apiKeyEnv, 'CUSTOM_DEEPSEEK_API_KEY');
  delete routes['https://deepseek.example.org/v1/models'];
});

test('server stores a submitted custom key only after verified model discovery', () => {
  const source = fs.readFileSync(path.resolve('runtime/server.ts'), 'utf8');
  const connectRoute = source.slice(source.indexOf("app.post('/api/aura/workbench/providers/connect'"),
    source.indexOf("app.post('/api/aura/workbench/providers/key'"));
  assert.match(connectRoute, /submittedKey && found.state === 'READY'/);
  assert.match(connectRoute, /new SecretStore\(\)\.set\(found\.apiKeyEnv, submittedKey/);
  assert.match(connectRoute, /found\.state === 'NEEDS_KEY' && !submittedKey/);
  assert.match(connectRoute, /KEY_REJECTED and UNREACHABLE/);
  assert.match(source, /app\.get\('\/api\/aura\/workbench\/providers\/catalog'/);
});

test('Aura supports explicit selection and one-step custom URL+key entry', () => {
  const source = fs.readFileSync(path.resolve('runtime/src/components/ProviderConnect.tsx'), 'utf8');
  assert.match(source, /aria-label=\{uiText\("Choose API provider"\)\}/);
  assert.match(source, /providerChoice/);
  assert.match(source, /aria-label=\{uiText\("API key for a custom model service"\)\}/);
  assert.match(source, /\{ url: target\.trim\(\), \.\.\.\(key\.trim\(\) \? \{ key: key\.trim\(\) \} : \{\}\) \}/);
});
