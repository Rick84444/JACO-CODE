// Covers the paid path: Stripe webhook -> key in the Durable Object -> a skill worker spends a call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import license, { verifyStripeEvent, LicenseStore, productFor } from '../../scratchpad/workers/patched/jaco-license.js';
import skill from '../../scratchpad/workers/patched/a2a-smart-contract-auditor.js';

const SECRET = 'whsec_test_secret';
const INTERNAL = 'internal_test_secret';
const PRODUCT_MAP = JSON.stringify({ plink_sca: { product: 'a2a-smart-contract-auditor', calls: 2 } });

/** Minimal stand-in for the Durable Object runtime: one instance, transactional storage. */
function licenseEnv(extra = {}) {
  const map = new Map();
  const state = {
    storage: {
      async get(k) { return map.has(k) ? map.get(k) : undefined; },
      async put(k, v) { map.set(k, v); },
    },
  };
  const instance = new LicenseStore(state);
  return {
    storage: map,
    LICENSE_DO: { idFromName: () => 'global', get: () => ({ fetch: (url, init) => instance.fetch(new Request(url, init)) }) },
    STRIPE_WEBHOOK_SECRET: SECRET,
    LICENSE_INTERNAL_SECRET: INTERNAL,
    PRODUCT_MAP,
    ...extra,
  };
}

/** The skill worker talks to the license worker through a service binding. */
function skillEnv(licEnv, output = 'audit result') {
  return {
    AI: { run: async () => ({ response: output }) },
    LICENSE_INTERNAL_SECRET: INTERNAL,
    LICENSE_SVC: { fetch: (url, init) => license.fetch(new Request(url, init), licEnv) },
  };
}

async function stripeSignature(body, secret, timestamp) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${hex}`;
}

function sessionEvent(id = 'cs_test_1', overrides = {}) {
  return JSON.stringify({
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: { object: { id, payment_status: 'paid', amount_total: 20000, currency: 'usd', payment_link: 'plink_sca', customer_details: { email: 'buyer@example.com' }, ...overrides } },
  });
}

const webhook = (env, body, sig) => license.fetch(new Request('https://x/stripe/webhook', { method: 'POST', body, headers: { 'Stripe-Signature': sig } }), env);
const nowSig = (body) => stripeSignature(body, SECRET, Math.floor(Date.now() / 1000));

test('webhook rejects a wrong signature and stores nothing', async () => {
  const env = licenseEnv();
  const body = sessionEvent();
  const res = await webhook(env, body, await stripeSignature(body, 'whsec_other', Math.floor(Date.now() / 1000)));
  assert.equal(res.status, 400);
  assert.equal(env.storage.size, 0);
});

test('webhook rejects a replayed old timestamp', async () => {
  const body = sessionEvent();
  const sig = await stripeSignature(body, SECRET, Math.floor(Date.now() / 1000) - 3600);
  await assert.rejects(() => verifyStripeEvent(body, sig, SECRET), /tolerance/);
});

test('a paid session issues one key, and a replayed webhook reuses it', async () => {
  const env = licenseEnv();
  const body = sessionEvent();
  const sig = await nowSig(body);

  assert.equal((await (await webhook(env, body, sig)).json()).issued, true);
  assert.equal((await (await webhook(env, body, sig)).json()).issued, false, 'a replay must not mint a second key');

  const key = env.storage.get('sess:cs_test_1');
  const record = env.storage.get(`key:${key}`);
  assert.equal(record.product, 'a2a-smart-contract-auditor');
  assert.equal(record.calls, 2);
  assert.equal(record.email, 'buyer@example.com');
});

test('an unpaid session issues nothing', async () => {
  const env = licenseEnv();
  const body = sessionEvent('cs_unpaid', { payment_status: 'unpaid' });
  const res = await webhook(env, body, await nowSig(body));
  assert.equal(res.status, 200);
  assert.equal(env.storage.size, 0);
});

test('an unmapped payment link still delivers a usable key', () => {
  const mapped = productFor({ payment_link: 'plink_unknown' }, JSON.parse(PRODUCT_MAP));
  assert.equal(mapped.product, 'all');
  assert.ok(mapped.calls > 0);
});

test('the success page shows the key, and reports pending before it exists', async () => {
  const env = licenseEnv();
  assert.equal((await license.fetch(new Request('https://x/key?session_id=cs_test_1'), env)).status, 202);

  const body = sessionEvent();
  await webhook(env, body, await nowSig(body));
  const key = env.storage.get('sess:cs_test_1');
  const page = await (await license.fetch(new Request('https://x/success?session_id=cs_test_1'), env)).text();
  assert.ok(page.includes(key), 'the buyer must be able to read the key');
});

test('/validate refuses callers without the internal secret', async () => {
  const env = licenseEnv();
  const res = await license.fetch(new Request('https://x/validate', { method: 'POST', body: '{"key":"k"}', headers: { 'X-JACO-Internal': 'wrong' } }), env);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).reason, 'INTERNAL_AUTH_FAILED');
});

test('the skill worker refuses without a key, works with one, and stops at the quota', async () => {
  const lic = licenseEnv();
  const body = sessionEvent('cs_run');
  await webhook(lic, body, await nowSig(body));
  const key = lic.storage.get('sess:cs_run');
  const env = skillEnv(lic);
  const run = (headers) => skill.fetch(new Request('https://x/run', { method: 'POST', body: '{"input":"audit this"}', headers }), env);

  assert.equal((await (await run({})).json()).reason, 'NO_KEY');
  assert.equal((await (await run({ 'X-JACO-Key': 'jaco_live_deadbeef' })).json()).reason, 'UNKNOWN_KEY');

  const first = await (await run({ 'X-JACO-Key': key })).json();
  assert.equal(first.work_result.output, 'audit result');
  assert.equal(first.calls_remaining, 1);
  assert.equal((await (await run({ 'X-JACO-Key': key })).json()).calls_remaining, 0);

  const exhausted = await run({ 'X-JACO-Key': key });
  assert.equal(exhausted.status, 402);
  assert.equal((await exhausted.json()).reason, 'CALLS_EXHAUSTED');
});

test('a key bought for another skill is refused', async () => {
  const lic = licenseEnv({ PRODUCT_MAP: JSON.stringify({ plink_sca: { product: 'a2a-copywriter', calls: 5 } }) });
  const body = sessionEvent('cs_other');
  await webhook(lic, body, await nowSig(body));
  const key = lic.storage.get('sess:cs_other');
  const res = await skill.fetch(new Request('https://x/run', { method: 'POST', body: '{"input":"hi"}', headers: { 'X-JACO-Key': key } }), skillEnv(lic));
  assert.equal(res.status, 402);
  assert.equal((await res.json()).reason, 'WRONG_PRODUCT');
});

test('raw chain-of-thought never reaches the buyer, even when the closing tag is missing', async () => {
  const lic = licenseEnv();
  const body = sessionEvent('cs_think');
  await webhook(lic, body, await nowSig(body));
  const key = lic.storage.get('sess:cs_think');

  const closed = skillEnv(lic, '<think>internal reasoning</think>The contract is vulnerable to reentrancy and must zero the balance first.');
  const ok = await (await skill.fetch(new Request('https://x/run', { method: 'POST', body: '{"input":"x"}', headers: { 'X-JACO-Key': key } }), closed)).json();
  assert.ok(!ok.work_result.output.includes('think'), 'the reasoning block must be stripped');
  assert.match(ok.work_result.output, /reentrancy/);

  // Truncated reasoning has no closing tag, so nothing usable is left: the call must fail loudly
  // rather than deliver the reasoning or an invented answer.
  const truncated = skillEnv(lic, '<think>reasoning that got cut off by max_tokens');
  const res = await skill.fetch(new Request('https://x/run', { method: 'POST', body: '{"input":"x"}', headers: { 'X-JACO-Key': key } }), truncated);
  const failed = await res.json();
  assert.equal(res.status, 502);
  assert.equal(failed.work_result, undefined);
  assert.match(failed.detail, /NO_MODEL_OUTPUT/);
  assert.ok(!JSON.stringify(failed).includes('<think>'), 'never hand a buyer the raw reasoning');
});
