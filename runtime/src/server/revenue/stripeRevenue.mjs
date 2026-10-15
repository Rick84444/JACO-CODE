// Read-only Stripe revenue snapshot for the IDE (operator 2026-10-02: focus on income, shown with real
// numbers only). Every figure comes from the Stripe API at fetch time; nothing is estimated, and an API
// failure is reported as an error, never as zero revenue.

const DAY = 24 * 60 * 60;

export function stripeKeyMode(key) {
  if (!key) return 'missing';
  if (/^(sk|rk)_live_/.test(key)) return key.startsWith('rk_') ? 'live (restricted key)' : 'live';
  if (/^(sk|rk)_test_/.test(key)) return 'test';
  return 'unknown';
}

// Sums paid amounts per currency, in major units (Stripe amounts are minor units).
export function sumPaid(charges) {
  const totals = {};
  for (const c of charges) {
    if (!c?.paid || c.status !== 'succeeded' || c.refunded) continue;
    const cur = String(c.currency || '').toUpperCase();
    totals[cur] = Math.round(((totals[cur] || 0) + (c.amount - (c.amount_refunded || 0)) / 100) * 100) / 100;
  }
  return totals;
}

export async function stripeRevenueSnapshot({ key = '', fetchImpl = fetch, now = Date.now(), maxPages = 5 } = {}) {
  const mode = stripeKeyMode(key);
  if (!key) return { configured: false, mode, fetchedAt: new Date(now).toISOString() };
  const get = async path => {
    const res = await fetchImpl(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`STRIPE_${res.status}: ${String(body?.error?.message || '').slice(0, 160)}`);
    return body;
  };
  const list = async (path, pages = maxPages) => {
    const out = [];
    let after = '';
    for (let i = 0; i < pages; i++) {
      const page = await get(`${path}${path.includes('?') ? '&' : '?'}limit=100${after ? `&starting_after=${after}` : ''}`);
      out.push(...(page.data || []));
      if (!page.has_more || !page.data?.length) return { items: out, complete: true };
      after = page.data.at(-1).id;
    }
    return { items: out, complete: false };
  };
  const since30 = Math.floor(now / 1000) - 30 * DAY;
  try {
    const [account, balance, charges30, sessions30, latest] = await Promise.all([
      get('account'),
      get('balance'),
      list(`charges?created[gte]=${since30}`),
      list(`checkout/sessions?created[gte]=${since30}`),
      get('charges?limit=10'),
    ]);
    const amounts = rows => Object.fromEntries((rows || []).map(r => [String(r.currency).toUpperCase(), r.amount / 100]));
    const paid30 = charges30.items.filter(c => c.paid && c.status === 'succeeded');
    return {
      configured: true,
      mode,
      fetchedAt: new Date(now).toISOString(),
      account: { country: account.country || null, chargesEnabled: account.charges_enabled === true, payoutsEnabled: account.payouts_enabled === true },
      balance: { available: amounts(balance.available), pending: amounts(balance.pending) },
      last30Days: {
        paidCharges: paid30.length,
        revenue: sumPaid(charges30.items),
        checkoutSessionsCreated: sessions30.items.length,
        checkoutSessionsPaid: sessions30.items.filter(s => s.payment_status === 'paid').length,
        complete: charges30.complete && sessions30.complete,
      },
      recentCharges: (latest.data || []).map(c => ({
        id: c.id, amount: c.amount / 100, currency: String(c.currency).toUpperCase(), status: c.status,
        paid: c.paid === true, refunded: c.refunded === true, description: c.description ? String(c.description).slice(0, 120) : null,
        created: new Date(c.created * 1000).toISOString(),
      })),
    };
  } catch (error) {
    return { configured: true, mode, fetchedAt: new Date(now).toISOString(), error: String(error?.message || error) };
  }
}
