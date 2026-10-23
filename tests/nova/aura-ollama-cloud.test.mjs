import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auraOllamaModelCatalog, ollamaCloudCostUsd, manualAuraOllamaCompletion } from '../../runtime/src/server/connected/auraOllamaChat.mjs';
import { EconomicGovernor } from '../../runtime/src/server/continuum/economicGovernor.mjs';
import { budgetedNovaOllamaCall } from '../../agents/lib/nova-ollama-cost.mjs';

function harness({ spent = 0, usage = { prompt_tokens: 10, completion_tokens: 4 }, fail = false, paymentRequired = false } = {}) {
  const state = { dailySpentUsd: spent, reservedUsd: 0 };
  const events = [];
  const economic = {
    snapshot: () => ({ state: { ...state } }),
    authorizeCloud: ({ estimatedUsd, purpose }) => {
      if (state.dailySpentUsd + state.reservedUsd + estimatedUsd > 1) return { allowed: false, reason: 'DAILY_BUDGET_LIMIT' };
      events.push(['reserve', purpose, estimatedUsd]);
      state.reservedUsd += estimatedUsd;
      return { allowed: true, reservationId: 'r1' };
    },
    settleCloud: (_id, actualUsd) => { events.push(['settle', actualUsd]); state.dailySpentUsd += actualUsd; state.reservedUsd = 0; },
    markCloudOutcomeUnknown: () => { events.push(['unknown']); },
    releaseReservation: () => { events.push(['release']); state.reservedUsd = 0; },
  };
  const providers = {
    chat: async input => {
      events.push(['chat', input.providerId, input.model, input.maxTokens]);
      if (fail) throw new Error('provider failed');
      if (paymentRequired) throw new Error('PROVIDER_HTTP_402: subscription required');
      return { content: 'Hej', usage };
    },
  };
  return { state, events, economic, providers, env: { JACO_AURA_OLLAMA_CLOUD_MODELS: 'gpt-oss:120b-cloud,deepseek-v4-pro:cloud', JACO_OLLAMA_CLOUD_PRICES_JSON: '{"gpt-oss:120b-cloud":{"input":0.15,"output":0.6},"deepseek-v4-pro:cloud":{"input":0.66,"output":1.98}}' } };
}

test('manual Aura Ollama Cloud call reserves cost, bounds output, and settles reported usage', async () => {
  const h = harness();
  const result = await manualAuraOllamaCompletion({ model: 'deepseek-v4-pro:cloud', system: 'Du är Aura', user: 'Hej' }, h);
  assert.equal(result.text, 'Hej');
  assert.equal(result.costStatus, 'SETTLED');
  assert.equal(result.local, false);
  assert.deepEqual(h.events.map(e => e[0]), ['reserve', 'chat', 'settle']);
  assert.equal(h.events[0][1], 'manual-aura-chat');
  assert.equal(h.events[1][3], 700);
});

test('manual Aura Cloud rejects unpriced models and a full daily cap before dispatch', async () => {
  const h = harness({ spent: 1 });
  await assert.rejects(() => manualAuraOllamaCompletion({ model: 'new-cloud-model', system: 's', user: 'u' }, h), /NOT_PRICED/);
  await assert.rejects(() => manualAuraOllamaCompletion({ model: 'gpt-oss:120b-cloud', system: 's', user: 'u' }, h), /DAILY_BUDGET_LIMIT/);
  assert.equal(h.events.length, 0);
});

test('Aura catalog accepts every configured priced model, deduplicates and rejects unknown prices', () => {
  assert.deepEqual(auraOllamaModelCatalog({ JACO_AURA_OLLAMA_CLOUD_MODELS: 'gpt-oss:120b,gpt-oss:120b,unknown', JACO_AURA_PROVIDER_PRICES_JSON:'{"ollama-cloud/gpt-oss:120b":{"input":0.15,"output":0.6}}' }), ['gpt-oss:120b']);
  assert.throws(() => ollamaCloudCostUsd('gpt-oss:120b', 1, 1, {}), /NOT_PRICED/);
  const env = { JACO_AURA_OLLAMA_CLOUD_MODELS: 'next-model:cloud', JACO_OLLAMA_CLOUD_PRICES_JSON: '{"next-model:cloud":{"input":2,"output":4}}' };
  assert.deepEqual(auraOllamaModelCatalog(env), ['next-model:cloud']);
  assert.equal(ollamaCloudCostUsd('next-model:cloud', 1_000_000, 1_000_000, env), 6);
  assert.throws(() => auraOllamaModelCatalog({ ...env, JACO_OLLAMA_CLOUD_PRICES_JSON: '{"next-model:cloud":{"input":0,"output":4}}' }), /PRICE_INVALID/);
});

test('manual Aura Cloud holds reservation when provider usage is unknown', async () => {
  const h = harness({ usage: null });
  const result = await manualAuraOllamaCompletion({ model: 'gpt-oss:120b-cloud', system: 's', user: 'u' }, h);
  assert.equal(result.costStatus, 'OUTCOME_UNKNOWN');
  assert.deepEqual(h.events.map(e => e[0]), ['reserve', 'chat', 'unknown']);
});

test('manual Aura Cloud holds reservation after a dispatched request fails', async () => {
  const h = harness({ fail: true });
  await assert.rejects(() => manualAuraOllamaCompletion({ model: 'gpt-oss:120b-cloud', system: 's', user: 'u' }, h), /provider failed/);
  assert.deepEqual(h.events.map(e => e[0]), ['reserve', 'chat', 'unknown']);
});

test('manual Aura Cloud releases reservation after a clear subscription rejection', async () => {
  const h = harness({ paymentRequired: true });
  await assert.rejects(() => manualAuraOllamaCompletion({ model: 'deepseek-v4-pro:cloud', system: 's', user: 'u' }, h), /HTTP_402/);
  assert.deepEqual(h.events.map(e => e[0]), ['reserve', 'chat', 'release']);
});

test('EconomicGovernor authorizes manual Aura chat without enabling background cloud work', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-aura-economic-'));
  try {
    const economic = new EconomicGovernor(root, { append() {} });
    assert.equal(economic.snapshot().policy.cloudEnabled, true, 'cloud is on until the operator turns it off');
    economic.updatePolicy({ cloudEnabled: false, manualAuraCloudEnabled: false, novaOllamaCloudEnabled: false }, 'operator');
    assert.equal(economic.authorizeCloud({ estimatedUsd: 0.01, purpose: 'manual-aura-chat' }).allowed, false);
    economic.updatePolicy({ manualAuraCloudEnabled: true, dailyCloudUsd: 1 }, 'operator');
    assert.equal(economic.snapshot().policy.cloudEnabled, false);
    assert.equal(economic.authorizeCloud({ estimatedUsd: 0.01, purpose: 'reasoning' }).allowed, false);
    assert.equal(economic.authorizeCloud({ estimatedUsd: 0.01, purpose: 'manual-aura-chat' }).allowed, true);
    economic.updatePolicy({ novaOllamaCloudEnabled: true }, 'operator');
    assert.equal(economic.authorizeCloud({ estimatedUsd: 0.01, purpose: 'nova-ollama-cloud' }).allowed, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Nova Ollama Cloud call reserves and settles through the runtime before accepting a plan', async () => {
  const paths = [];
  const fetchImpl = async (url, options) => {
    paths.push(new URL(url).pathname);
    if (url.endsWith('/reserve')) return Response.json({ success: true, reservationId: 'r1' });
    if (url.endsWith('/settle')) return Response.json({ success: true, costUsd: 0.001 });
    return Response.json({ choices: [{ message: { content: '{"complete":true}' } }], usage: { prompt_tokens: 20, completion_tokens: 5 } });
  };
  const result = await budgetedNovaOllamaCall({
    provider: { model: 'gpt-oss:120b', url: 'https://ollama.com/v1/chat/completions', key: 'test' },
    requestBody: { model: 'gpt-oss:120b', messages: [{ role: 'user', content: 'plan' }], max_tokens: 700 },
    runtimeUrl: 'http://127.0.0.1:3000', token: 'test', fetchImpl,
  });
  assert.equal(result.data.choices[0].message.content, '{"complete":true}');
  assert.deepEqual(paths, ['/api/nova/ollama-cost/reserve', '/v1/chat/completions', '/api/nova/ollama-cost/settle']);
});

test('Nova Ollama Cloud retains reservation if provider usage is unknown', async () => {
  const paths = [];
  const fetchImpl = async url => {
    paths.push(new URL(url).pathname);
    if (url.endsWith('/reserve')) return Response.json({ success: true, reservationId: 'r1' });
    if (url.endsWith('/unknown')) return Response.json({ success: true, status: 'OUTCOME_UNKNOWN' });
    return Response.json({ choices: [{ message: { content: 'plan' } }] });
  };
  await assert.rejects(() => budgetedNovaOllamaCall({
    provider: { model: 'gpt-oss:120b', url: 'https://ollama.com/v1/chat/completions', key: 'test' },
    requestBody: { model: 'gpt-oss:120b', messages: [{ role: 'user', content: 'plan' }], max_tokens: 700 },
    runtimeUrl: 'http://127.0.0.1:3000', token: 'test', fetchImpl,
  }), /OUTCOME_UNKNOWN/);
  assert.deepEqual(paths, ['/api/nova/ollama-cost/reserve', '/v1/chat/completions', '/api/nova/ollama-cost/unknown']);
});
