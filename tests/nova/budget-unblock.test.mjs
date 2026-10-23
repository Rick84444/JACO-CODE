// The budget must not silently block the chat (operator 2026-10-09): cloud is one visible switch, an
// unknown-outcome reservation cannot hold the budget forever, a refused call releases at once, a new
// model needs no hand-written price, and a failed message says what to do.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { EconomicGovernor } from '../../runtime/src/server/continuum/economicGovernor.mjs';
import { createEconomicBudgetRouter } from '../../runtime/src/server/connected/economicBudget.mjs';
import { manualAuraProviderCompletion, modelPrice, chatFallbackChoice, chatFailureHint, REFERENCE_PRICE } from '../../runtime/src/server/connected/auraOllamaChat.mjs';
import { SecretStore, hydrateEnvFromStore } from '../../agents/lib/secret-store.mjs';

const governor = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-unblock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new EconomicGovernor(dir, { append() {} });
};

test('within its time the reservation holds, and the operator can release it', t => {
  const g = governor(t); g.updatePolicy({ cloudEnabled: true, dailyCloudUsd: 1, maxCloudUsdPerTask: 1 });
  const a = g.authorizeCloud({ estimatedUsd: 0.3, purpose: 'manual-aura-chat' }); g.markCloudOutcomeUnknown(a.reservationId);
  const b = g.authorizeCloud({ estimatedUsd: 0.2, purpose: 'manual-aura-chat' }); // an ordinary in-flight reservation
  assert.equal(g.snapshot().state.reservedUsd, 0.5);
  const out = g.releaseUnknownReservations('test');
  assert.equal(out.released, 1); assert.equal(out.usd, 0.3);
  assert.equal(g.snapshot().state.reservedUsd, 0.2, 'only the unknown one was freed');
  assert.ok(g.snapshot().state.reservations[b.reservationId]);
});

test('the cloud switch and the release route work through the operator route', async t => {
  const g = governor(t);
  const app = express(); app.use(express.json());
  app.use('/budget', createEconomicBudgetRouter({ economic: g, requireOperatorUi: (_q, _r, next) => next() }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => new Promise(r => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}/budget`;
  const send = (method, p, body) => fetch(url + p, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }).then(r => r.json());
  assert.equal(g.snapshot().policy.cloudEnabled, true, 'on by default; caps are the operator choice');
  assert.equal((await send('PATCH', '', { cloudEnabled: false })).economic.policy.cloudEnabled, false);
  assert.equal(g.authorizeCloud({ estimatedUsd: 0.01, purpose: 'reasoning' }).reason, 'CLOUD_DISABLED_BY_POLICY');
  assert.equal((await send('PATCH', '', { cloudEnabled: true })).economic.policy.cloudEnabled, true);
  assert.equal(g.authorizeCloud({ estimatedUsd: 0.01, purpose: 'manual-aura-chat' }).allowed, true);
  const r = g.authorizeCloud({ estimatedUsd: 0.02, purpose: 'manual-aura-chat' }); g.markCloudOutcomeUnknown(r.reservationId);
  assert.equal((await send('POST', '/release-unknown')).released, 1);
});

const provider = id => ({ id, baseUrl: `https://${id}.example/v1`, defaultModel: 'm', credentialConfigured: true, apiKeyEnv: `${id.toUpperCase()}_API_KEY` });
const harness = (fail, id = 'newprov') => {
  const costs = [], calls = [];
  const providers = { list: () => [provider(id)], chat: async input => { calls.push(input); if (fail) throw new Error(fail); return { content: 'hej', model: 'm', usage: { prompt_tokens: 3, completion_tokens: 4 } }; } };
  const economic = { authorizeCloud: i => { costs.push(['reserve', i.estimatedUsd]); return { allowed: true, reservationId: 'r1' }; },
    settleCloud: () => costs.push(['settle']), markCloudOutcomeUnknown: () => costs.push(['unknown']), releaseReservation: () => costs.push(['release']) };
  return { providers, economic, costs, calls };
};
const ask = { providerId: 'newprov', model: 'm', system: 'system prompt', user: 'user message' };

test('a refused or limited call (wrong key, rate limit) releases its reservation at once; a lost response stays unknown', async () => {
  for (const status of [401, 403, 429]) {
    const h = harness(`PROVIDER_HTTP_${status}: nope`);
    await assert.rejects(() => manualAuraProviderCompletion(ask, { providers: h.providers, economic: h.economic, env: {} }));
    assert.deepEqual(h.costs.map(c => c[0]), ['reserve', 'release'], `HTTP ${status}`);
  }
  for (const failure of ['PROVIDER_HTTP_503: down', 'The operation was aborted due to timeout']) {
    const h = harness(failure);
    await assert.rejects(() => manualAuraProviderCompletion(ask, { providers: h.providers, economic: h.economic, env: {} }));
    assert.deepEqual(h.costs.map(c => c[0]), ['reserve', 'unknown'], failure);
  }
});

test('models need no hand-written price: configured wins, :free costs nothing, anything else uses the reference price', async () => {
  assert.deepEqual(modelPrice('x', 'm', { JACO_AURA_PROVIDER_PRICES_JSON: '{"x/m":{"input":1,"output":2}}' }), { input: 1, output: 2, source: 'configured' });
  assert.equal(modelPrice('openrouter', 'qwen/q:free', {}).free, true);
  assert.deepEqual([modelPrice('x', 'm', {}).input, modelPrice('x', 'm', {}).output], [REFERENCE_PRICE.input, REFERENCE_PRICE.output]);
  assert.equal(modelPrice('x', 'm', { JACO_AURA_DEFAULT_PRICE_JSON: '{"input":1,"output":5}' }).output, 5);
  assert.equal(modelPrice('x', 'm', { JACO_AURA_DEFAULT_PRICE_JSON: 'not json' }).output, REFERENCE_PRICE.output, 'a bad override falls back');
  const paid = harness(null);
  const r = await manualAuraProviderCompletion(ask, { providers: paid.providers, economic: paid.economic, env: {} });
  assert.equal(r.costStatus, 'SETTLED'); assert.equal(paid.calls.length, 1);
  const free = harness(null); free.providers.list = () => [{ ...provider('newprov'), defaultModel: 'a:free' }];
  const f = await manualAuraProviderCompletion({ ...ask, model: 'a:free' }, { providers: free.providers, economic: free.economic, env: {} });
  assert.equal(f.costStatus, 'FREE'); assert.equal(free.costs.length, 0, 'no reservation for a free model');
});

test('the default chat falls back to a connected provider: free models first, then the usual order', () => {
  const list = (...ps) => ({ list: () => ps });
  assert.equal(chatFallbackChoice(list(provider('openai'), provider('deepseek'), provider('groq')), {}).providerId, 'groq');
  assert.equal(chatFallbackChoice(list(provider('openai'), provider('deepseek')), {}).providerId, 'deepseek');
  assert.equal(chatFallbackChoice(list(provider('openai'), { ...provider('zed'), defaultModel: 'q:free' }), {}).providerId, 'zed');
  assert.equal(chatFallbackChoice(list({ ...provider('deepseek'), credentialConfigured: false }), {}), null, 'no key, no fallback');
  assert.equal(chatFallbackChoice(list({ id: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', defaultModel: 'm' }), {}), null, 'local providers are not the fallback');
});

test('every failure says in plain Swedish what is wrong and offers one next step', () => {
  const hint = text => chatFailureHint(new Error(text));
  assert.equal(hint('AURA_CLOUD_DENIED:CLOUD_DISABLED_BY_POLICY').action, 'enable-cloud');
  assert.equal(hint('AURA_CLOUD_DENIED:DAILY_BUDGET_LIMIT').action, 'open-budget');
  assert.equal(hint('AURA_CLOUD_DENIED:TASK_COST_LIMIT').action, 'open-budget');
  assert.equal(hint('PROVIDER_HTTP_401: bad key').code, 'KEY_REJECTED');
  assert.equal(hint('AURA_PROVIDER_CREDENTIAL_MISSING').code, 'KEY_MISSING');
  assert.equal(hint('PROVIDER_HTTP_429: slow down').code, 'RATE_LIMITED');
  assert.equal(hint('The operation was aborted due to timeout').code, 'TIMEOUT');
  assert.equal(hint('all_providers_failed [groq:PAID_PROVIDER_DISABLED]').code, 'NO_MODEL');
  for (const text of ['AURA_CLOUD_DENIED:CLOUD_DISABLED_BY_POLICY', 'something odd']) assert.ok(hint(text).message.length > 20 && hint(text).actionLabel);
});

test('saved provider keys become environment variables in each process; the environment still wins; agent passwords are not exported', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydrate-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new SecretStore({ env: {}, dir });
  store.set('DEEPSEEK_API_KEY', 'ds-secret'); store.set('GROQ_API_KEY', 'groq-secret'); store.set('NOVA_GITHUB_PASSWORD', 'pw'); store.set('PLAIN_NAME', 'x');
  const env = { GROQ_API_KEY: 'from-env' };
  assert.deepEqual(hydrateEnvFromStore(env, store), ['DEEPSEEK_API_KEY']);
  assert.equal(env.DEEPSEEK_API_KEY, 'ds-secret'); assert.equal(env.GROQ_API_KEY, 'from-env');
  assert.equal(env.NOVA_GITHUB_PASSWORD, undefined); assert.equal(env.PLAIN_NAME, undefined);
});
