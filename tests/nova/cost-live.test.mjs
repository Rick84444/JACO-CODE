import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EconomicGovernor } from '../../runtime/src/server/continuum/economicGovernor.mjs';
import { createBalanceFetcher } from '../../runtime/src/server/connected/providerBalances.mjs';
import { createEconomicBudgetRouter } from '../../runtime/src/server/connected/economicBudget.mjs';
import { budgetedNovaOllamaCall, DEFINITE_NO_CHARGE } from '../../agents/lib/nova-ollama-cost.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-cost-live-'));
const events = () => { const list = []; return { list, append: e => list.push(e) }; };
const governor = (extra = {}) => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'economic-policy.json'), JSON.stringify({ cloudEnabled: true, novaOllamaCloudEnabled: true, dailyCloudUsd: 100, monthlyCloudUsd: 1000, maxCloudUsdPerTask: 50, ...extra }));
  const ev = events();
  return { g: new EconomicGovernor(dir, ev), dir, ev };
};
const reserve = (g, usd, providerId = 'deepseek') => g.authorizeCloud({ estimatedUsd: usd, purpose: 'nova-ollama-cloud', metadata: { providerId } });

test('settled spend is tallied per provider and shown apart from the governor accounting', () => {
  const { g } = governor();
  const a = reserve(g, 1.0, 'deepseek'); g.settleCloud(a.reservationId, 0.12, { prompt_tokens: 10 });
  const b = reserve(g, 0.5, 'groq'); g.settleCloud(b.reservationId, 0.01);
  const live = g.liveSnapshot();
  assert.equal(Number(live.today.usd.toFixed(2)), 0.13);
  assert.equal(live.today.calls, 2);
  assert.equal(Number(live.today.byProvider.deepseek.usd.toFixed(2)), 0.12);
  assert.equal(Number(live.today.estimatedUsd.toFixed(2)), 1.5, 'the worst-case estimates stay visible, labelled as estimates');
  assert.equal(Number(live.lastHourUsd.toFixed(2)), 0.13);
  assert.equal(live.unknown.count, 0);
});

test('unconfirmed reservations are reported as unknown and, once expired, as expired - never as settled spend', () => {
  const { g } = governor();
  const r = reserve(g, 2.0); g.markCloudOutcomeUnknown(r.reservationId, 'timeout');
  let live = g.liveSnapshot();
  assert.deepEqual([live.unknown.count, live.unknown.usd], [1, 2]);
  assert.equal(live.today.usd, 0);
  g.state.reservations[r.reservationId].createdAt = new Date(Date.now() - 3 * 3600e3).toISOString();
  live = g.liveSnapshot();
  assert.equal(live.unknown.count, 0);
  assert.equal(live.today.usd, 0, 'expired is not measured spend');
  assert.equal(live.month.expiredUsd, 2);
  assert.equal(live.governor.monthlySpentUsd >= 2, true, 'the conservative governor counter still counts it');
});

test('the tally survives a restart', () => {
  const { g, dir } = governor();
  const r = reserve(g, 1); g.settleCloud(r.reservationId, 0.4);
  const again = new EconomicGovernor(dir, events());
  assert.equal(Number(again.liveSnapshot().today.usd.toFixed(2)), 0.4);
});

test('history in the ledger seeds the tally once, without double counting later events', async () => {
  const { g, dir } = governor();
  const ledger = path.join(dir, 'events.jsonl');
  const old = new Date(Date.now() - 2 * 86400e3).toISOString();
  fs.writeFileSync(ledger, [
    { type: 'cloud.cost_settled', timestamp: old, data: { estimatedUsd: 1, actualUsd: 0.1, purpose: 'x', metadata: { providerId: 'deepseek' } } },
    { type: 'cloud.cost_expired', timestamp: old, data: { estimatedUsd: 3, countedUsd: 3, purpose: 'x', metadata: { providerId: 'deepseek' } } },
    { type: 'cloud.cost_settled', timestamp: new Date(Date.now() + 5000).toISOString(), data: { estimatedUsd: 9, actualUsd: 9, purpose: 'x' } },
  ].map(e => JSON.stringify(e)).join('\n'));
  assert.deepEqual(await g.seedFromLedger(ledger), { seeded: true, events: 2 });
  assert.deepEqual(await g.seedFromLedger(ledger), { seeded: false });
  const day = old.slice(0, 10);
  assert.equal(g.state.tally.days[day].expiredUsd, 3);
  assert.equal(Number(g.state.tally.days[day].providers.deepseek.usd.toFixed(2)), 0.1);
  assert.equal(JSON.stringify(g.state.tally).includes('"usd":9'), false);
});

test('a provider error with no generation releases the reservation instead of leaving it unknown', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    if (String(url).includes('/api/nova/ollama-cost/')) return new Response(JSON.stringify({ success: true, reservationId: 'r1' }), { status: 200 });
    return new Response(JSON.stringify({ error: { message: 'Request too large' } }), { status: 413 });
  };
  const out = await budgetedNovaOllamaCall({ provider: { name: 'groq', model: 'm', url: 'https://p.example/v1', key: 'k' }, requestBody: { max_tokens: 10 }, runtimeUrl: 'http://127.0.0.1:3000', token: 't', fetchImpl });
  assert.equal(out.response.status, 413);
  assert.equal(out.data.error.message, 'Request too large');
  assert.ok(calls.some(u => u.endsWith('/ollama-cost/release')), 'released');
  assert.ok(!calls.some(u => u.endsWith('/ollama-cost/unknown')), 'not left unknown');
  assert.ok(DEFINITE_NO_CHARGE.has(402) && DEFINITE_NO_CHARGE.has(429) && !DEFINITE_NO_CHARGE.has(500) && !DEFINITE_NO_CHARGE.has(504));
});

test('a server error or a missing usage block stays unknown because the money may have been spent', async () => {
  const seen = [];
  const fetchImpl = async url => {
    seen.push(String(url));
    if (String(url).includes('/api/nova/ollama-cost/')) return new Response(JSON.stringify({ success: true, reservationId: 'r1' }), { status: 200 });
    return new Response('upstream broke', { status: 502 });
  };
  await assert.rejects(budgetedNovaOllamaCall({ provider: { name: 'deepseek', model: 'm', url: 'https://p.example/v1', key: 'k' }, requestBody: { max_tokens: 10 }, runtimeUrl: 'http://127.0.0.1:3000', token: 't', fetchImpl }), /NOVA_CLOUD_COST_OUTCOME_UNKNOWN/);
  assert.ok(seen.some(u => u.endsWith('/ollama-cost/unknown')));
});

test('balance is the provider number, cached, and a failure is a failure and not zero', async () => {
  let hits = 0; let t = 1000;
  const fetchImpl = async () => { hits += 1; return new Response(JSON.stringify({ is_available: true, balance_infos: [{ currency: 'USD', total_balance: '2.43' }] }), { status: 200 }); };
  const get = createBalanceFetcher({ env: { DEEPSEEK_API_KEY: 'k' }, fetchImpl, now: () => t });
  const first = await get(); await get();
  assert.deepEqual([first.deepseek.ok, first.deepseek.usd, hits], [true, 2.43, 1]);
  t += 31_000; await get(); assert.equal(hits, 2);
  const none = await createBalanceFetcher({ env: {}, fetchImpl })();
  assert.deepEqual([none.deepseek.ok, none.deepseek.error], [false, 'DEEPSEEK_API_KEY_MISSING']);
  const down = await createBalanceFetcher({ env: { DEEPSEEK_API_KEY: 'k' }, fetchImpl: async () => new Response('x', { status: 503 }) })();
  assert.equal(down.deepseek.ok, false);
});

test('GET /live returns the measured numbers and the runway from the real balance', async () => {
  const { g } = governor();
  const r = reserve(g, 1); g.settleCloud(r.reservationId, 1.2);
  const router = createEconomicBudgetRouter({ economic: g, requireOperatorUi: (_q, _s, n) => n(), getBalances: async () => ({ deepseek: { ok: true, usd: 2.4 } }) });
  const layer = router.stack.find(l => l.route?.path === '/live');
  let body; await layer.route.stack[0].handle({}, { json: v => { body = v; }, status: () => ({ json: v => { body = v; } }) });
  assert.equal(body.success, true);
  assert.equal(Number(body.live.today.usd.toFixed(2)), 1.2);
  assert.equal(body.runwayMinutes, 120, '2.40 USD at 1.20 USD per hour is two hours');
});

test('recalibrating sets the counters to measured spend, drops expired estimates, and is recorded', () => {
  const { g, ev } = governor();
  const ok = reserve(g, 1); g.settleCloud(ok.reservationId, 0.5);
  const lost = reserve(g, 40); g.markCloudOutcomeUnknown(lost.reservationId, 'timeout');
  g.state.reservations[lost.reservationId].createdAt = new Date(Date.now() - 3 * 3600e3).toISOString();
  assert.ok(g.liveSnapshot().governor.monthlySpentUsd >= 40, 'the expired estimate inflated the conservative counter');
  const out = g.recalibrateToMeasured('test');
  assert.ok(out.before.monthlySpentUsd >= 40);
  assert.equal(Number(out.after.monthlySpentUsd.toFixed(2)), 0.5);
  assert.equal(Number(out.after.dailySpentUsd.toFixed(2)), 0.5);
  const event = ev.list.find(e => e.type === 'economic.recalibrated');
  assert.equal(event.actor, 'test');
  assert.equal(event.data.expiredExcludedUsd, 40);
});

test('cost caps belong to the operator: none is built in, any amount can be set, and null turns a cap off', () => {
  const { g } = governor();
  assert.equal(g.updatePolicy({ monthlyCloudUsd: 100000, maxCloudUsdPerTask: 50 }).policy.monthlyCloudUsd, 100000, 'no hidden ceiling');
  assert.equal(g.updatePolicy({ dailyCloudUsd: 20, monthlyCloudUsd: 100, maxCloudUsdPerTask: 0.25 }).policy.monthlyCloudUsd, 100);
  assert.equal(g.authorizeCloud({ estimatedUsd: 0.5, purpose: 'reasoning' }).reason, 'TASK_COST_LIMIT');
  const off = g.updatePolicy({ dailyCloudUsd: null, monthlyCloudUsd: null, maxCloudUsdPerTask: null });
  assert.deepEqual([off.policy.dailyCloudUsd, off.headroom.dailyUsd, off.headroom.monthlyUsd], [null, null, null]);
  assert.equal(g.authorizeCloud({ estimatedUsd: 50, purpose: 'reasoning' }).allowed, true, 'no cap, no budget stop');
});

test('uncapped autonomous cloud calls trip a persisted burst fuse but manual Aura chat remains available', () => {
  const { g, dir } = governor({ dailyCloudUsd: null, monthlyCloudUsd: null, maxCloudUsdPerTask: null });
  const policy = g.snapshot().policy;
  assert.equal(policy.maxAutonomousCloudCallsPer15m, 12);
  for (let i = 0; i < 12; i++) assert.equal(g.authorizeCloud({ estimatedUsd: 0.01, purpose: 'nova-ollama-cloud' }).allowed, true, String(i));
  const blocked = g.authorizeCloud({ estimatedUsd: 0.01, purpose: 'nova-ollama-cloud' });
  assert.equal(blocked.reason, 'AUTONOMOUS_CLOUD_BURST_LIMIT');
  assert.equal(g.liveSnapshot().autonomousCloudCallsLast15m, 12);
  const restarted = new EconomicGovernor(dir, events());
  assert.equal(restarted.authorizeCloud({ estimatedUsd: 0.01, purpose: 'nova-ollama-cloud' }).reason, 'AUTONOMOUS_CLOUD_BURST_LIMIT', 'process restart cannot reset the fuse');
  assert.equal(restarted.authorizeCloud({ estimatedUsd: 0.01, purpose: 'manual-aura-chat' }).allowed, true, 'operator Aura conversation can still work');
  restarted.state.autonomousCloudCalls = restarted.state.autonomousCloudCalls.map(() => Date.now() - 16 * 60_000);
  assert.equal(restarted.authorizeCloud({ estimatedUsd: 0.01, purpose: 'nova-ollama-cloud' }).allowed, true, 'calls resume after the window');
});

test('Aura budget policy can configure the autonomous fuse without changing monetary caps', () => {
  const { g } = governor({ dailyCloudUsd: null, monthlyCloudUsd: null, maxCloudUsdPerTask: null });
  for (const value of [0, -1, 0.5, Infinity, '12', 10001]) {
    assert.throws(() => g.updatePolicy({ maxAutonomousCloudCallsPer15m: value }), /ECONOMIC_POLICY_AUTONOMOUS_CALL_LIMIT_INVALID/);
  }
  g.updatePolicy({ maxAutonomousCloudCallsPer15m: 2 });
  assert.equal(g.authorizeCloud({ estimatedUsd: 0.01, purpose: 'nova-ollama-cloud' }).allowed, true);
  assert.equal(g.authorizeCloud({ estimatedUsd: 0.01, purpose: 'nova-ollama-cloud' }).allowed, true);
  assert.equal(g.authorizeCloud({ estimatedUsd: 0.01, purpose: 'nova-ollama-cloud' }).reason, 'AUTONOMOUS_CLOUD_BURST_LIMIT');
  const off = g.updatePolicy({ maxAutonomousCloudCallsPer15m: null });
  assert.equal(off.policy.maxAutonomousCloudCallsPer15m, null);
  assert.equal(g.authorizeCloud({ estimatedUsd: 0.01, purpose: 'nova-ollama-cloud' }).allowed, true);
  assert.deepEqual([off.policy.dailyCloudUsd, off.policy.monthlyCloudUsd, off.policy.maxCloudUsdPerTask], [null,null,null]);
});
