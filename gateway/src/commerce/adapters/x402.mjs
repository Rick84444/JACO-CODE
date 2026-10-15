// x402 adapter — HTTP-native micropayments via USDC on Base (ERC-3009)
// Standard interface: execute(order) → receipt

export const id = 'x402';

export function supports(contract) {
  return (contract.payment_adapters || []).includes('x402');
}

export async function quote({ amount_usd, description }) {
  // x402 charges in USDC — 1:1 with USD for quoting purposes
  return {
    adapter: id,
    amount_usd,
    amount_token: amount_usd,
    token: 'USDC',
    chain: 'eip155:8453',  // Base
    description,
    expires_at: Date.now() + 300_000,
  };
}

export async function execute({ endpoint, amount_usd, wallet_address, private_key_env }) {
  // x402 flow: GET endpoint → 402 with payment-required header → pay → retry
  const key = process.env[private_key_env || 'X402_PRIVATE_KEY'];
  if (!key) throw new Error('x402: missing signing key');

  // Step 1: probe for payment-required
  const probe = await fetch(endpoint, { method: 'GET' });
  if (probe.status !== 402) {
    // Already paid or free — return as-is
    return { adapter: id, status: 'skipped', reason: `HTTP ${probe.status}` };
  }

  const paymentRequired = probe.headers.get('x-payment-required') ||
    probe.headers.get('www-authenticate') || '';

  // Step 2: sign and attach payment (simplified — real impl uses EIP-712)
  const paymentHeader = JSON.stringify({
    scheme: 'exact',
    network: 'base',
    maxAmountRequired: String(Math.round(amount_usd * 1e6)), // USDC 6 decimals
    resource: endpoint,
    description: `JACO x402 payment`,
    mimeType: 'application/json',
    payToAddress: paymentRequired.match(/address=([0-9a-fx]+)/i)?.[1] || '',
    maxTimeoutSeconds: 300,
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
    extra: { name: 'JACO', version: '0.21' },
  });

  const paid = await fetch(endpoint, {
    method: 'GET',
    headers: { 'x-payment': Buffer.from(paymentHeader).toString('base64') },
  });

  return {
    adapter: id,
    status: paid.ok ? 'settled' : 'failed',
    http_status: paid.status,
    amount_usd,
    token: 'USDC',
    chain: 'eip155:8453',
    endpoint,
    receipt_header: paid.headers.get('x-payment-response'),
    settled_at: Date.now(),
  };
}
