import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auraCostQuote, auraCostSettlement, modelPrice, novaProviderCostUsd,
  ollamaCloudCostUsd, REFERENCE_PRICE,
} from '../../runtime/src/server/aura/costEngine.mjs';
import {
  auraCostQuote as legacyAuraCostQuote,
  manualAuraProviderCompletion,
} from '../../runtime/src/server/connected/auraOllamaChat.mjs';

test('Aura owns one pricing function for SEER, Nova and manual chat compatibility', () => {
  assert.equal(legacyAuraCostQuote, auraCostQuote, 'legacy chat import delegates to the canonical Aura engine');
  const env = { JACO_AURA_PROVIDER_PRICES_JSON: JSON.stringify({ 'deepseek/fast': { input: 2, output: 6 } }) };
  const quote = auraCostQuote({ providerId: 'deepseek', model: 'fast', promptBytes: 1000, maxTokens: 100, env });
  assert.equal(quote.schema, 'jaco.aura-cost-quote/v1');
  assert.equal(quote.priceSource, 'configured');
  assert.equal(quote.providerInvoiceVerified, false);
  assert.equal(quote.estimatedUsd, 0.0026);
  assert.equal(novaProviderCostUsd('deepseek', 'fast', 1000, 100, env), quote.estimatedUsd);
  assert.equal(auraCostSettlement(quote, { prompt_tokens: 100, completion_tokens: 40 }).costUsd, 0.00044);
});

test('Aura settlement keeps the reserved price snapshot across config changes', () => {
  const env = { JACO_AURA_PROVIDER_PRICES_JSON: JSON.stringify({ 'gemini/custom': { input: 1, output: 4 } }) };
  const quote = auraCostQuote({ providerId: 'gemini', model: 'custom', promptBytes: 500, maxTokens: 50, env });
  const stored = JSON.parse(JSON.stringify(quote));
  env.JACO_AURA_PROVIDER_PRICES_JSON = JSON.stringify({ 'gemini/custom': { input: 70, output: 400 } });
  const result = auraCostSettlement(stored, { prompt_tokens: 100, completion_tokens: 20 });
  assert.equal(result.costUsd, 0.00018);
  assert.equal(result.priceSource, 'configured');
  assert.equal(result.providerInvoiceVerified, false);
  assert.equal(modelPrice('gemini', 'custom', env).input, 70, 'the current rate really changed');
});

test('Aura never silently settles missing, excessive, forged or malformed usage', () => {
  const quote = auraCostQuote({ providerId: 'deepseek', model: 'm', promptBytes: 300, maxTokens: 10, env: {} });
  for (const usage of [
    {}, null, { prompt_tokens: null, completion_tokens: 1 },
    { prompt_tokens: 301, completion_tokens: 1 },
    { prompt_tokens: 3, completion_tokens: 11 },
    { prompt_tokens: -1, completion_tokens: 2 },
    { prompt_tokens: 1.1, completion_tokens: 2 },
  ]) assert.throws(() => auraCostSettlement(quote, usage), /AURA_COST_USAGE_OUTSIDE_RESERVATION/);
  assert.throws(() => auraCostSettlement({ ...quote, estimatedUsd: 0 }, { prompt_tokens: 1, completion_tokens: 1 }), /AURA_COST_QUOTE_INVALID/);
  assert.throws(() => auraCostSettlement({ ...quote, schema: 'jaco.fake' }, { prompt_tokens: 1, completion_tokens: 1 }), /AURA_COST_QUOTE_INVALID/);
  assert.throws(() => auraCostQuote({ providerId: 'x', model: 'm', promptBytes: 0, maxTokens: 10 }), /AURA_COST_QUOTE_INVALID_INPUT/);
});

test('Aura explicitly distinguishes configured, reference and OpenRouter free rate provenance', () => {
  const fallback = auraCostQuote({ providerId: 'unknown', model: 'some-model', promptBytes: 1000, maxTokens: 200, env: {} });
  assert.equal(fallback.priceSource, 'reference');
  assert.deepEqual([fallback.inputUsdPerMillion, fallback.outputUsdPerMillion], [REFERENCE_PRICE.input, REFERENCE_PRICE.output]);
  const free = auraCostQuote({ providerId: 'openrouter', model: 'any:free', promptBytes: 1000, maxTokens: 100, env: {} });
  assert.equal(free.estimatedUsd, 0);
  assert.equal(free.priceSource, 'free');
  const notFree = auraCostQuote({ providerId: 'unknown', model: 'any:free', promptBytes: 1000, maxTokens: 100, env: {} });
  assert.ok(notFree.estimatedUsd > 0, 'no arbitrary provider can label itself free');
  const env = { JACO_OLLAMA_CLOUD_PRICES_JSON: JSON.stringify({ model: { input: 2, output: 4 } }) };
  const ollama = auraCostQuote({ providerId: 'ollama-cloud', model: 'model', promptBytes: 1000, maxTokens: 100, env });
  assert.equal(ollama.estimatedUsd, ollamaCloudCostUsd('model', 1000, 100, env));
  assert.equal(ollama.priceSource, 'configured');
  assert.throws(() => auraCostQuote({ providerId: 'ollama-cloud', model: 'unpriced', promptBytes: 1000, maxTokens: 100, env }), /OLLAMA_CLOUD_MODEL_NOT_PRICED/);
});

test('manual Aura chat reserves and settles through Aura Cost Engine, not a second formula', async () => {
  const env = { JACO_AURA_PROVIDER_PRICES_JSON: JSON.stringify({ 'example/m': { input: 2, output: 4 } }) };
  const records = [];
  const economic = {
    authorizeCloud(input) {
      records.push(['reserve', input]);
      assert.equal(input.metadata?.auraCostQuote?.schema, 'jaco.aura-cost-quote/v1');
      return { allowed: true, reservationId: 'r1' };
    },
    settleCloud(id, cost, usage) { records.push(['settle', { id, cost, usage }]); },
    markCloudOutcomeUnknown(id, reason) { records.push(['unknown', { id, reason }]); },
    releaseReservation(id, reason) { records.push(['release', { id, reason }]); },
  };
  const providers = {
    list: () => [{ id: 'example', baseUrl: 'https://example.test/v1', defaultModel: 'm', credentialConfigured: true }],
    async chat() {
      // A configured price changing during a running call cannot change this reservation's USD settlement.
      env.JACO_AURA_PROVIDER_PRICES_JSON = JSON.stringify({ 'example/m': { input: 200, output: 400 } });
      return { content: 'ok', usage: { prompt_tokens: 8, completion_tokens: 3 } };
    },
  };
  const result = await manualAuraProviderCompletion({ providerId: 'example', model: 'm', system: 'system', user: 'user' }, { env, economic, providers });
  assert.equal(result.costStatus, 'SETTLED');
  assert.equal(result.providerInvoiceVerified, false);
  const savedQuote = records[0][1].metadata.auraCostQuote;
  assert.equal(result.costUsd, auraCostSettlement(savedQuote, { prompt_tokens: 8, completion_tokens: 3 }).costUsd);
  assert.equal(result.costUsd, 0.000028);
  assert.deepEqual(records.map(x => x[0]), ['reserve', 'settle']);
});

test('manual Aura chat leaves unknown usage unverified, rather than inventing a charge', async () => {
  const records = [];
  const economic = {
    authorizeCloud: () => ({ allowed: true, reservationId: 'r1' }),
    settleCloud: () => records.push('settle'),
    markCloudOutcomeUnknown: () => records.push('unknown'),
  };
  const providers = {
    list: () => [{ id: 'example', baseUrl: 'https://example.test/v1', defaultModel: 'm', credentialConfigured: true }],
    chat: async () => ({ content: 'ok', usage: { completion_tokens: 2 } }),
  };
  const result = await manualAuraProviderCompletion({ providerId: 'example', model: 'm', system: 'system', user: 'user' }, { env: {}, economic, providers });
  assert.equal(result.costStatus, 'OUTCOME_UNKNOWN');
  assert.deepEqual(records, ['unknown']);
});
