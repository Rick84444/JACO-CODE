// Operator 2026-10-04: JACO's answer checking as a paid API (free quota, then x402).
import test from 'node:test';
import assert from 'node:assert/strict';
const { validateVerifyRequest, verifyAnswer, freeQuota, verifyOffer, verifyBazaar } = await import('../../agents/lib/verify-api.mjs');
const { paymentRequired } = await import('../../agents/lib/x402-seller.mjs');

test('requests are validated before anything is charged', () => {
  assert.throws(() => validateVerifyRequest({}), /ANSWER_REQUIRED/);
  assert.throws(() => validateVerifyRequest({ answer: 'x' }), /EVIDENCE_REQUIRED/);
  assert.throws(() => validateVerifyRequest({ answer: 'x', evidence: [{ text: ' ' }] }), /EVIDENCE_TEXT_REQUIRED:1/);
  assert.throws(() => validateVerifyRequest({ answer: 'x', evidence: Array(11).fill('e') }), /TOO_MUCH_EVIDENCE/);
  assert.deepEqual(validateVerifyRequest({ answer: ' a ', evidence: ['plain text', { text: 't', source: 'https://s' }] }).evidence.map(e => [e.n, e.source]), [[1, null], [2, 'https://s']]);
});

test('a fact missing from the evidence and a contradicted claim fail the answer', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"verdicts":[{"id":"C1","verdict":"contradicted","why":"the evidence lists a third file"}]}' } }] }));
  const r = await verifyAnswer({ answer: 'Python 3.14.9 is the latest [#1].\nChanged files: a.ts and b.ts [#2].', evidence: ['Python 3.14.8 - Sept. 30, 2026', '--- a/a.ts\n--- a/b.ts\n--- a/c.ts'] }, { env: { GROQ_API_KEY: 'k' }, fetchImpl });
  assert.equal(r.ok, false);
  assert.deepEqual(r.unsupportedFacts.map(u => u.fact), ['3.14.9']);
  assert.match(r.contradicted[0].why, /third file/);
  assert.equal(r.judge, 'independent model', 'the judge model is not disclosed');
});

test('free quota per client and day; the 402 carries the endpoint price and its own Bazaar metadata', () => {
  const q = freeQuota(2);
  const t = Date.parse('2026-10-04T10:00:00Z');
  assert.deepEqual([q.take('a', t), q.take('a', t), q.take('a', t), q.take('b', t), q.take('a', t + 86400000)], [true, true, false, true, true]);
  const env = { X402_PAY_TO: '0x' + '1'.repeat(40), CDP_API_KEY_ID: 'i', CDP_API_KEY_SECRET: 's', JACO_GATEWAY_PUBLIC_URL: 'https://api.example.test' };
  const pr = paymentRequired('https://api.example.test/v1/verify', env, { priceUsd: 0.02, description: verifyOffer(env).description, bazaar: verifyBazaar(env) });
  assert.equal(pr.accepts[0].amount, '20000');
  assert.equal(pr.extensions.bazaar.routeTemplate, '/v1/verify');
  assert.equal(paymentRequired('https://api.example.test/v1/repo-scan', { ...env, SKYFIRE_REPO_SCAN_PRICE_USD: '0.5' }).accepts[0].amount, '500000', 'the repo scan keeps its own price');
});
