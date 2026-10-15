// Outgoing-spend guard for durable Nova / Desktop AgentOS actions.
//
// Operator Level-5 profile: everything is autonomous except an outgoing payment or new financial
// commitment. The planning layer marks such steps (step.payment), but durable missions execute
// browser clicks, typing, desktop input, shell and worker calls directly, so this guard inspects
// every acting task before it starts. Receiving money (checkout links, payment links, prices,
// balance/revenue reads) is not outgoing spend and is allowed.

// Tasks that can commit the operator to a payment. Pure reads are never inspected.
export const ACTING_TASKS = new Set([
  'browser-click', 'browser-type', 'desktop-action', 'desktop-invoke', 'mouse-click',
  'key-press', 'type-text', 'shell', 'invoke-worker',
]);

// Words that mean "we pay" when they are the thing being clicked, typed or sent.
const SPEND_ACTION = /\b(buy( now)?|purchase|pay( now)?|place (the )?order|complete (the )?(order|purchase|payment)|confirm (the )?(order|purchase|payment)|subscribe|start (my |a )?(paid )?(plan|subscription)|upgrade( (to|plan|now))?|add (a )?(card|payment method)|donate|tip|top[- ]?up|add funds|checkout|proceed to (checkout|payment))\b|\b(köp|betala|beställ|prenumerera|uppgradera|slutför köp|lägg till kort)/i;

// Card data typed anywhere is treated as a payment attempt.
const CARD_NUMBER = /\b(?:\d[ -]?){13,19}\b/;

// Pages where a click/type is very likely to complete a payment.
const PAYMENT_PAGE = /(checkout\.stripe\.com|buy\.stripe\.com|billing\.stripe\.com|paypal\.com\/(checkoutnow|webapps\/hermes|pay)|pay\.google\.com|\/checkout(\/|\b|$)|\/billing(\/|\b|$)|\/payment(s)?(\/|\b|$)|\/subscribe(\/|\b|$)|\/upgrade(\/|\b|$)|\/cart(\/|\b|$))/i;

// Money-out API calls in shell / worker payloads. Incoming endpoints (checkout sessions, payment
// links, prices, products, balance reads) deliberately do not match.
const OUTGOING_API = /(\/v1\/(payouts|transfers|topups|charges|payment_intents\/[^\s/]+\/confirm|issuing\/)|stripe\s+(payouts|transfers|topups|charges)\s+create|\bsendTransaction\b|\beth_sendTransaction\b|\bwallet\s+send\b|x402[^\n]{0,40}\bpay\b|skyfire[^\n]{0,40}\b(pay|transfer)\b)/i;

function textOf(task) {
  const d = task?.data || {};
  return [d.name, d.text, d.keys, d.command, d.prompt, d.worker, d.label, d.url,
    typeof d.selector === 'string' ? d.selector : JSON.stringify(d.selector || ''),
    typeof d.expect === 'object' ? JSON.stringify(d.expect) : d.expect, task?.expectedOutcome]
    .filter(Boolean).map(String).join(' \n ');
}

function pageOf(observation) {
  if (!observation || typeof observation !== 'object') return '';
  const candidates = [observation.url, observation.page?.url, observation.tab?.url, observation.browser?.url, observation.activeTab?.url];
  return candidates.filter(Boolean).map(String).join(' ');
}

// Returns null when allowed, or { reason } when the action needs the operator.
export function outgoingSpendCheck(task, { observation = null } = {}) {
  if (!task || !ACTING_TASKS.has(task.type)) return null;
  const text = textOf(task);
  if (CARD_NUMBER.test(String(task?.data?.text || task?.data?.keys || ''))) return { reason: 'card number typed' };
  if (task.type === 'shell' || task.type === 'invoke-worker') {
    return OUTGOING_API.test(text) ? { reason: 'money-out API call' } : null;
  }
  // Clicking/invoking "Buy", "Pay", "Subscribe" commits; typing those words (e.g. "git checkout") does not.
  const clickLike = ['browser-click', 'desktop-invoke', 'desktop-action', 'mouse-click'].includes(task.type);
  if (clickLike && SPEND_ACTION.test(text)) return { reason: `spend action "${text.match(SPEND_ACTION)[0]}"` };
  const page = pageOf(observation) + ' ' + String(task?.data?.expect?.url || '');
  if (PAYMENT_PAGE.test(page) && ['browser-click', 'browser-type', 'type-text', 'key-press', 'mouse-click', 'desktop-action', 'desktop-invoke'].includes(task.type)) {
    return { reason: `input on payment page ${page.match(PAYMENT_PAGE)[0]}` };
  }
  return null;
}
