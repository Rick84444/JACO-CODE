// Mastercard Agent Connect adapter — stub (not live until MC opens API)
// Spec: discovery → quote → delegated-auth → payment → receipt
// https://developer.mastercard.com/agent-connect (expected Q4 2026)

export const id = 'agent-connect';

export function supports(contract) {
  return (contract.payment_adapters || []).includes('agent-connect');
}

export async function quote({ amount_usd, description, agent_id }) {
  // TODO: call MC Agent Connect /v1/quotes endpoint when available
  return {
    adapter: id,
    status: 'stub',
    amount_usd,
    description,
    agent_id,
    note: 'Mastercard Agent Connect not yet live — activate when MC opens API',
  };
}

export async function execute({ amount_usd, recipient_agent_id, mandate_ref, metadata = {} }) {
  // MC Agent Connect flow (planned):
  //   1. POST /v1/agent-auth   → delegated auth token
  //   2. POST /v1/payment      → payment_id
  //   3. GET  /v1/receipts/:id → verifiable receipt
  throw new Error(
    'agent-connect: not yet live. Mastercard Agent Connect API expected Q4 2026. ' +
    'Use x402 or stripe adapter in the interim.'
  );
}

export const SPEC = {
  protocol: 'mastercard-agent-connect',
  version: '1.0-preview',
  flows: ['discovery', 'quote', 'delegated-auth', 'payment', 'receipt'],
  launched: '2026-09-09',
  status: 'beta-closed',
};
