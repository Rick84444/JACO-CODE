// Operator 2026-10-02: revenue in the IDE, real Stripe figures only.
import test from 'node:test';
import assert from 'node:assert/strict';
const { stripeRevenueSnapshot, stripeKeyMode, sumPaid } = await import('../../runtime/src/server/revenue/stripeRevenue.mjs');

const page = (data, has_more = false) => new Response(JSON.stringify({ data, has_more }));
const fakeStripe = ({ charges = [], sessions = [], fail = null } = {}) => async url => {
  if (fail && url.includes(fail)) return new Response(JSON.stringify({ error: { message: 'Invalid API Key provided' } }), { status: 401 });
  if (url.includes('/account')) return new Response(JSON.stringify({ country: 'SE', charges_enabled: true, payouts_enabled: true }));
  if (url.includes('/balance')) return new Response(JSON.stringify({ available: [{ amount: 15000, currency: 'sek' }], pending: [{ amount: 0, currency: 'sek' }] }));
  if (url.includes('/checkout/sessions')) return page(sessions);
  if (url.includes('/charges')) return page(charges);
  throw new Error('unexpected ' + url);
};

test('key mode is read from the prefix, never from a guess', () => {
  assert.equal(stripeKeyMode(''), 'missing');
  assert.equal(stripeKeyMode('rk_live_x'), 'live (restricted key)');
  assert.equal(stripeKeyMode('sk_live_x'), 'live');
  assert.equal(stripeKeyMode('sk_test_x'), 'test');
});

test('paid revenue counts succeeded charges net of refunds, per currency', () => {
  assert.deepEqual(sumPaid([
    { paid: true, status: 'succeeded', amount: 19000, amount_refunded: 0, currency: 'sek' },
    { paid: true, status: 'succeeded', amount: 10000, amount_refunded: 2500, currency: 'sek' },
    { paid: true, status: 'succeeded', amount: 5000, refunded: true, amount_refunded: 5000, currency: 'sek' },
    { paid: false, status: 'failed', amount: 9900, currency: 'sek' },
    { paid: true, status: 'succeeded', amount: 1000, currency: 'usd' },
  ]), { SEK: 265, USD: 10 });
});

test('the snapshot reports real figures, and an API failure as an error instead of zero', async () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const ok = await stripeRevenueSnapshot({ key: 'rk_live_x', now, fetchImpl: fakeStripe({
    charges: [{ id: 'ch_1', paid: true, status: 'succeeded', amount: 19000, currency: 'sek', created: now / 1000 - 3600, description: 'Repo scan' }],
    sessions: [{ payment_status: 'paid' }, { payment_status: 'unpaid' }],
  }) });
  assert.deepEqual(ok.last30Days, { paidCharges: 1, revenue: { SEK: 190 }, checkoutSessionsCreated: 2, checkoutSessionsPaid: 1, complete: true });
  assert.deepEqual(ok.balance.available, { SEK: 150 });
  assert.equal(ok.recentCharges[0].amount, 190);
  assert.equal(JSON.stringify(ok).includes('rk_live_x'), false, 'the key never appears in the snapshot');
  const failed = await stripeRevenueSnapshot({ key: 'rk_live_x', now, fetchImpl: fakeStripe({ fail: '/balance' }) });
  assert.match(failed.error, /STRIPE_401/);
  assert.equal(failed.last30Days, undefined, 'no figures are invented when Stripe cannot be read');
  assert.deepEqual(await stripeRevenueSnapshot({ key: '' }).then(s => [s.configured, s.mode]), [false, 'missing']);
});
