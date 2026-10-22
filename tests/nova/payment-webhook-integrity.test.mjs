// Regression: revenue is booked only from a signature-verified event. An unsigned or unverifiable body must be
// refused, the local offline ledger must never produce revenue, and the marketplace view must not invent measurements.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { handlePaymentWebhook, verifyLedgerSignature, WebhookNotConfiguredError } from '../../runtime/src/server/connected/paymentWebhook.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => readFileSync(resolve(root, file), 'utf8');
const SECRET = 'ledger-test-secret-0123456789';
const sign = (body, secret = SECRET) => crypto.createHmac('sha256', secret).update(body).digest('hex');
const body = JSON.stringify({ amount: 99999, currency: 'SEK', customerEmail: 'attacker@example.com', transactionId: 'forged' });

// Mirrors the offline ledger: authenticated for development, never verified.
const ledger = env => ({
  providerName: 'offline_ledger',
  async verifyWebhook(raw, signature) {
    verifyLedgerSignature(raw, signature, env);
    return { eventId: 'e', type: 'payment.succeeded', amount: 99999, currency: 'SEK', transactionId: 't', rawPayloadHash: 'h', timestamp: 'x', verified: false };
  },
});
const run = (provider, rawBody, signature) => {
  const booked = [];
  return handlePaymentWebhook({ provider, rawBody, signature, bookRevenue: async e => { booked.push(e); } }).then(outcome => ({ ...outcome, booked }));
};

test('an unsigned body is refused and books nothing', async () => {
  const r = await run(ledger({ JACO_LEDGER_WEBHOOK_SECRET: SECRET }), Buffer.from(body), '');
  assert.equal(r.status, 400);
  assert.equal(r.booked.length, 0);
});

test('any header value is refused when no webhook secret is configured', async () => {
  const r = await run(ledger({}), Buffer.from(body), 'anything-at-all');
  assert.equal(r.status, 503);
  assert.equal(r.booked.length, 0);
  assert.throws(() => verifyLedgerSignature(body, sign(body), {}), WebhookNotConfiguredError);
  assert.throws(() => verifyLedgerSignature(body, sign(body), { JACO_LEDGER_WEBHOOK_SECRET: 'short' }), WebhookNotConfiguredError);
});

test('a wrong signature is refused even when a secret is configured', async () => {
  const env = { JACO_LEDGER_WEBHOOK_SECRET: SECRET };
  for (const bad of ['not-hex', 'a'.repeat(64), sign(body, 'another-secret-0123456789')]) {
    const r = await run(ledger(env), Buffer.from(body), bad);
    assert.equal(r.status, 400, bad);
    assert.equal(r.booked.length, 0);
  }
});

test('a correctly signed offline-ledger event is accepted for development but is never revenue', async () => {
  const env = { JACO_LEDGER_WEBHOOK_SECRET: SECRET };
  const r = await run(ledger(env), Buffer.from(body), sign(body));
  assert.equal(r.status, 200);
  assert.equal(r.body.verified, false);
  assert.equal(r.body.booked, false);
  assert.equal(r.booked.length, 0);
});

test('only an event marked verified by its provider is booked, once; a missing flag fails closed', async () => {
  const provider = verified => ({ providerName: 'stripe', async verifyWebhook() { return { eventId: 'e', type: 'payment.succeeded', amount: 5, currency: 'SEK', transactionId: 't', rawPayloadHash: 'h', timestamp: 'x', ...(verified === undefined ? {} : { verified }) }; } });
  const ok = await run(provider(true), Buffer.from('{}'), 'sig');
  assert.equal(ok.body.booked, true);
  assert.equal(ok.booked.length, 1);
  for (const flag of [false, undefined, 'true', 1]) {
    const r = await run(provider(flag), Buffer.from('{}'), 'sig');
    assert.equal(r.booked.length, 0, String(flag));
  }
  const notConfigured = { providerName: 'stripe', async verifyWebhook() { throw new WebhookNotConfiguredError('no secret'); } };
  assert.equal((await run(notConfigured, Buffer.from('{}'), 'sig')).status, 503);
});

test('over HTTP, an unauthorized POST body to the webhook is refused', async () => {
  const booked = [];
  const provider = ledger({});
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const outcome = await handlePaymentWebhook({ provider, rawBody: Buffer.concat(chunks), signature: String(req.headers['x-webhook-signature'] || ''), bookRevenue: async e => { booked.push(e); } });
      res.writeHead(outcome.status, { 'content-type': 'application/json' }).end(JSON.stringify(outcome.body));
    });
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/payment/webhook`;
    for (const headers of [{}, { 'x-webhook-signature': 'forged' }]) {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
      assert.ok(res.status === 400 || res.status === 503, `got ${res.status}`);
    }
    assert.equal(booked.length, 0);
  } finally { server.close(); }
});

test('the production route and ledger adapter cannot be reverted to trust the caller', () => {
  const adapter = read('runtime/src/adapters/paymentAdapter.ts');
  const ledgerClass = adapter.slice(adapter.indexOf('class OfflineLedgerPaymentAdapter'));
  assert.match(ledgerClass, /verifyLedgerSignature\(/);
  assert.match(ledgerClass, /verified:\s*false/);
  assert.doesNotMatch(ledgerClass, /verified:\s*true/);
  assert.doesNotMatch(adapter, /peer@a2a\.local/);
  const stripeClass = adapter.slice(0, adapter.indexOf('class OfflineLedgerPaymentAdapter'));
  assert.equal((stripeClass.match(/verified:\s*true/g) || []).length, 2);
  assert.match(stripeClass, /constructEvent\(/);

  const server = read('runtime/server.ts');
  const start = server.indexOf('app.post(["/api/stripe/webhook"');
  const route = server.slice(start, server.indexOf('app.get("/api/vault"', start));
  assert.ok(start > 0, 'webhook route not found');
  assert.match(route, /handlePaymentWebhook\(/);
  assert.doesNotMatch(route, /\.verifyWebhook\(/);
  assert.doesNotMatch(route, /if \(!req\.rawBody \|\| !sig\)/);
  // Revenue is booked only inside bookRevenue, which the handler calls for verified events.
  assert.equal((route.match(/INTÄKT BOKFÖRD/g) || []).length, 1);
  assert.match(read('runtime/src/server/connected/paymentWebhook.mjs'), /event\?\.verified === true/);
});

test('the marketplace view shows no invented latency and no [REAL] on unobserved actions', () => {
  const view = read('src/components/VerifiedMarketplacesView.tsx');
  assert.doesNotMatch(view, /Math\.random/);
  assert.doesNotMatch(view, /lastPingMs/);
  assert.doesNotMatch(view, /\|\|\s*15\}?ms/);
  assert.doesNotMatch(view, /triggerToast\([^;]*\[REAL\]/);
});
