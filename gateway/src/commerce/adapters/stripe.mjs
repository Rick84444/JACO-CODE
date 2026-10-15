// Stripe adapter — card/bank payments via Stripe API
// Requires STRIPE_SECRET_KEY in env

export const id = 'stripe';

export function supports(contract) {
  return (contract.payment_adapters || []).includes('stripe');
}

export async function quote({ amount_usd, description, currency = 'usd' }) {
  return {
    adapter: id,
    amount_usd,
    amount_cents: Math.round(amount_usd * 100),
    currency,
    description,
    expires_at: Date.now() + 3_600_000,
  };
}

export async function execute({ amount_usd, currency = 'usd', description, metadata = {} }) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('stripe: missing STRIPE_SECRET_KEY');

  const body = new URLSearchParams({
    amount: String(Math.round(amount_usd * 100)),
    currency,
    description,
    'metadata[source]': 'jaco-commerce',
    'metadata[adapter]': id,
    ...Object.fromEntries(Object.entries(metadata).map(([k, v]) => [`metadata[${k}]`, String(v)])),
    confirm: 'false',
  });

  const res = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`stripe: ${data.error?.message || res.status}`);

  return {
    adapter: id,
    status: data.status,
    payment_intent_id: data.id,
    client_secret: data.client_secret,
    amount_usd,
    currency: data.currency,
    settled_at: data.status === 'succeeded' ? Date.now() : null,
  };
}

export async function fetchRevenue({ limit = 10 } = {}) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { error: 'missing STRIPE_SECRET_KEY' };

  const res = await fetch(
    `https://api.stripe.com/v1/payment_intents?limit=${limit}`,
    { headers: { Authorization: `Bearer ${key}` } }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`stripe: ${data.error?.message || res.status}`);

  const intents = data.data || [];
  const succeeded = intents.filter(i => i.status === 'succeeded');
  const total_usd = succeeded.reduce((s, i) => s + i.amount / 100, 0);

  return {
    adapter: id,
    total_usd,
    count: succeeded.length,
    recent: succeeded.slice(0, 5).map(i => ({
      id: i.id,
      amount_usd: i.amount / 100,
      currency: i.currency,
      description: i.description,
      created: new Date(i.created * 1000).toISOString(),
    })),
  };
}
