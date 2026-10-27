// Connecting a provider from a URL alone: recognise known services, probe unknown ones, and never
// register something that does not answer like a model API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverProvider, normalizeProviderUrl, pickDefaultModel, providerIdFromUrl } from '../../runtime/src/server/connected/providerDiscovery.mjs';

const stub = routes => {
  const seen = [];
  const fetchImpl = async (href, init) => {
    seen.push({ href, auth: init?.headers?.authorization || null });
    const r = routes[href];
    if (!r) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  };
  return { fetchImpl, seen };
};

test('a product site resolves to its API and asks for the key by its usual variable', async () => {
  const { fetchImpl, seen } = stub({ 'https://api.deepseek.com/v1/models': { status: 401, body: { error: 'auth' } } });
  const d = await discoverProvider('deepseek.com', { env: {}, fetchImpl });
  assert.equal(d.id, 'deepseek'); assert.equal(d.state, 'NEEDS_KEY');
  assert.equal(d.baseUrl, 'https://api.deepseek.com/v1'); assert.equal(d.apiKeyEnv, 'DEEPSEEK_API_KEY');
  assert.equal(seen[0].auth, null);
  assert.equal(d.defaultModel, 'deepseek-flash', 'a known service keeps its usual model without a key, so it works once a key is saved');
});

test('with the key in the environment the models are listed and a chat model is chosen', async () => {
  const { fetchImpl, seen } = stub({ 'https://api.groq.com/openai/v1/models': { body: { data: [{ id: 'whisper-large-v3' }, { id: 'llama-3.3-70b' }] } } });
  const d = await discoverProvider('https://console.groq.com/keys', { env: { GROQ_API_KEY: 'k-123' }, fetchImpl });
  assert.equal(d.state, 'READY'); assert.deepEqual(d.models, ['whisper-large-v3', 'llama-3.3-70b']);
  assert.equal(d.defaultModel, 'llama-3.3-70b');
  assert.equal(seen[0].auth, 'Bearer k-123');
  assert.equal(JSON.stringify(d).includes('k-123'), false, 'the key never appears in the result');
});

test('a rejected key is reported as such', async () => {
  const { fetchImpl } = stub({ 'https://api.openai.com/v1/models': { status: 401 } });
  assert.equal((await discoverProvider('openai.com', { env: { OPENAI_API_KEY: 'bad' }, fetchImpl })).state, 'KEY_REJECTED');
});

test('an unknown server is probed for an OpenAI-compatible path, then Ollama', async () => {
  const a = stub({ 'http://10.0.0.5:8080/v1/models': { body: { data: [{ id: 'my-model' }] } } });
  const d = await discoverProvider('10.0.0.5:8080', { env: {}, fetchImpl: a.fetchImpl });
  assert.equal(d.state, 'READY'); assert.equal(d.baseUrl, 'http://10.0.0.5:8080/v1'); assert.equal(d.id, 'host-10-0-0-5');
  const b = stub({ 'http://127.0.0.1:11434/api/tags': { body: { models: [{ name: 'qwen2.5:3b' }] } } });
  const o = await discoverProvider('http://127.0.0.1:11434', { env: {}, fetchImpl: b.fetchImpl });
  assert.equal(o.state, 'READY'); assert.equal(o.baseUrl, 'http://127.0.0.1:11434/v1'); assert.equal(o.id, 'local-11434');
  assert.deepEqual(o.models, ['qwen2.5:3b']);
});

test('nothing answering is UNREACHABLE, with the evidence of what was tried', async () => {
  const { fetchImpl } = stub({});
  const d = await discoverProvider('https://example.org', { env: {}, fetchImpl });
  assert.equal(d.state, 'UNREACHABLE');
  assert.ok(d.evidence.length >= 4 && d.evidence.every(e => e.status === 404));
});

test('URL helpers', () => {
  assert.equal(normalizeProviderUrl('localhost:1234').protocol, 'http:');
  assert.equal(normalizeProviderUrl('openrouter.ai').protocol, 'https:');
  assert.throws(() => normalizeProviderUrl('ftp://x'), /UNSUPPORTED_PROVIDER_PROTOCOL/);
  assert.throws(() => normalizeProviderUrl(''), /PROVIDER_URL_REQUIRED/);
  assert.equal(providerIdFromUrl(new URL('https://api.my-llm.example.com')), 'my-llm');
  assert.equal(pickDefaultModel(['text-embedding-3', 'gpt-x'], ''), 'gpt-x');
  assert.equal(pickDefaultModel(['a', 'b'], 'b'), 'b');
});

test('Gemini is recognised by name or product site, and its 404 without a key means a key is needed', async () => {
  const listing = 'https://generativelanguage.googleapis.com/v1beta/openai/models';
  for (const typed of ['gemini', 'gemini.google.com', 'aistudio.google.com']) {
    const { fetchImpl, seen } = stub({ [listing]: { status: 404, body: { error: { code: 404 } } } });
    const d = await discoverProvider(typed, { env: {}, fetchImpl });
    assert.equal(d.id, 'gemini', typed); assert.equal(d.state, 'NEEDS_KEY', typed);
    assert.deepEqual(seen.map(s => s.href), [listing], 'only the Gemini API is asked, never a host called "gemini"');
  }
  const { fetchImpl } = stub({ [listing]: { body: { data: [{ id: 'models/text-embedding-004' }, { id: 'models/imagen-3.0' }, { id: 'models/gemini-2.5-flash' }] } } });
  const ready = await discoverProvider('gemini', { env: { GEMINI_API_KEY: 'AIza-test' }, fetchImpl });
  assert.equal(ready.state, 'READY'); assert.equal(ready.defaultModel, 'gemini-2.5-flash', 'model ids are used without the "models/" prefix and image models are not the default');
});
