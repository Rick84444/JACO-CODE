// contract.mjs — parse and validate SEER mission contract for commerce

const DEFAULTS = {
  payment_adapters: ['stripe'],
  spend_limit: 50,
  mandate: 'required',
  receipt: 'required',
  outgoing_payment: false,  // global security constraint: false unless operator confirms
};

export function parseContract(mission = {}) {
  const raw = mission.contract || {};

  return {
    payment_adapters: raw.payment_adapters ?? DEFAULTS.payment_adapters,
    spend_limit:       raw.spend_limit      ?? DEFAULTS.spend_limit,
    mandate:           raw.mandate          ?? DEFAULTS.mandate,
    receipt:           raw.receipt          ?? DEFAULTS.receipt,
    outgoing_payment:  raw.outgoing_payment ?? DEFAULTS.outgoing_payment,
    currency:          raw.currency         ?? 'usd',
    metadata:          raw.metadata         ?? {},
  };
}

export function validateOrder(contract, order) {
  const errors = [];

  if (order.amount_usd > contract.spend_limit) {
    errors.push(`amount $${order.amount_usd} exceeds spend_limit $${contract.spend_limit}`);
  }

  if (contract.mandate === 'required' && !order.mandate_ref) {
    errors.push('mandate_ref required but not provided');
  }

  if (!contract.outgoing_payment && order.type === 'outgoing') {
    errors.push(
      'outgoing payments require explicit operator approval ' +
      '(set contract.outgoing_payment=true in mission to enable)'
    );
  }

  return { valid: errors.length === 0, errors };
}
