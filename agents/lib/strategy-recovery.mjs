// JACO Aura strategic recovery — FAILED_TOOL != FAILED_MISSION.
//
// A mission used to end the moment the planner declared itself blocked because one tool failed. Observed
// 2026-11-19: "all shell commands are failing with spawnSync cmd.exe ETIMEDOUT" ended the mission while
// repo-read, mcp-call and the browser route were all still callable and healthy.
//
// This module answers one question: given the reason the planner wants to stop, which ALTERNATIVE capability
// is still callable in this very mission and has not already failed? It returns the next route to try, or null
// when the alternatives really are exhausted and the operator is needed.
//
// It is evidence, never permission. A route is only offered when the task is in the mission's own native
// function catalog (mission grants and past successes do not prove callability), and the runtime still checks
// scope, policy, approvals and receipts when the model actually calls it.

export const STRATEGY_RECOVERY_SCHEMA = 'jaco.aura-strategy-recovery/v1';

// Reasons that are the operator's to decide, never something another tool can route around.
const OPERATOR_BOUNDARY = /(?:OPERATOR|APPROVAL|POLICY|PERMISSION|MANDATE|CREDENTIAL|SECRET|AUTH|SIGN[- ]?IN|LOGIN|PAYMENT|SPEND|BUDGET|COST|CAPTCHA|SCOPE_DENIED|TASK_TURNED_OFF)/i;
// A result nobody observed must be reconciled, not retried behind the operator's back.
const UNKNOWN_OUTCOME = /(?:OUTCOME_UNKNOWN|OUTCOME UNKNOWN|UNKNOWN_RESULT|PARTIALLY_APPLIED)/i;
// Something actually went wrong with a tool. A planner that stops to ask a question, or claims it lacks a
// capability it was never denied, is not recovering from a failure: that stop belongs to the operator.
const TOOL_FAILURE = /(?:fail(?:ed|ing|ure)|error|timed? ?out|etimedout|econnrefused|econnreset|unavailable|unreachable|not reachable|disconnected|not running|could not (?:start|connect|reach|read|open)|refused|crash|offline|\bdown\b|no response|503|502)/i;

/**
 * Capability families, each an ordered list of routes from the most direct to the most expensive.
 * `task` is a Nova task type; `via` names the MCP tool when the route goes through a server.
 * `repair` marks a route that restarts or reconnects an authorized local service rather than doing the work.
 */
export const CAPABILITY_ROUTES = Object.freeze({
  // Reading a page: plain fetch, then the real browser, then its accessibility tree and HTML, then pixels.
  'web-read': Object.freeze([
    Object.freeze({ id: 'web-fetch', task: 'web-fetch', label: 'plain HTTP read' }),
    Object.freeze({ id: 'browser-survey', task: 'browser-survey-site', label: 'the real browser through CDP' }),
    Object.freeze({ id: 'dom-track-observe', task: 'mcp-call', via: { server: 'cdp', tool: 'nova_observe' }, label: 'TARGET TRACK (browser/CDP): the observed page' }),
    Object.freeze({ id: 'dom-track-ax', task: 'mcp-call', via: { server: 'cdp', tool: 'nova_ax' }, label: 'TARGET TRACK (browser/CDP): the accessibility tree' }),
    Object.freeze({ id: 'dom-track-html', task: 'mcp-call', via: { server: 'cdp', tool: 'nova_html' }, label: 'TARGET TRACK (browser/CDP): the cleaned HTML' }),
    Object.freeze({ id: 'laser-vision', task: 'mcp-call', via: { server: 'cdp', tool: 'nova_screenshot' }, label: 'LASER VISION: a screenshot of the page' }),
  ]),
  // The browser itself is down: reconnect the authorized local bridge, then look again.
  browser: Object.freeze([
    Object.freeze({ id: 'stack-repair', task: 'stack-repair', repair: true, label: 'restart the local services that are down' }),
    Object.freeze({ id: 'browser-targets', task: 'mcp-call', via: { server: 'cdp', tool: 'nova_targets' }, label: 'the open tabs, to confirm the browser answers' }),
    Object.freeze({ id: 'dom-track-observe', task: 'mcp-call', via: { server: 'cdp', tool: 'nova_observe' }, label: 'TARGET TRACK (browser/CDP): the observed page' }),
  ]),
  // An MCP server is unavailable: start the authorized service, re-read the catalog, then call it again.
  mcp: Object.freeze([
    Object.freeze({ id: 'stack-repair', task: 'stack-repair', repair: true, label: 'start the authorized local services that are down' }),
    Object.freeze({ id: 'mcp-discover', task: 'mcp-call', via: { server: 'jaco', tool: 'jaco_mcp_catalog' }, label: 'the live MCP catalog, to see which servers answer now' }),
  ]),
  // The terminal is unusable: inspect the repository directly instead of shelling out for it.
  terminal: Object.freeze([
    Object.freeze({ id: 'stack-repair', task: 'stack-repair', repair: true, label: 'restart the local services that are down' }),
    Object.freeze({ id: 'repo-list', task: 'repo-list', label: 'list the project files without a shell' }),
    Object.freeze({ id: 'repo-read', task: 'repo-read', label: 'read a file without a shell' }),
    Object.freeze({ id: 'repo-test', task: 'repo-test', label: 'run the project test script through the runtime' }),
  ]),
});

// Which family a stop reason belongs to. The most specific signal wins: a CDP or browser failure is a browser
// problem even when the sentence also says "fetch".
const FAMILY_SIGNALS = Object.freeze([
  ['terminal', /\b(?:spawnsync|cmd\.exe|shell|terminal|powershell|bash|etimedout\b[^.]*command|command (?:failed|timed out)|npm (?:test|run|ci))\b/i],
  ['browser', /\b(?:cdp|chrome|browser|webbläsare|devtools|9222|nova_|tab)\b/i],
  ['mcp', /\b(?:mcp|tool server|verktygsserver|server (?:unavailable|not running|failed to start)|mcp_[a-z_]+)\b/i],
  ['web-read', /\b(?:fetch|http|https|url|web|page|sida|hämta|download|request)\b/i],
]);

/** @param {string} reason @returns {string|null} */
export function capabilityFamily(reason) {
  const text = String(reason || '');
  for (const [family, pattern] of FAMILY_SIGNALS) if (pattern.test(text)) return family;
  return null;
}

// A route is only real when this mission's own function catalog exposes the task. A mission grant, a related
// task or a past success never stands in for the native catalog: offering a route the planner cannot call
// would be a false capability claim.
const routeCallable = (route, evidence) =>
  new Set(Array.isArray(evidence?.callable) ? evidence.callable : []).has(route.task);

const routeMatchesReceipt = (route, receipt) => {
  if (route.task !== String(receipt?.type || '')) return false;
  if (!route.via) return true;
  return String(receipt?.data?.tool || receipt?.result?.tool || '').endsWith(route.via.tool);
};

// Routes that already did their job. A tool that just worked is not an alternative to itself.
export function succeededRoutes(receipts = []) {
  const done = new Set();
  for (const receipt of Array.isArray(receipts) ? receipts : []) {
    if (receipt?.ok !== true) continue;
    for (const routes of Object.values(CAPABILITY_ROUTES)) {
      for (const route of routes) if (routeMatchesReceipt(route, receipt)) done.add(route.id);
    }
  }
  return done;
}

// Routes already proven broken in this mission. A receipt that failed for an operator or unknown-outcome
// reason is not a broken route: those are not ours to retry.
export function failedRoutes(receipts = []) {
  const failed = new Set();
  for (const receipt of Array.isArray(receipts) ? receipts : []) {
    if (receipt?.ok !== false || receipt?.outcomeUnknown === true) continue;
    const error = String(receipt?.error || '');
    if (OPERATOR_BOUNDARY.test(error) || UNKNOWN_OUTCOME.test(error)) continue;
    for (const routes of Object.values(CAPABILITY_ROUTES)) {
      for (const route of routes) if (routeMatchesReceipt(route, receipt)) failed.add(route.id);
    }
  }
  return failed;
}

/**
 * The next alternative worth trying, or null when the operator is genuinely needed.
 * @param {{reason?: string, evidence?: any, receipts?: any[], attempted?: Iterable<string>}} input
 */
export function recoveryStrategy({ reason = '', evidence = null, receipts = [], attempted = [] } = {}) {
  const statement = String(reason).slice(0, 1000);
  // The operator's own boundaries and unobserved results are never routed around.
  if (OPERATOR_BOUNDARY.test(statement) || UNKNOWN_OUTCOME.test(statement)) return null;
  const family = capabilityFamily(statement);
  if (!family) return null;
  const routes = CAPABILITY_ROUTES[family];
  const broken = failedRoutes(receipts);
  // Recovery answers a tool that failed. A planner that stops to ask a question, or asserts it has no tool
  // when nothing was denied or broken, is not a routing problem: that stop is the operator's to answer.
  const brokenHere = routes.some(route => broken.has(route.id));
  if (!brokenHere && !TOOL_FAILURE.test(statement)) return null;
  const alreadyTried = new Set([...broken, ...succeededRoutes(receipts), ...attempted]);
  const next = routes.find(route => !alreadyTried.has(route.id) && routeCallable(route, evidence));
  if (!next) return null;
  const remaining = routes.filter(route => route.id !== next.id && !alreadyTried.has(route.id) && routeCallable(route, evidence));
  return {
    schema: STRATEGY_RECOVERY_SCHEMA,
    family,
    route: next,
    tried: [...alreadyTried],
    remaining: remaining.map(route => route.id),
    message: recoveryMessage(family, next, remaining),
  };
}

function recoveryMessage(family, route, remaining) {
  const call = route.via
    ? `mcp-call with server "${route.via.server}" and tool "${route.via.tool}"`
    : `the ${route.task} function`;
  const after = remaining.length
    ? ` If that one fails too, the remaining routes for this are: ${remaining.map(r => r.id).join(', ')}.`
    : ' This is the last route for this capability; if it fails as well, stop and say exactly which routes failed and why.';
  return [
    `STRATEGY_RECOVERY: a failing tool is not a failed mission. The ${family} capability has another route that this`,
    `mission can actually call: ${route.label}. Use ${call} now.`,
    route.repair
      ? 'That route restarts authorized local services that are down; afterwards check the service again before concluding anything.'
      : 'Keep the goal, the evidence and everything you have already established; only the route changes.',
    after,
    'Do not claim any result until the runtime returns a verified receipt.',
  ].join(' ');
}
