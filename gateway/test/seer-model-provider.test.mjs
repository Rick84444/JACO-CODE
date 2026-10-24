import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverSeerLocalProvider, applySeerLocalProvider, invokeSeerProvider, fetchRegisteredProviders, extractGovernorJson, providerOutputTruncated, budgetSeerLocalPrompt } from '../src/seer-model-provider.mjs';

test('env-selected Ollama cloud model is validated through metadata without local weights', async () => {
  const calls = [];
  const env = { JACO_MODEL_PROVIDER: 'ollama', OLLAMA_MODEL: 'configured:120b-cloud' };
  const result = await discoverSeerLocalProvider({ env, fetchFn: async (url, init) => {
    calls.push(url);
    if (url.endsWith('/api/tags')) return jsonResponse({ models: [] });
    assert.equal(JSON.parse(init.body).model, env.OLLAMA_MODEL);
    return jsonResponse({ capabilities: ['completion', 'tools', 'thinking'] });
  } });
  assert.equal(result.provider.model, env.OLLAMA_MODEL);
  assert.equal(result.provider.local, false);
  assert.equal(result.provider.source, 'ollama-env+show');
  assert.deepEqual(calls.map(u => new URL(u).pathname), ['/api/tags', '/api/show']);
  applySeerLocalProvider(result.provider, env);
  assert.equal(env.JACO_SEER_PROVIDER_LOCAL, '0');
});

test('cloud metadata rejection does not silently select another installed model', async () => {
  for (const response of [jsonResponse({}, 404), jsonResponse({ capabilities: ['embedding'] })]) {
    const result = await discoverSeerLocalProvider({
      env: { JACO_MODEL_PROVIDER: 'ollama', OLLAMA_MODEL: 'configured:cloud' },
      fetchFn: async url => url.endsWith('/api/tags') ? jsonResponse({ models: [{ name: 'other:4b' }] }) : response,
    });
    assert.equal(result.provider, null);
  }
});

test('Ollama cloud transport retains cloud gate and image restriction without requiring daemon API key', async () => {
  const provider = { name: 'ollama', model: 'configured:cloud', local: false, envKey: null, url: 'http://127.0.0.1:11434/v1/chat/completions' };
  assert.equal(await invokeSeerProvider(provider, { user: 'test' }, { env: {}, fetchFn: () => assert.fail('must not call cloud') }), null);
  const result = await invokeSeerProvider(provider, { user: 'test', image: 'private' }, {
    env: { JACO_ALLOW_PAID_MODELS: '1' }, fetchFn: async (_url, init) => {
      assert.equal(JSON.parse(init.body).messages[1].content, 'test');
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    },
  });
  assert.equal(result.local, false);
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

test('auto prefers healthy LiteRT/Gemma and reports truthful provider identity', async () => {
  const seen = [];
  const fetchFn = async url => {
    seen.push(String(url));
    if (String(url) === 'http://127.0.0.1:9379/v1/models') {
      return jsonResponse({ data: [{ id: 'gemma4-e4b' }] });
    }
    throw new Error('unexpected request');
  };
  const result = await discoverSeerLocalProvider({ env: {}, fetchFn });
  assert.equal(result.provider.id, 'litert');
  assert.equal(result.provider.model, 'gemma4-e4b');
  assert.equal(result.provider.chatUrl, 'http://127.0.0.1:9379/v1/chat/completions');
  assert.deepEqual(seen, ['http://127.0.0.1:9379/v1/models']);

  const env = {};
  applySeerLocalProvider(result.provider, env);
  assert.equal(env.JACO_SEER_LOCAL_PROVIDER, 'litert');
  assert.equal(env.JACO_SEER_LOCAL_MODEL, 'gemma4-e4b');
  assert.equal(env.OLLAMA_MODEL, undefined);
});

test('forced llama.cpp discovers the exact OpenAI-compatible model id', async () => {
  const seen = [];
  const result = await discoverSeerLocalProvider({
    env: {
      JACO_SEER_PROVIDER_PREFERENCE: 'llamacpp',
      JACO_LLAMACPP_URL: 'http://127.0.0.1:9380/v1',
      JACO_LLAMACPP_MODEL: '/models/Bonsai-27B-Q1_0.gguf',
    },
    fetchFn: async url => {
      seen.push(String(url));
      return jsonResponse({ data: [{ id: '/models/Bonsai-27B-Q1_0.gguf' }] });
    },
  });
  assert.equal(result.provider.id, 'llamacpp');
  assert.equal(result.provider.model, '/models/Bonsai-27B-Q1_0.gguf');
  assert.equal(result.provider.chatUrl, 'http://127.0.0.1:9380/v1/chat/completions');
  assert.deepEqual(seen, ['http://127.0.0.1:9380/v1/models']);

  const env = {};
  applySeerLocalProvider(result.provider, env);
  assert.equal(env.JACO_SEER_LOCAL_PROVIDER, 'llamacpp');
  assert.equal(env.JACO_SEER_LOCAL_MODEL, '/models/Bonsai-27B-Q1_0.gguf');
});

test('auto falls back from unavailable LiteRT to installed Ollama model', async () => {
  const fetchFn = async url => {
    if (String(url).includes(':9379/')) throw new Error('connection refused');
    if (String(url) === 'http://127.0.0.1:11434/api/tags') {
      return jsonResponse({ models: [
        { name: 'small:1b', size: 100 },
        { name: 'qwen2.5-coder:1.5b', size: 200 },
      ] });
    }
    throw new Error(`unexpected request ${url}`);
  };
  const result = await discoverSeerLocalProvider({ env: {}, fetchFn });
  assert.equal(result.provider.id, 'ollama');
  assert.equal(result.provider.model, 'qwen2.5-coder:1.5b');
  assert.equal(result.provider.chatUrl, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.match(result.attempts[0].reason, /^litert-unavailable:/);
});

test('forced Ollama honors JACO_OLLAMA_MODEL alias and skips LiteRT', async () => {
  const seen = [];
  const fetchFn = async url => {
    seen.push(String(url));
    return jsonResponse({ models: [{ name: 'desktop-model:4b', size: 400 }] });
  };
  const result = await discoverSeerLocalProvider({
    env: {
      JACO_SEER_PROVIDER_PREFERENCE: 'ollama',
      JACO_OLLAMA_MODEL: 'desktop-model:4b',
      OLLAMA_BASE_URL: 'http://localhost:11434/v1',
    },
    fetchFn,
  });
  assert.equal(result.provider.id, 'ollama');
  assert.equal(result.provider.model, 'desktop-model:4b');
  assert.deepEqual(seen, ['http://localhost:11434/api/tags']);
});

test('forced provider fails closed when configured model is absent', async () => {
  const result = await discoverSeerLocalProvider({
    env: {
      JACO_SEER_PROVIDER_PREFERENCE: 'litert',
      JACO_LITERT_MODEL: 'missing-model',
    },
    fetchFn: async () => jsonResponse({ data: [{ id: 'gemma4-e4b' }] }),
  });
  assert.equal(result.provider, null);
  assert.match(result.reason, /litert-model-not-registered:missing-model/);
});

test('LiteRT uses the installed E2B registry ID when no model was explicitly selected', async () => {
  const result = await discoverSeerLocalProvider({
    env: { JACO_SEER_PROVIDER_PREFERENCE: 'litert', JACO_LITERT_MODEL: '' },
    fetchFn: async () => jsonResponse({ data: [{ id: 'gemma4-e2b' }] }),
  });
  assert.equal(result.provider.model, 'gemma4-e2b');
  assert.equal(result.provider.source, 'litert-autodiscovery');
});

test('discovery reports connection refusal and DNS causes without exposing endpoint credentials', async () => {
  for (const cause of [{ code: 'ECONNREFUSED' }, { errors: [{ code: 'ENOTFOUND' }, { code: 'ECONNREFUSED' }] }]) {
    const result = await discoverSeerLocalProvider({
      env: { JACO_SEER_PROVIDER_PREFERENCE: 'litert', JACO_LITERT_URL: 'http://secret:password@127.0.0.1:9379/v1' },
      fetchFn: async () => { throw new TypeError('fetch failed', { cause }); },
    });
    assert.match(result.reason, /litert-unavailable:fetch failed \(.*ECONNREFUSED.*\)/);
    assert.ok(!result.reason.includes('secret') && !result.reason.includes('password'));
  }
});


test('provider preserves finish reason so token truncation is observable', async () => {
  const provider = { name:'ollama', model:'gemma4:e2b', local:true, envKey:null, url:'http://127.0.0.1:11434/v1/chat/completions' };
  const result = await invokeSeerProvider(provider, { system:'s', user:'u', max_tokens:2048, temperature:0.2 }, {
    env:{},
    fetchFn: async () => jsonResponse({ choices:[{ finish_reason:'length', message:{ content:'{"partial":true' } }] }),
  });
  assert.equal(result.finishReason,'length');
  assert.equal(providerOutputTruncated(result),true);
});

test('governor JSON extraction tolerates prose, code fences and braces inside strings', () => {
  const parsed = extractGovernorJson('prefix\n\`\`\`json\n{"title":"Use {literal} safely","goal":"say \\\"}\\\" without ending","nodes":[{"key":"step-1","title":"x","description":"y"}]}\n\`\`\`\npostfix');
  assert.equal(parsed.title,'Use {literal} safely');
  assert.equal(parsed.goal,'say "}" without ending');
  assert.equal(parsed.nodes[0].key,'step-1');
  assert.throws(() => extractGovernorJson('text {"title":"cut off"'), /UNBALANCED_JSON_OBJECT/);
});


test('local llama prompt budget preserves latest operator text and bounds 2048 context', () => {
  const current = 'CURRENT_USER_MESSAGE: keep this exact tail';
  const budget = budgetSeerLocalPrompt({
    system: 'RULES\n' + 'S'.repeat(9000) + '\nTOOL_CATALOG:' + 'T'.repeat(5000),
    user: 'OBSERVED_STATE:' + 'O'.repeat(8000) + '\n' + current,
    memory: 'M'.repeat(12000),
    maxTokens: 1400,
    contextTokens: 2048,
  });
  assert.equal(budget.contextTokens, 2048);
  assert.ok(budget.maxTokens <= 409);
  assert.ok(budget.system.length + budget.user.length <= budget.inputCharBudget + 64);
  assert.match(budget.user, /keep this exact tail$/);
  assert.ok(budget.memoryChars <= Math.floor(budget.inputCharBudget * 0.22));
});

test('8192 local context preserves Aura output capacity while bounding prompt', () => {
  const budget = budgetSeerLocalPrompt({
    system: 'S'.repeat(20000),
    user: 'U'.repeat(20000) + 'LATEST',
    memory: 'M'.repeat(12000),
    maxTokens: 1400,
    contextTokens: 8192,
  });
  assert.equal(budget.maxTokens, 1400);
  assert.ok(budget.system.length + budget.user.length <= budget.inputCharBudget + 64);
  assert.match(budget.user, /LATEST$/);
});

test('the cloud providers are the ones the runtime lists, not a built-in set', async () => {
  const seen = [];
  const providers = await fetchRegisteredProviders({
    env: { JACO_RUNTIME_URL: 'http://127.0.0.1:3999/', JACO_GATEWAY_TOKEN: 'test-token' }, ttlMs: 0,
    fetchFn: async (url, init) => {
      seen.push({ url, token: init.headers['x-gateway-token'] });
      return { ok: true, json: async () => ({ success: true, providers: [
        { name: 'acme', url: 'https://llm.acme.test/v1/chat/completions', envKey: 'ACME_API_KEY', model: 'acme-1', local: false },
        { name: 'broken', url: 'https://x.test/v1/chat/completions' },
        { name: 'home', url: 'http://127.0.0.1:1234/v1/chat/completions', envKey: null, model: 'local-model', local: true },
      ] }) };
    },
  });
  assert.deepEqual(seen, [{ url: 'http://127.0.0.1:3999/api/connected/nova/planner-providers', token: 'test-token' }]);
  assert.deepEqual(providers.map(p => [p.name, p.model, p.local]), [['acme', 'acme-1', false], ['home', 'local-model', true]]);
});

test('a runtime that does not answer yields no providers instead of an error', async () => {
  assert.deepEqual(await fetchRegisteredProviders({ env: {}, ttlMs: 0, fetchFn: async () => { throw new Error('ECONNREFUSED'); } }), []);
  assert.deepEqual(await fetchRegisteredProviders({ env: {}, ttlMs: 0, fetchFn: async () => ({ ok: false, status: 401 }) }), []);
});

test('a connected cloud provider runs unless paid models are switched off, and its key can come from the secret store', async () => {
  const provider = { name: 'acme', url: 'https://llm.acme.test/v1/chat/completions', envKey: 'ACME_API_KEY', model: 'acme-1', local: false };
  const reply = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'hej' }, finish_reason: 'stop' }] }) });
  const off = [];
  assert.equal(await invokeSeerProvider(provider, { system: 's', user: 'u' }, { env: { JACO_ALLOW_PAID_MODELS: '0', ACME_API_KEY: 'k' }, fetchFn: reply, onFailure: f => off.push(f.code) }), null);
  assert.deepEqual(off, ['PAID_PROVIDER_DISABLED']);
  const missing = [];
  assert.equal(await invokeSeerProvider(provider, { system: 's', user: 'u' }, { env: { JACO_STATE_DIR: '/nonexistent-jaco-state' }, fetchFn: reply, onFailure: f => missing.push(f.code) }), null);
  assert.deepEqual(missing, ['PROVIDER_KEY_MISSING']);
  const result = await invokeSeerProvider(provider, { system: 's', user: 'u' }, { env: { ACME_API_KEY: 'k' }, fetchFn: reply });
  assert.equal(result.text, 'hej');
  assert.equal(result.local, false);
});
