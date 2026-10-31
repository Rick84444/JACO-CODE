// SEER plans with the model the operator chose in Aura. A paid choice goes through the runtime's Continuum
// reservation (the real budgetedNovaOllamaCall, with the runtime and the provider faked at the HTTP level).
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAuraPlanner, invokeAuraPlanner } from '../src/seer-model-provider.mjs';

const RUNTIME = 'http://runtime.test';
const GEMINI = { name: 'gemini', url: 'https://gemini.test/v1beta/openai/chat/completions', envKey: 'GEMINI_API_KEY', model: 'models/gemini-2.5-flash', local: false };
const choice = (provider = 'gemini', model = 'models/gemini-2.5-flash', by = 'operator') => () => ({ provider, model, by });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// A fake network: the runtime's planner-providers list and cost routes, and one provider endpoint.
function network({ reserve = { success: true, reservationId: 'r1' }, answer = 'plan' } = {}) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body, headers: init.headers || {} });
    if (String(url).endsWith('/api/connected/nova/planner-providers')) return json({ providers: [GEMINI, { name: 'ollama', url: 'http://127.0.0.1:11434/v1/chat/completions', envKey: 'OLLAMA_API_KEY', model: 'gemma3:4b', local: true }] });
    if (String(url).endsWith('/api/nova/ollama-cost/reserve')) return reserve.success ? json(reserve) : json(reserve, 403);
    if (String(url).endsWith('/api/nova/ollama-cost/settle')) return json({ success: true, costUsd: 0.001 });
    if (String(url).endsWith('/api/nova/ollama-cost/release') || String(url).endsWith('/api/nova/ollama-cost/unknown')) return json({ success: true });
    return json({ choices: [{ message: { content: answer }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  };
  return { calls, fetchFn };
}

test('the operator choice in Aura resolves to the connected provider; JACO_PRIMARY_PROVIDER and non-operator choices do not', async () => {
  const { fetchFn } = network();
  const resolved = await resolveAuraPlanner({ env: {}, fetchFn, runtimeUrl: RUNTIME, cacheMs: 0, readChoice: choice() });
  assert.deepEqual(resolved, { ...GEMINI, source: 'aura-choice' });
  assert.equal(await resolveAuraPlanner({ env: { JACO_PRIMARY_PROVIDER: 'deepseek' }, fetchFn, runtimeUrl: RUNTIME, cacheMs: 0, readChoice: choice() }), null);
  assert.equal(await resolveAuraPlanner({ env: {}, fetchFn, runtimeUrl: RUNTIME, cacheMs: 0, readChoice: choice('groq', 'openai/gpt-oss-20b', 'aura') }), null);
  const local = await resolveAuraPlanner({ env: {}, fetchFn, runtimeUrl: RUNTIME, cacheMs: 0, readChoice: choice('ollama', 'gemma3:4b') });
  assert.equal(local.local, true);
  assert.equal(local.envKey, null);
});

test('a paid Aura choice is reserved in Continuum, called with its key and settled with real usage', async () => {
  const { calls, fetchFn } = network({ answer: '{"plan":1}' });
  const result = await invokeAuraPlanner(GEMINI, { system: 's', user: 'u', max_tokens: 8192, temperature: 0.2 }, {
    env: {}, fetchFn, runtimeUrl: RUNTIME, credentialFn: () => 'gemini-key' });
  assert.equal(result.ok, true);
  assert.equal(result.text, '{"plan":1}');
  assert.deepEqual(calls.map(c => new URL(c.url).pathname), ['/api/nova/ollama-cost/reserve', '/v1beta/openai/chat/completions', '/api/nova/ollama-cost/settle']);
  assert.equal(calls[0].body.providerId, 'gemini');
  assert.equal(calls[0].body.maxTokens, 8192);
  assert.equal(calls[1].headers.Authorization, 'Bearer gemini-key');
  assert.deepEqual(calls[2].body.usage, { prompt_tokens: 10, completion_tokens: 5 });
});

test('a refused reservation (ceiling reached) makes no provider call and reports the runtime reason', async () => {
  const { calls, fetchFn } = network({ reserve: { success: false, error: 'DAILY_BUDGET_LIMIT' } });
  const failures = [];
  const result = await invokeAuraPlanner(GEMINI, { system: 's', user: 'u', max_tokens: 100 }, {
    env: {}, fetchFn, runtimeUrl: RUNTIME, credentialFn: () => 'gemini-key', onFailure: f => failures.push(f) });
  assert.equal(result, null);
  assert.deepEqual(calls.map(c => new URL(c.url).pathname), ['/api/nova/ollama-cost/reserve']);
  assert.ok(failures.some(f => f.code === 'DAILY_BUDGET_LIMIT'), JSON.stringify(failures));
});

test('JACO_ALLOW_PAID_MODELS=0 or a missing key stops a paid choice before any reservation; a local choice is never reserved', async () => {
  const { calls, fetchFn } = network();
  const failures = [];
  assert.equal(await invokeAuraPlanner(GEMINI, { system: 's', user: 'u', max_tokens: 100 }, { env: { JACO_ALLOW_PAID_MODELS: '0' }, fetchFn, runtimeUrl: RUNTIME, credentialFn: () => 'k', onFailure: f => failures.push(f.code) }), null);
  assert.equal(await invokeAuraPlanner(GEMINI, { system: 's', user: 'u', max_tokens: 100 }, { env: {}, fetchFn, runtimeUrl: RUNTIME, credentialFn: () => '', onFailure: f => failures.push(f.code) }), null);
  assert.deepEqual(failures, ['PAID_PROVIDER_DISABLED', 'PROVIDER_KEY_MISSING']);
  assert.equal(calls.length, 0);
  const local = await invokeAuraPlanner({ name: 'ollama', url: 'http://127.0.0.1:11434/v1/chat/completions', model: 'gemma3:4b', local: true, envKey: null },
    { system: 's', user: 'u', max_tokens: 100 }, { env: {}, fetchFn, runtimeUrl: RUNTIME });
  assert.equal(local.ok, true);
  assert.deepEqual(calls.map(c => new URL(c.url).pathname), ['/v1/chat/completions']);
});
