import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { modelPrice } from '../../runtime/src/server/aura/costEngine.mjs';
import { priceCatalogFile, syncPrices, syncedPrice } from '../../runtime/src/server/aura/priceCatalog.mjs';
import { EconomicGovernor } from '../../runtime/src/server/continuum/economicGovernor.mjs';
import { agentOrderRevenue, createEconomicBudgetRouter } from '../../runtime/src/server/connected/economicBudget.mjs';
const express = createRequire(new URL('../../runtime/package.json', import.meta.url))('express');

const state = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-prices-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return { JACO_STATE_DIR: dir }; };
const filler = Object.fromEntries(Array.from({ length: 60 }, (_, i) => ['filler-' + i, { mode: 'chat', litellm_provider: 'filler', input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 }]));
const litellm = { ...filler,
  'gemini/gemini-2.5-flash': { mode: 'chat', litellm_provider: 'gemini', input_cost_per_token: 3e-7, output_cost_per_token: 2.5e-6 },
  'deepseek/deepseek-flash': { mode: 'chat', litellm_provider: 'deepseek', input_cost_per_token: 3e-7, output_cost_per_token: 1.2e-6 },
  'deepseek/deepseek-pro': { mode: 'chat', litellm_provider: 'deepseek', input_cost_per_token: 2e-6, output_cost_per_token: 8e-6 },
  'gemini/embed': { mode: 'embedding', litellm_provider: 'gemini', input_cost_per_token: 1e-7, output_cost_per_token: 0 },
  'broken/model': { mode: 'chat', litellm_provider: 'broken', input_cost_per_token: 5, output_cost_per_token: 5 } };
const openrouter = { data: [...Array.from({ length: 60 }, (_, i) => ({ id: 'vendor/m' + i, pricing: { prompt: '0.000001', completion: '0.000002' } })),
  { id: 'google/gemini-2.5-flash', pricing: { prompt: '0.000009', completion: '0.000009' } }, { id: 'acme/free:free', pricing: { prompt: '0', completion: '0' } }, { id: 'acme/auto', pricing: { prompt: '-1', completion: '-1' } }] };
const feed = (or, ll) => async url => { const body = String(url).includes('openrouter') ? or : ll; if (body === null) return new Response('down', { status: 503 }); return Response.json(body); };

test('prices come from the live catalogs, the provider list beats the reseller, and bad rows are dropped', async t => {
  const env = state(t);
  const result = await syncPrices({ env, fetchImpl: feed(openrouter, litellm) });
  assert.equal(result.ok, true);
  const flash = modelPrice('gemini', 'models/gemini-2.5-flash', env);
  assert.deepEqual([flash.input, flash.output, flash.source], [0.3, 2.5, 'litellm']);
  assert.equal(modelPrice('deepseek', 'deepseek-flash', env).output, 1.2);
  assert.equal(syncedPrice('gemini', 'embed', env), null, 'not a chat model');
  assert.equal(syncedPrice('broken', 'model', env), null, 'an absurd rate is not believed');
  assert.equal(syncedPrice('openrouter', 'acme/auto', env), null, 'a variable rate is not a price');
  assert.equal(syncedPrice('openrouter', 'acme/free:free', env).free, true);
  const unlisted = modelPrice('deepseek', 'deepseek-next', env);
  assert.deepEqual([unlisted.output, unlisted.source], [8, 'provider-highest'], 'an unlisted model can only be overstated');
  const own = modelPrice('my-own-api', 'm', env);
  assert.equal(own.source, 'catalog-median', 'a provider the operator added is estimated from the market, not refused');
  assert.ok(own.input > 0 && own.output > 0);
  assert.throws(() => modelPrice('my-own-api', 'm', state(t)), /MODEL_PRICE_UNKNOWN/, 'no catalog at all: no made-up number');
});

test('a failed or truncated source keeps the last known prices', async t => {
  const env = state(t);
  await syncPrices({ env, fetchImpl: feed(openrouter, litellm), now: () => '2026-01-01T00:00:00.000Z' });
  const before = fs.readFileSync(priceCatalogFile(env), 'utf8');
  const down = await syncPrices({ env, fetchImpl: feed(null, null) });
  assert.equal(down.ok, false);
  assert.equal(down.fetchedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(fs.readFileSync(priceCatalogFile(env), 'utf8'), before);
  const partial = await syncPrices({ env, fetchImpl: feed(openrouter, { 'gemini/x': litellm['gemini/gemini-2.5-flash'] }) });
  assert.equal(partial.ok, true);
  assert.equal(partial.sources.find(s => s.id === 'litellm').error, 'CATALOG_TOO_SMALL');
  assert.equal(modelPrice('gemini', 'gemini-2.5-flash', env).source, 'litellm', 'the failed source keeps its rows');
});

const events = () => ({ append() {} });
const budgetServer = async (t, deps) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-economy-'));
  const economic = new EconomicGovernor(dir, events());
  const app = express(); app.use(express.json());
  app.use('/budget', createEconomicBudgetRouter({ economic, requireOperatorUi: (_req, _res, next) => next(), ...deps }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { economic, url: 'http://127.0.0.1:' + server.address().port + '/budget/economy' };
};

test('the economy view books cost per model, adds up income and never turns an unread source into zero', async t => {
  const { economic, url } = await budgetServer(t, {
    getStripeRevenue: async () => ({ configured: true, last30Days: { paidCharges: 1, revenue: { USD: 10 }, complete: true } }),
    getAgentOrders: () => ({ a: { status: 'CHARGED', amountCharged: 2 }, b: { status: 'PAID', amountUsd: 3 }, c: { status: 'PAID_NEEDS_OPERATOR' }, d: { status: 'MISSION_CREATED', amountUsd: 9 } }),
    getBalances: async () => ({ deepseek: { ok: true, usd: 0, currency: 'USD' } }),
    listProviders: () => [{ id: 'ollama', defaultModel: 'local', local: true }, { id: 'gemini', defaultModel: 'g', local: false }, { id: 'nope', defaultModel: 'n', local: false }],
    modelPrice: provider => { if (provider === 'gemini') return { input: 0.3, output: 2.5, source: 'litellm' }; throw new Error('MODEL_PRICE_UNKNOWN'); },
    readPrices: () => ({ fetchedAt: '2026-01-01T00:00:00.000Z', sources: [{ id: 'litellm', ok: true }] }),
  });
  const r = economic.authorizeCloud({ estimatedUsd: 0.01, purpose: 'manual-aura-chat', metadata: { providerId: 'deepseek', model: 'g', priceSource: 'litellm' } });
  economic.settleCloud(r.reservationId, 0.005, { prompt_tokens: 100, completion_tokens: 20 });
  const { economy } = await fetch(url).then(res => res.json());
  const row = economy.costs.models[0];
  assert.deepEqual([row.model, row.calls, row.inputTokens, row.outputTokens, row.priceSource], ['g', 1, 100, 20, 'litellm']);
  assert.equal(economy.costs.legacyEstimateUsd, 0);
  assert.equal(economy.revenue.orders.usd, 5);
  assert.equal(economy.revenue.orders.needsOperator, 1);
  assert.equal(economy.revenue.last30DaysByCurrency.USD, 15);
  assert.equal(Math.round(economy.result.last30DaysUsd * 1000), 14995);
  assert.equal(economy.result.reason, null);
  assert.equal(economy.prices.inUse.find(p => p.provider === 'nope').known, false);
  assert.equal(economy.prices.inUse.find(p => p.provider === 'ollama').local, true);
});

test('income in another currency or an unread Stripe is stated instead of a false result', async t => {
  const foreign = await budgetServer(t, { getStripeRevenue: async () => ({ configured: true, last30Days: { revenue: { SEK: 100 } } }) });
  assert.equal((await fetch(foreign.url).then(res => res.json())).economy.result.last30DaysUsd, null);
  const unread = await budgetServer(t, { getStripeRevenue: async () => { throw new Error('boom'); } });
  const { economy } = await fetch(unread.url).then(res => res.json());
  assert.equal(economy.revenue.stripe.error, 'boom');
  assert.match(economy.result.reason, /Stripe/);
  assert.deepEqual(agentOrderRevenue({ x: { status: 'CHARGED', amountCharged: 'bad' } }), { usd: 0, paid: 0, needsOperator: 0 });
});
