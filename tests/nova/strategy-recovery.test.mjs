import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITY_ROUTES, capabilityFamily, failedRoutes, succeededRoutes, recoveryStrategy } from '../../agents/lib/strategy-recovery.mjs';
import { TASK_PERMISSIONS } from '../../agents/lib/org-permission.mjs';
import { TASK_FIELDS } from '../../agents/lib/task-fields.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

// Everything this mission's own function catalog exposes. Routes are only offered from this list.
const evidence = (...callable) => ({ callable });
const everything = evidence('web-fetch', 'browser-survey-site', 'mcp-call', 'stack-repair', 'repo-list', 'repo-read', 'repo-test', 'health-check');
const failed = (type, error, extra = {}) => ({ type, ok: false, error, ...extra });

test('a failing tool is answered with the next route the mission can actually call, never with a block', () => {
  // 1. Fetch failure -> the real browser.
  const afterFetch = recoveryStrategy({ reason: 'web-fetch failed: FETCH_FAILED for https://example.com', evidence: everything, receipts: [failed('web-fetch', 'FETCH_FAILED')] });
  assert.equal(afterFetch.family, 'web-read');
  assert.equal(afterFetch.route.id, 'browser-survey');
  assert.match(afterFetch.message, /STRATEGY_RECOVERY/);
  assert.match(afterFetch.message, /browser-survey-site/);

  // 1b. Browser survey failed too -> TARGET TRACK (browser/CDP), then the accessibility tree, then pixels.
  const chain = ['dom-track-observe', 'dom-track-ax', 'dom-track-html', 'laser-vision'];
  const receipts = [failed('web-fetch', 'FETCH_FAILED'), failed('browser-survey-site', 'SURVEY_EMPTY')];
  const attempted = [];
  for (const expected of chain) {
    const step = recoveryStrategy({ reason: 'the page could not be read', evidence: everything, receipts, attempted });
    assert.equal(step.route.id, expected, `after ${attempted.join(',')}`);
    attempted.push(step.route.id);
  }
  // 3. DOM insufficient -> LASER VISION was reached, and it is the last route for the family.
  const last = recoveryStrategy({ reason: 'the page could not be read', evidence: everything, receipts, attempted: attempted.slice(0, -1) });
  assert.equal(last.route.id, 'laser-vision');
  assert.deepEqual(last.remaining, []);
  assert.match(last.message, /last route/);

  // Exhausted: only now may the mission stop.
  assert.equal(recoveryStrategy({ reason: 'the page could not be read', evidence: everything, receipts, attempted }), null);
});

test('a disconnected browser and an unavailable MCP server are repaired before anything is given up', () => {
  // 2. CDP disconnected -> reconnect, then look again.
  const cdp = recoveryStrategy({ reason: 'CDP_CONNECTION_FAILED: the browser is disconnected', evidence: everything, receipts: [] });
  assert.equal(cdp.family, 'browser');
  assert.equal(cdp.route.id, 'stack-repair');
  assert.equal(cdp.route.repair, true);
  assert.match(cdp.message, /restarts authorized local services/);
  const afterRepair = recoveryStrategy({ reason: 'CDP_CONNECTION_FAILED: the browser is disconnected', evidence: everything, receipts: [], attempted: ['stack-repair'] });
  assert.equal(afterRepair.route.id, 'browser-targets');

  // 4. MCP unavailable -> start the authorized service, then re-read the live catalog.
  const mcp = recoveryStrategy({ reason: 'the tool server is unavailable and failed to start', evidence: everything, receipts: [] });
  assert.equal(mcp.family, 'mcp');
  assert.equal(mcp.route.id, 'stack-repair');
  assert.equal(recoveryStrategy({ reason: 'mcp server unavailable', evidence: everything, receipts: [], attempted: ['stack-repair'] }).route.id, 'mcp-discover');
});

test('the terminal failure that ended missions on 2026-11-19 now routes around the shell', () => {
  const reason = "I am blocked because all shell commands are failing with a 'spawnSync C:\\WINDOWS\\system32\\cmd.exe ETIMEDOUT' error. This prevents me from running the required tests.";
  assert.equal(capabilityFamily(reason), 'terminal');
  const first = recoveryStrategy({ reason, evidence: everything, receipts: [failed('shell', 'spawnSync C:\\WINDOWS\\system32\\cmd.exe ETIMEDOUT')] });
  assert.equal(first.route.id, 'stack-repair');
  const rest = ['repo-list', 'repo-read', 'repo-test'];
  const attempted = ['stack-repair'];
  for (const expected of rest) {
    const step = recoveryStrategy({ reason, evidence: everything, receipts: [], attempted });
    assert.equal(step.route.id, expected);
    attempted.push(step.route.id);
  }
  assert.equal(recoveryStrategy({ reason, evidence: everything, receipts: [], attempted }), null, 'only an exhausted family may stop the mission');
});

test('a route is only offered when this mission can really call it, and a burned route is not repeated', () => {
  // Registration is not availability: a task the native catalog does not expose is never offered.
  const narrow = recoveryStrategy({ reason: 'web-fetch failed: FETCH_FAILED', evidence: evidence('web-fetch'), receipts: [failed('web-fetch', 'FETCH_FAILED')] });
  assert.equal(narrow, null, 'no callable alternative means no invented one');
  assert.equal(recoveryStrategy({ reason: 'fetch failed', evidence: { callable: [] }, receipts: [] }), null);

  // 5. Repeated failure: a route that already failed in this mission is excluded from the next strategy.
  const burned = failedRoutes([failed('web-fetch', 'FETCH_FAILED'), failed('browser-survey-site', 'TIMEOUT'), failed('mcp-call', 'CDP down', { data: { tool: 'nova_observe' } })]);
  assert.ok(burned.has('web-fetch') && burned.has('browser-survey') && burned.has('dom-track-observe'));
  assert.equal(burned.has('dom-track-ax'), false, 'only the tool that actually failed is burned');
  assert.equal(recoveryStrategy({ reason: 'the page could not be read', evidence: everything, receipts: [failed('web-fetch', 'FETCH_FAILED'), failed('browser-survey-site', 'TIMEOUT'), failed('mcp-call', 'CDP down', { data: { tool: 'nova_observe' } })] }).route.id, 'dom-track-ax');
});

test('the operator keeps every boundary: approvals and unobserved results are never routed around', () => {
  // 7. External access denied is an operator decision, not a tool to replace.
  for (const reason of [
    'fetch refused: OPERATOR_APPROVAL_REQUIRED to publish',
    'the browser needs a sign-in and the password is not mine to type',
    'CODING_SCOPE_DENIED for this path',
    'MANDATE_DENIED:aura:commands.run',
    'the payment needs your approval before the page can be fetched',
  ]) assert.equal(recoveryStrategy({ reason, evidence: everything, receipts: [] }), null, reason);

  // 6. An unknown result is reconciled with the operator, never retried silently.
  assert.equal(recoveryStrategy({ reason: 'the shell command returned OUTCOME_UNKNOWN', evidence: everything, receipts: [] }), null);
  // A receipt that failed on an operator boundary does not burn that route for later legitimate use.
  assert.equal(failedRoutes([failed('web-fetch', 'OPERATOR_APPROVAL_REQUIRED'), failed('repo-read', 'OUTCOME_UNKNOWN', { outcomeUnknown: true })]).size, 0);
});

test('the loop tries recovery before it may block, bounded, keeping the mission context', () => {
  const loop = read('agents/lib/agent-loop.mjs');
  assert.match(loop, /import \{ recoveryStrategy \} from '\.\/strategy-recovery\.mjs'/);
  // Both places a mission can stop consult recovery first, and continue the SAME conversation on success.
  assert.equal((loop.match(/tryRecovery\(reason\)/g) || []).length, 2);
  assert.match(loop, /const recovered = tryRecovery\(reason\);\s*\n\s*if \(recovered\) continue;/);
  assert.match(loop, /if \(tryRecovery\(reason\)\) continue;/);
  // The switch appends to the existing messages, so goal, evidence and partial results survive it.
  assert.match(loop, /messages\.push\(\{ role: 'user', content: strategy\.message \}\)/);
  assert.match(loop, /strategyRecoveries >= MAX_STRATEGY_RECOVERIES/);
  assert.match(loop, /const MAX_STRATEGY_RECOVERIES = \d+/);
  // Recovery runs before the passive wait, so a live alternative beats waiting for a dead tool.
  assert.ok(loop.indexOf('tryRecovery(reason)') < loop.indexOf('mayDeferHealthBlock(reason)) return deferHealth'));
});

test('stack-repair is a real mission task with a mandate, not a route into nothing', () => {
  assert.deepEqual(TASK_FIELDS['stack-repair'], []);
  assert.equal(TASK_PERMISSIONS['stack-repair'], 'commands.run');
  assert.match(read('agents/hands-off-agent.mjs'), /case "stack-repair": return runtimeApi\("POST", "\/api\/system\/stack-repair"\)/);
  assert.match(read('runtime/server.ts'), /app\.post\('\/api\/system\/stack-repair', requireAuth/);
  // Every route names a task the runtime actually knows.
  for (const [family, routes] of Object.entries(CAPABILITY_ROUTES)) {
    for (const route of routes) assert.ok(TASK_FIELDS[route.task], `${family}/${route.id} -> unknown task ${route.task}`);
  }
});

test('recovery answers a broken tool, not a planner question or an unfounded capability claim', () => {
  // The planner stopping to ask something is not a routing problem, even when the words name a capability.
  assert.equal(recoveryStrategy({ reason: 'Which page should I stop at?', evidence: everything, receipts: [] }), null);
  // Claiming a tool is missing when nothing failed and nothing was denied stays the operator's to answer:
  // the existing capability correction handles that, and recovery must not paper over it.
  assert.equal(recoveryStrategy({ reason: 'I am blocked because I do not have a tool to fetch URLs.', evidence: everything, receipts: [{ type: 'web-fetch', ok: true, verified: true }] }), null);
  // The same sentence once a tool really did fail is a routing problem again.
  assert.equal(recoveryStrategy({ reason: 'I cannot read the page, the fetch failed', evidence: everything, receipts: [] }).route.id, 'web-fetch');
});

test('a route that just worked is never offered as the alternative to itself', () => {
  const receipts = [{ type: 'web-fetch', ok: true, verified: true }, failed('browser-survey-site', 'TIMEOUT')];
  assert.ok(succeededRoutes(receipts).has('web-fetch'));
  const strategy = recoveryStrategy({ reason: 'the page fetch failed and the survey returned nothing', evidence: everything, receipts });
  assert.equal(strategy.route.id, 'dom-track-observe');
  assert.equal(strategy.tried.includes('web-fetch'), true);
});
