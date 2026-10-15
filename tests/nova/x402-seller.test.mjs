// Operator 2026-10-02: agents pay for the repo scan in USDC on Base through Coinbase's x402 facilitator.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const x = await import('../../agents/lib/x402-seller.mjs');
const { purchaseX402, offer } = await import('../../agents/lib/agent-orders.mjs');

const payTo = '0x' + 'ab'.repeat(20);
const env = { X402_PAY_TO: payTo, CDP_API_KEY_ID: 'id', CDP_API_KEY_SECRET: 'secret', SKYFIRE_REPO_SCAN_PRICE_USD: '9', JACO_GATEWAY_PUBLIC_URL: 'https://api.example.test' };
const header = accepted => x.encodeHeader({ x402Version: 2, accepted, payload: { signature: '0xsig', authorization: { from: '0xbuyer' } } });

test('the offer is 9 USDC on Base to the configured wallet, and nothing is offered without one', () => {
  assert.deepEqual(x.paymentRequirements(env), { scheme: 'exact', network: 'eip155:8453', asset: x.USDC_BASE, amount: '9000000', payTo, maxTimeoutSeconds: 300, extra: { name: 'USD Coin', version: '2' } });
  assert.equal(x.paymentRequired('https://api.example.test/v1/repo-scan', env).accepts.length, 1);
  assert.deepEqual(x.paymentRequired('u', { ...env, X402_PAY_TO: '' }).accepts, [], 'no wallet, no payment option');
  assert.equal(offer(env).payment.find(p => p.method === 'x402').configured, true);
  // Bazaar discovery: POST with a JSON body example, so agents searching the Bazaar can call it.
  const bazaar = x.paymentRequired('u', env).extensions.bazaar;
  assert.deepEqual(bazaar.info.input, { type: 'http', method: 'POST', bodyType: 'json', body: { repo: 'https://github.com/OWASP/NodeGoat' } });
  assert.equal(bazaar.routeTemplate, '/v1/repo-scan');
  assert.deepEqual(bazaar.schema.properties.input.required, ['type', 'method', 'bodyType', 'body']);
});

test('a payment for another amount, asset or receiver is refused before reaching Coinbase', () => {
  const ok = x.paymentRequirements(env);
  assert.equal(x.matchesRequirements(x.decodePayment(header(ok)), env), true);
  for (const bad of [{ amount: '1' }, { asset: '0x' + '11'.repeat(20) }, { payTo: '0x' + 'cd'.repeat(20) }, { network: 'eip155:84532' }]) {
    assert.equal(x.matchesRequirements(x.decodePayment(header({ ...ok, ...bad })), env), false, JSON.stringify(bad));
  }
});

test('verify then settle via the facilitator; invalid or unsettled payments start nothing', async () => {
  const calls = [];
  const client = (verify, settle) => ({ verify: async (...a) => { calls.push('verify'); assert.equal(a[1].payTo, payTo); return verify; }, settle: async () => { calls.push('settle'); return settle; } });
  const h = header(x.paymentRequirements(env));
  const ok = await x.verifyAndSettle(h, { env, client: client({ isValid: true, payer: '0xbuyer' }, { success: true, transaction: '0xtx' }) });
  assert.deepEqual([ok.ok, ok.order, ok.settlement.transaction], [true, x.orderIdFor(h), '0xtx']);
  assert.deepEqual(calls, ['verify', 'settle']);
  const invalid = await x.verifyAndSettle(h, { env, client: client({ isValid: false, invalidReason: 'insufficient_funds' }, null) });
  assert.equal(invalid.error, 'X402_INVALID:insufficient_funds');
  assert.equal((await x.verifyAndSettle(h, { env: { ...env, X402_PAY_TO: '' } })).error, 'X402_NOT_CONFIGURED');
  assert.equal((await x.verifyAndSettle('not-base64-json', { env, client: client({}, {}) })).error, 'X402_PAYMENT_MALFORMED');
});

test('a settled payment becomes one mission; replay is refused; a paid order that cannot start is kept for the operator', async () => {
  const state = {};
  const missions = [];
  const h = header(x.paymentRequirements(env));
  const settle = async () => ({ ok: true, payer: '0xbuyer', settlement: { success: true, transaction: '0xtx' } });
  const r = await purchaseX402({ paymentHeader: h, repo: 'https://github.com/acme/demo', env, state, createMission: async i => { missions.push(i); return { id: 'm1' }; }, settle });
  assert.equal(r.status, 202);
  assert.equal(r.body.transaction, '0xtx');
  assert.deepEqual(missions[0].allowedTasks, ['repo-scan']);
  assert.equal(state[r.body.order].status, 'PAID');
  assert.equal((await purchaseX402({ paymentHeader: h, repo: 'https://github.com/acme/demo', env, state, createMission: async () => ({}), settle })).status, 409);
  const unpaid = await purchaseX402({ paymentHeader: header({}), repo: 'https://github.com/acme/demo', env, state, createMission: async () => assert.fail('no mission'), settle: async () => ({ ok: false, error: 'X402_INVALID:x' }) });
  assert.equal(unpaid.status, 402);
  const h2 = header({ ...x.paymentRequirements(env), extra: { name: 'USD Coin', version: '2', n: 2 } });
  const stuck = await purchaseX402({ paymentHeader: h2, repo: 'https://github.com/acme/demo', env, state, createMission: async () => { throw new Error('RUNTIME_503'); }, settle });
  assert.equal(stuck.status, 500);
  assert.equal(state[x.orderIdFor(h2)].status, 'PAID_NEEDS_OPERATOR', 'paid money is never silently lost');
  assert.equal((await purchaseX402({ paymentHeader: h, repo: 'nope', env, state: {}, createMission: async () => ({}), settle })).status, 400);
});
