// Pine Labs P3P adapter — stub (live for UPI ReservePay, expanding)
// Protocol: agent-to-agent HTTP with verifiable receipts
// https://developer.pinelabs.com/p3p

export const id = 'p3p';

export function supports(contract) {
  return (contract.payment_adapters || []).includes('p3p');
}

export async function quote({ amount_usd, currency = 'INR', description, payee_vpa }) {
  // P3P quotes in local currency; INR primary for UPI ReservePay
  const inr_rate = 84; // approximate — real impl fetches FX rate
  return {
    adapter: id,
    status: 'stub',
    amount_usd,
    amount_local: Math.round(amount_usd * inr_rate),
    currency,
    payee_vpa,
    description,
    note: 'P3P live for UPI — configure P3P_API_KEY and P3P_MERCHANT_ID to activate',
  };
}

export async function execute({ amount_usd, payee_vpa, description, metadata = {} }) {
  const apiKey = process.env.P3P_API_KEY;
  const merchantId = process.env.P3P_MERCHANT_ID;
  if (!apiKey || !merchantId) {
    throw new Error('p3p: set P3P_API_KEY and P3P_MERCHANT_ID in .env to activate');
  }

  // P3P flow:
  //   1. POST /v1/reserve  → reserve_id + verifiable receipt claim
  //   2. POST /v1/pay      → trigger UPI ReservePay
  //   3. GET  /v1/receipt/:id → final receipt with verifiable hash
  const res = await fetch('https://api.pinelabs.com/p3p/v1/reserve', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'x-merchant-id': merchantId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: Math.round(amount_usd * 84 * 100), // paise
      currency: 'INR',
      payee_vpa,
      description,
      metadata: { source: 'jaco-commerce', ...metadata },
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`p3p: ${data.message || res.status}`);

  return {
    adapter: id,
    status: data.status,
    reserve_id: data.reserve_id,
    receipt_hash: data.receipt_hash,
    amount_usd,
    settled_at: data.status === 'settled' ? Date.now() : null,
  };
}

export const SPEC = {
  protocol: 'pine-labs-p3p',
  version: '1.0',
  flows: ['reserve', 'pay', 'receipt'],
  live_for: ['upi-reservepay'],
  status: 'live-limited',
};
