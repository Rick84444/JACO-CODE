// router.mjs — protocol-agnostic commerce router
// Selects adapter based on contract.payment_adapters priority list

import { parseContract, validateOrder } from './contract.mjs';
import * as x402        from './adapters/x402.mjs';
import * as stripe      from './adapters/stripe.mjs';
import * as agentConnect from './adapters/agent-connect.mjs';
import * as p3p         from './adapters/p3p.mjs';

const ADAPTERS = [x402, stripe, agentConnect, p3p];

function selectAdapter(contract) {
  for (const name of contract.payment_adapters) {
    const adapter = ADAPTERS.find(a => a.id === name);
    if (adapter && adapter.supports(contract)) return adapter;
  }
  return null;
}

export async function getQuote(mission, order) {
  const contract = parseContract(mission);
  const adapter = selectAdapter(contract);
  if (!adapter) throw new Error(`commerce: no supported adapter in [${contract.payment_adapters}]`);
  return adapter.quote({ ...order, ...contract });
}

export async function pay(mission, order) {
  const contract = parseContract(mission);

  const { valid, errors } = validateOrder(contract, order);
  if (!valid) {
    return {
      status: 'rejected',
      reasons: errors,
      adapter: null,
      amount_usd: order.amount_usd,
    };
  }

  const adapter = selectAdapter(contract);
  if (!adapter) throw new Error(`commerce: no supported adapter in [${contract.payment_adapters}]`);

  const receipt = await adapter.execute({ ...order, metadata: contract.metadata });

  return {
    status: receipt.status,
    adapter: adapter.id,
    amount_usd: order.amount_usd,
    receipt,
    mandate_ref: order.mandate_ref,
    settled_at: receipt.settled_at,
  };
}

export function listAdapters() {
  return ADAPTERS.map(a => ({
    id: a.id,
    spec: a.SPEC ?? null,
  }));
}
