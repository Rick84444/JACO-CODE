// Operator 2026-10-02: agents buy the repo scan with Skyfire; charged only after delivery.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { verifyPayToken, chargeToken, resetJwksCache } = await import('../../agents/lib/skyfire-seller.mjs');
const { purchase, orderStatus, chargeDelivered } = await import('../../agents/lib/agent-orders.mjs');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'ES256', use: 'sig' };
const jwksFetch = async () => new Response(JSON.stringify({ keys: [jwk] }));
const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Date.parse('2026-10-02T20:00:00Z');
const sign = (claims, header = {}) => {
  const h = enc({ alg: 'ES256', typ: 'kya-pay+jwt', kid: 'k1', ...header });
  const p = enc({ iss: 'https://app.skyfire.xyz', env: 'production', iat: now / 1000 - 10, exp: now / 1000 + 600, jti: 'tok-1234-abcd', ssi: 'svc-1', aud: 'seller-1', sub: 'buyer-9', amount: '9', cur: 'USD', ...claims });
  const sig = crypto.sign('sha256', Buffer.from(`${h}.${p}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${h}.${p}.${sig}`;
};
const env = { SKYFIRE_SELLER_SERVICE_ID: 'svc-1', SKYFIRE_SELLER_ACCOUNT_ID: 'seller-1', SKYFIRE_API_KEY: 'sf-test', SKYFIRE_REPO_SCAN_PRICE_USD: '9' };

test('a valid pay token for this service is accepted; every claim the seller must check is enforced', async () => {
  resetJwksCache();
  const ok = await verifyPayToken(sign({}), { env, fetchImpl: jwksFetch, now });
  assert.deepEqual([ok.amountUsd, ok.orderId], [9, 'sky_tok-1234-abcd']);
  const reject = async (token, re, e = env) => { resetJwksCache(); await assert.rejects(verifyPayToken(token, { env: e, fetchImpl: jwksFetch, now }), re); };
  await reject(sign({ ssi: 'svc-other' }), /WRONG_SERVICE/);
  await reject(sign({ aud: 'seller-other' }), /WRONG_SELLER/);
  await reject(sign({ exp: now / 1000 - 1 }), /EXPIRED/);
  await reject(sign({ amount: '1' }), /AMOUNT/);
  await reject(sign({ iss: 'https://evil.example' }), /ISSUER/);
  await reject(sign({}, { typ: 'kya+jwt' }), /TOKEN_TYPE/);
  await reject(sign({ env: 'sandbox' }), /TOKEN_ENV/);
  await reject(sign({}), /SELLER_NOT_CONFIGURED/, { ...env, SKYFIRE_SELLER_SERVICE_ID: '' });
  const t = sign({}); const tampered = t.slice(0, t.lastIndexOf('.')) .replace(/.$/, c => (c === 'A' ? 'B' : 'A')) + t.slice(t.lastIndexOf('.'));
  await reject(tampered, /SIGNATURE|MALFORMED/);
});

test('purchase: 402 without a token, 202 with one, 409 on reuse; charged once after delivery', async () => {
  resetJwksCache();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyfire-orders-'));
  const e = { ...env, JACO_REPO_SCAN_DIR: dir, JACO_GATEWAY_PUBLIC_URL: 'https://api.example.test' };
  const state = {};
  const missions = [];
  const createMission = async input => { missions.push(input); return { id: 'mission-1' }; };
  const unpaid = await purchase({ token: '', repo: 'https://github.com/acme/demo', env: e, state, createMission });
  assert.equal(unpaid.status, 402);
  assert.equal(unpaid.body.price.amount, 9);
  const bad = await purchase({ token: sign({}), repo: 'not a repo', env: e, state, createMission, fetchImpl: jwksFetch, now });
  assert.equal(bad.status, 400);
  const ok = await purchase({ token: sign({}), repo: 'https://github.com/acme/demo', env: e, state, createMission, fetchImpl: jwksFetch, now });
  assert.equal(ok.status, 202);
  assert.equal(ok.body.order, 'sky_tok-1234-abcd');
  assert.deepEqual(missions[0].allowedTasks, ['repo-scan']);
  assert.match(missions[0].goal, /sky_tok-1234-abcd.*github\.com\/acme\/demo/);
  const again = await purchase({ token: sign({}), repo: 'https://github.com/acme/demo', env: e, state, createMission, fetchImpl: jwksFetch, now });
  assert.equal(again.status, 409, 'one token buys one scan');
  assert.equal(orderStatus('sky_tok-1234-abcd', { env: e, state }).body.status, 'running');

  const charges = [];
  const charge = async (token, amount) => { charges.push([token.length > 20, amount]); return { ok: true, amountCharged: String(amount) }; };
  assert.deepEqual(await chargeDelivered({ env: e, state, charge }), [], 'nothing is charged before delivery');
  fs.writeFileSync(path.join(dir, 'sky_tok-1234-abcd.html'), '<p>report</p>');
  fs.writeFileSync(path.join(dir, 'sky_tok-1234-abcd.json'), JSON.stringify({ repo: 'https://github.com/acme/demo', secrets: [] }));
  assert.deepEqual(await chargeDelivered({ env: e, state, charge }), [{ order: 'sky_tok-1234-abcd', status: 'CHARGED' }]);
  assert.deepEqual(charges, [[true, 9]]);
  assert.equal(state['sky_tok-1234-abcd'].token, undefined, 'the token is dropped once used');
  assert.deepEqual(await chargeDelivered({ env: e, state, charge }), [], 'never charged twice');
  assert.equal(orderStatus('sky_tok-1234-abcd', { env: e, state }).body.status, 'delivered');
});

test('the charge call uses the seller key and reports Skyfire errors', async () => {
  let seen;
  const ok = await chargeToken('tok', 9, { env, fetchImpl: async (url, init) => { seen = [url, init.headers['skyfire-api-key'], JSON.parse(init.body)]; return new Response(JSON.stringify({ amountCharged: '9', remainingBalance: '0' })); } });
  assert.deepEqual(seen, ['https://api.skyfire.xyz/api/v1/tokens/charge', 'sf-test', { token: 'tok', chargeAmount: '9' }]);
  assert.equal(ok.ok, true);
  const no = await chargeToken('tok', 9, { env, fetchImpl: async () => new Response(JSON.stringify({ code: 'NOT_AUTHORIZED', message: 'invalid or expired jwt' }), { status: 401 }) });
  assert.deepEqual([no.ok, no.status, no.error], [false, 401, 'invalid or expired jwt']);
  assert.equal((await chargeToken('tok', 9, { env: {} })).error, 'SKYFIRE_API_KEY_MISSING');
});

test('the repo scan has public terms, linked from the offer and the OpenAPI spec', async () => {
  const { termsHtml, offer, openApi } = await import('../../agents/lib/agent-orders.mjs');
  const env = { JACO_GATEWAY_PUBLIC_URL: 'https://api.example.test' };
  const html = termsHtml(env);
  assert.match(html, /<title>Terms of Service · JACO Repo Security Scan<\/title>/);
  assert.match(html, /charged only after the report has been delivered/);
  assert.equal(offer(env).terms, 'https://api.example.test/terms');
  assert.equal(openApi(env).info.termsOfService, 'https://api.example.test/terms');
});

test('an approved but inactive Skyfire service is activated; an unapproved one is left waiting', async () => {
  const { ensureServiceActive } = await import('../../agents/lib/skyfire-seller.mjs');
  const env = { SKYFIRE_API_KEY: 'k', SKYFIRE_SELLER_SERVICE_ID: 's1' };
  const calls = [];
  const make = service => async (url, init = {}) => { calls.push(`${init.method || 'GET'} ${url.replace('https://api.skyfire.xyz', '')}`); return url.endsWith('/activate') ? new Response(null, { status: 204 }) : new Response(JSON.stringify({ data: [service] })); };
  assert.deepEqual(await ensureServiceActive({ env, fetchImpl: make({ id: 's1', active: false, approved: false }) }), { state: 'AWAITING_APPROVAL' });
  assert.deepEqual(await ensureServiceActive({ env, fetchImpl: make({ id: 's1', active: false, approved: true }) }), { state: 'ACTIVATED' });
  assert.ok(calls.includes('POST /api/v1/agents/seller-services/s1/activate'));
  assert.deepEqual(await ensureServiceActive({ env, fetchImpl: make({ id: 's1', active: true, approved: true }) }), { state: 'ACTIVE', approved: true });
  assert.deepEqual(await ensureServiceActive({ env: {} }), { state: 'NOT_CONFIGURED' });
});
