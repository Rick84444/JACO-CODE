// Operator 2026-09-29: until JACO has income, use the cheapest equivalent option and don't waste
// money. Covers the three rules that came out of diagnosing a stuck mission: free capable planners
// before paid ones, small local models last, and a hard daily cap on paid calls (Nova calls models
// directly, outside the economic governor, so paid calls previously had no cap at all).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-cost-routing-'));
process.env.NOVA_STATE_DIR = dir;
// The live planner choice (from the IDE) must not steer these tests.
process.env.JACO_PLANNER_CHOICE_FILE = path.join(dir, 'planner-choice.json');
process.env.NOVA_BRAIN_MODE = 'direct';
const { orderedBrainProviders, paidCallAllowed, recordModelCall, paidCallsToday, paidCallLimit, assertPlanTaskAllowed, openFilesForBrain, compactMissionForBrain, brainSystemFor, callBrain, extractJsonObject, providerParkMs } =
  await import('../../agents/hands-off-agent.mjs');
import { providerCooldownUntil } from '../../agents/hands-off-agent.mjs';

test.beforeEach(() => {
  providerCooldownUntil.clear();
});

test('planner JSON with braces and raw newlines inside string values is parsed whole', () => {
  // Live 2026-09-30: about half of the Groq plans failed with "Expected ',' or '}'" because braces in
  // repo-write content were counted as object boundaries.
  const content = 'export function f() {\n  return { a: 1 };\n}';
  const raw = `Plan:\n{"task":{"type":"repo-write","data":{"path":"a.mjs","content":${JSON.stringify(content)}}}} trailing`;
  assert.equal(extractJsonObject(raw).task.data.content, content);
  const rawNewlines = '{"task":{"type":"repo-write","data":{"path":"a.mjs","content":"line1\nline2 { }"}}}';
  assert.equal(extractJsonObject(rawNewlines).task.data.content, 'line1\nline2 { }');
  const unbalanced = '{"task":{"type":"repo-write","data":{"path":"a.mjs","content":"}\\n  if (x) {"}}}';
  assert.equal(extractJsonObject(unbalanced).task.data.content, '}\n  if (x) {');
  assert.throws(() => extractJsonObject('no json here'), /NO_JSON_OBJECT_FOUND/);
});

test('providers that reject the key or cannot be reached are parked instead of retried every turn', () => {
  assert.equal(providerParkMs({ status: 401 }), 60 * 60_000);
  assert.equal(providerParkMs({ status: 403 }), 60 * 60_000);
  assert.equal(providerParkMs({ error: new Error('The operation was aborted due to timeout') }), 10 * 60_000);
  assert.equal(providerParkMs({ error: new Error('fetch failed') }), 10 * 60_000);
  assert.equal(providerParkMs({ status: 500 }), 0, 'a transient server error is not parked');
  assert.equal(providerParkMs({ error: new Error('INVALID_PLAN') }), 0, 'a bad answer is not a dead provider');
});

test('the planner prompt drops instructions for tasks the mission cannot use', () => {
  // Fixed to the Windows prompt (the host line differs per platform), which is what the size ratio below was set for.
  const coding = brainSystemFor(['repo-read', 'repo-write', 'repo-test', 'git-commit', 'web-fetch'], false, 'win32');
  const full = brainSystemFor(['android-tap', 'desktop-observe', 'browser-type', 'mouse-click', 'shell'], false, 'win32');
  for (const marker of ['Android sequence', 'desktop-observe {hwnd}', 'Never compose the literal text', 'mouse-move/mouse-click']) {
    assert.equal(coding.includes(marker), false, marker);
    assert.equal(full.includes(marker), true, marker);
  }
  assert.ok(coding.includes('repo-write {path,content}') && coding.includes('mission.allowedTasks'));
  assert.ok(coding.length < full.length * 0.7, `${coding.length} vs ${full.length}`);
});

test('a briefly rate-limited free tier is waited for instead of paying', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { NOVA_BRAIN_MODE: 'direct', JACO_ALLOW_PAID_MODELS: '1', GROQ_API_KEY: 'test', DEEPSEEK_API_KEY: 'test', JACO_PRIMARY_PROVIDER: 'groq', JACO_FREE_TIER_MAX_WAIT_S: '5' });
  const calls = [];
  const limited = new Set();
  const plan = JSON.stringify({ task: { type: 'repo-read', data: { path: 'a.mjs' }, expectedOutcome: 'read' } });
  const fetchImpl = async (url, init) => {
    if (url.includes('/api/nova/ollama-cost')) {
      return { status: 200, ok: true, json: async () => ({ success: true, reservationId: 'test-res' }) };
    }
    const model = JSON.parse(init.body).model;
    calls.push(`${new URL(url).hostname}/${model}`);
    if (url.includes('groq') && !limited.has(model)) {
      limited.add(model);
      return { status: 429, ok: false, headers: { get: name => (name === 'retry-after' ? '1' : null) }, text: async () => '{"error":{"message":"Rate limit reached"}}', json: async () => ({error:{message:"Rate limit reached"}}) };
    }
    if (url.includes('groq')) return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ choices: [{ message: { content: plan } }] }), json: async () => ({ choices: [{ message: { content: plan } }] }) };
    return { status: 500, ok: false, headers: { get: () => null }, text: async () => '{}', json: async () => ({}) };
  };
  try {
    const started = Date.now();
    const { brainCandidates } = await import('../../agents/hands-off-agent.mjs');
    console.log("TEST CANDIDATES:", brainCandidates().map(c => c.name));
    const proposal = await callBrain({ surfaces: {}, errors: [] }, { mission: { id: 'm', goal: 'g', allowedTasks: ['repo-read'], receipts: [] } }, fetchImpl);
    console.log("TEST PROPOSAL RETURNED:", JSON.stringify(proposal));
    assert.equal(proposal.task.type, 'repo-read');
    assert.equal(calls.some(call => call.includes('deepseek')), false, calls.join(' '));
    assert.ok(Date.now() - started >= 1000, 'it actually waited for the window');
  } finally { process.env = saved; }
});

test('the planner sees the full text of files it read, and a cut file is flagged', () => {
  // Live 2026-09-30: from a 1200-char clipped view a planner rewrote a test and wrote "Con...".
  const body = 'x'.repeat(5000) + '\nTAIL-MARKER\n';
  const read = (path, content) => ({ type: 'repo-read', ok: true, verified: true, result: { path, content, sha256: 's' } });
  const mission = { id: 'm', goal: 'g', allowedTasks: ['repo-read'], receipts: [read('a.mjs', body)] };
  const compact = compactMissionForBrain(mission);
  assert.equal(compact.openFiles[0].content, body);
  assert.equal(compact.openFiles[0].truncated, undefined);
  assert.equal(JSON.stringify(compact.recentReceipts).includes('TAIL-MARKER'), false, 'content is not duplicated in receipts');
  const huge = openFilesForBrain([read('big.mjs', 'y'.repeat(20000))]);
  assert.equal(huge[0].truncated, true);
  const written = openFilesForBrain([read('a.mjs', body), { type: 'repo-write', ok: true, result: { path: 'a.mjs' } }]);
  assert.equal(written.length, 0, 'a read older than a write to the same file is stale and not shown');
});

test('the planner sees a whole directory listing, and a cut listing says how much is missing', async () => {
  const { compactListing } = await import('../../agents/hands-off-agent.mjs');
  const entries = Array.from({ length: 32 }, (_, i) => ({ name: `case-${String(i).padStart(2, '0')}.test.mjs`, type: 'file' })).concat([{ name: 'lib', type: 'dir' }]);
  const receipt = { type: 'repo-list', ok: true, verified: true, result: { ok: true, verified: true, path: 'tests/nova', entries } };
  const compact = compactMissionForBrain({ id: 'm', goal: 'g', allowedTasks: ['repo-list'], receipts: [receipt] });
  const shown = compact.recentReceipts[0].result;
  assert.equal(shown.entries.length, 33, 'every entry is visible');
  assert.ok(shown.entries.includes('case-31.test.mjs') && shown.entries.includes('lib/'));
  assert.equal(shown.truncated, undefined);
  const big = compactListing({ path: 'x', entries: Array.from({ length: 350 }, (_, i) => ({ name: `f${i}`, type: 'file' })) });
  assert.equal(big.entries.length, 300);
  assert.equal(big.truncated, 50);
});

test('a planned task outside allowedTasks is rejected locally so the next model can answer', () => {
  const mission = { allowedTasks: ['repo-write', 'repo-test'] };
  assert.throws(() => assertPlanTaskAllowed({ task: { type: 'shell', data: {} } }, mission), /PLAN_TASK_NOT_ALLOWED:shell/);
  assert.doesNotThrow(() => assertPlanTaskAllowed({ task: { type: 'repo-test', data: { command: 'npm test' } } }, mission));
  assert.doesNotThrow(() => assertPlanTaskAllowed({ complete: true }, mission));
  assert.doesNotThrow(() => assertPlanTaskAllowed({ blocked: true, reason: 'x' }, mission));
});

test('a planned task missing a required field is rejected locally, not spent as a mission failure', () => {
  // Live 2026-10-01: three plans without data.path blocked a mission before any action ran.
  const mission = { allowedTasks: ['repo-list', 'repo-write', 'git-commit'] };
  assert.throws(() => assertPlanTaskAllowed({ task: { type: 'repo-list', data: {} } }, mission), /PLAN_TASK_FIELD_REQUIRED:repo-list\.path/);
  assert.throws(() => assertPlanTaskAllowed({ task: { type: 'repo-write', data: { path: 'a.mjs' } } }, mission), /PLAN_TASK_FIELD_REQUIRED:repo-write\.content/);
  assert.throws(() => assertPlanTaskAllowed({ task: { type: 'git-commit', data: { message: '' } } }, mission), /PLAN_TASK_FIELD_REQUIRED:git-commit\.message/);
  assert.doesNotThrow(() => assertPlanTaskAllowed({ task: { type: 'repo-list', data: { path: '.' } } }, mission));
});

test('a coding plan the runtime would refuse (out of scope) is rejected locally with the runtime reason', async () => {
  const { normalizeCodingContract } = await import('../../agents/lib/coding-contract.mjs');
  const contract = normalizeCodingContract({ schema: 'jaco.coding-contract/v1', objective: 'o', scope: { allowed: ['tests/nova/a.test.mjs'], forbidden: [] }, acceptance: ['a'], execution: { allow_git_commit: true }, verification: { commands: ['node --test tests/nova/a.test.mjs'] }, budget: {} });
  const mission = { allowedTasks: ['repo-read', 'repo-test'], contract, receipts: [] };
  assert.throws(() => assertPlanTaskAllowed({ task: { type: 'repo-read', data: { path: 'agents/x.mjs' } } }, mission), /PLAN_REJECTED:CODING_SCOPE_DENIED:agents\/x\.mjs/);
  assert.throws(() => assertPlanTaskAllowed({ task: { type: 'repo-test', data: { command: 'npm test' } } }, mission), /PLAN_REJECTED:CODING_TEST_COMMAND_NOT_CONTRACTED/);
  assert.doesNotThrow(() => assertPlanTaskAllowed({ task: { type: 'repo-read', data: { path: 'tests/nova/a.test.mjs' } } }, mission));
});

test('when every model answers with an invalid plan the turn fails (bounded), and later models see why', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { NOVA_BRAIN_MODE: 'direct', GROQ_API_KEY: 'test', JACO_ALLOW_PAID_MODELS: '0' });
  const userMessages = [];
  const invalid = JSON.stringify({ task: { type: 'repo-list', data: {}, expectedOutcome: 'list' } });
  const fetchImpl = async (_url, init) => {
    if (_url.includes('/api/nova/ollama-cost')) return { status: 200, ok: true, json: async () => ({ success: true, reservationId: 'r' }) };
    userMessages.push(JSON.stringify(JSON.parse(init.body).messages.at(-1).content));
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ choices: [{ message: { content: invalid } }] }), json: async () => ({ choices: [{ message: { content: invalid } }] }) };
  };
  try {
    await assert.rejects(
      callBrain({ surfaces: {}, errors: [] }, { mission: { id: 'm-invalid', goal: 'g', allowedTasks: ['repo-list'], receipts: [] } }, fetchImpl),
      /NO_VALID_PLAN:PLAN_TASK_FIELD_REQUIRED:repo-list\.path/,
    );
    assert.ok(userMessages.length >= 2, `${userMessages.length} providers asked`);
    assert.equal(userMessages[0].includes('Plans already rejected'), false);
    assert.ok(userMessages.at(-1).includes('Plans already rejected'), 'a later model is told what was rejected');
  } finally { process.env = saved; }
});

test('when no model is reachable the turn is deferred, not failed', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { NOVA_BRAIN_MODE: 'direct', GROQ_API_KEY: 'test', JACO_ALLOW_PAID_MODELS: '0' });
  const fetchImpl = async () => { throw new Error('fetch failed'); };
  try {
    const proposal = await callBrain({ surfaces: {}, errors: [] }, { mission: { id: 'm-down', goal: 'g', allowedTasks: ['repo-list'], receipts: [] } }, fetchImpl);
    assert.equal(proposal.deferred, true);
  } finally { process.env = saved; }
});

test('a disabled provider leaves the chain; OpenRouter gets a free fallback model like Groq', async () => {
  const { brainCandidates } = await import('../../agents/hands-off-agent.mjs');
  const names = orderedBrainProviders({ JACO_DISABLED_PROVIDERS: 'qwen, deepseek' }).map(p => p.name);
  assert.equal(names.includes('qwen'), false);
  assert.equal(names.includes('deepseek'), false);
  assert.ok(names.includes('groq') && names.includes('openrouter'));
  assert.ok(orderedBrainProviders({}).some(p => p.name === 'qwen'), 'nothing is disabled by default');
  const openrouter = brainCandidates({}).filter(p => p.name === 'openrouter').map(p => p.model);
  assert.equal(openrouter.length, 2, openrouter.join(','));
  assert.equal(openrouter.includes('openai/gpt-oss-120b:free'), false, 'withdrawn model is not the default');
  const deepseek = brainCandidates({}).filter(p => p.name === 'deepseek').map(p => p.model);
  assert.deepEqual(deepseek, ['deepseek-flash', 'deepseek-v4-pro'], 'cheap model first, working model when it stalls');
});

test('free capable planners come before paid ones, small local models come last', () => {
  const names = orderedBrainProviders({}).map(p => p.name);
  const at = name => names.indexOf(name);
  assert.ok(at('groq') < at('deepseek') && at('openrouter') < at('deepseek'), names.join(','));
  assert.ok(at('deepseek') < at('qwen'), 'cheap per-token before pricier');
  assert.ok(at('qwen') < at('ollama') && at('qwen') < at('ollama-local'), 'local 4B models are last resort');
});

test('historical paid-call counters do not override the shared GUI budget', () => {
  const file = path.join(dir, 'paid-cap-test.json');
  const env = { JACO_NOVA_PAID_CALLS_PER_DAY: '2' };
  const paid = { name: 'deepseek', model: 'deepseek-chat', envKey: 'DEEPSEEK_API_KEY' };
  const free = { name: 'groq', model: 'gpt-oss', envKey: 'GROQ_API_KEY', free: true };
  assert.equal(paidCallAllowed(paid, { env, file }), true);
  recordModelCall(paid, 'plan', { env, file });
  recordModelCall(paid, 'plan', { env, file });
  assert.equal(paidCallsToday(file), 2);
  assert.equal(paidCallAllowed(paid, { env, file }), true, 'legacy call count must not override the GUI budget');
  recordModelCall(free, 'plan', { env, file });
  assert.equal(paidCallsToday(file), 2, 'free calls do not count');
  assert.equal(paidCallAllowed(free, { env, file }), true, 'free calls are never blocked');
});

test('historical DeepSeek balance estimates do not impose a separate execution ceiling', async () => {
  const { nextSpendState, spentToday, paidUsdLimit } = await import('../../agents/hands-off-agent.mjs');
  let state = nextSpendState(null, 2.05, '2026-10-01');
  state = nextSpendState(state, 1.80, '2026-10-01');
  assert.equal(Number(spentToday(state, '2026-10-01').toFixed(2)), 0.25);
  state = nextSpendState(state, 10.00, '2026-10-01');
  assert.equal(spentToday(state, '2026-10-01'), 0, 'a top-up is not negative spend');
  assert.equal(spentToday(state, '2026-10-02'), 0, 'a new day starts at zero');
  assert.equal(paidUsdLimit({}), 0.5);
  const spendFile = path.join(dir, 'spend.json');
  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(spendFile, JSON.stringify({ day: today, startBalance: 2.0, lastBalance: 1.4, checkedAt: Date.now() }));
  const deepseek = { name: 'deepseek', model: 'deepseek-flash', envKey: 'DEEPSEEK_API_KEY' };
  const callFile = path.join(dir, 'calls-for-spend.json');
  assert.equal(paidCallAllowed(deepseek, { env: {}, file: callFile, spendFile }), true, 'legacy provider ceiling is no longer an execution gate');
  assert.equal(paidCallAllowed(deepseek, { env: { JACO_NOVA_PAID_USD_PER_DAY: '1' }, file: callFile, spendFile }), true);
});

test('the cap resets on a new day and has a sane default', () => {
  const file = path.join(dir, 'paid-cap-rollover.json');
  fs.writeFileSync(file, JSON.stringify({ day: '2000-01-01', count: 999 }));
  assert.equal(paidCallsToday(file), 0);
  assert.equal(paidCallLimit({}), 300);
  assert.equal(paidCallLimit({ JACO_NOVA_PAID_CALLS_PER_DAY: 'nonsense' }), 300);
});
