// JACO Lite: a goal without SEER (liteGoal.mjs) and Nova's model chain built from what the user connected.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectTestCommand, liteContract, ensureGitProject, createLiteGoal, LITE_TASKS } from '../../runtime/src/server/connected/liteGoal.mjs';
import { orderedBrainProviders, setConnectedProvidersForTest } from '../../agents/hands-off-agent.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-lite-goal-'));
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };

test('the test command comes from the project itself; npm\'s placeholder does not count', () => {
  const dir = tmp();
  assert.equal(detectTestCommand(dir), null);
  write(dir, 'package.json', JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
  assert.equal(detectTestCommand(dir), null);
  write(dir, 'package.json', JSON.stringify({ scripts: { test: 'node --test' } }));
  assert.equal(detectTestCommand(dir), 'npm test');
  write(dir, 'package.json', '{ not json');
  assert.equal(detectTestCommand(dir), null);
  const py = tmp(); write(py, 'pytest.ini', '[pytest]\n');
  assert.equal(detectTestCommand(py), 'python -m pytest');
});

test('the contract REQUIRES the project\'s tests when there is a command, and says plainly when there is none', () => {
  const withTests = liteContract({ goal: 'Add mul', testCommand: 'npm test' });
  assert.deepEqual([withTests.verification.tests_required, withTests.verification.commands], [true, ['npm test']]);
  assert.ok(withTests.acceptance.some(a => /npm test.*pass after the last change/.test(a)));
  const without = liteContract({ goal: 'Add mul', testCommand: null });
  assert.equal(without.verification.tests_required, false);
  assert.ok(without.acceptance.some(a => /NOT verified by tests/.test(a)));
  for (const c of [withTests, without]) {
    assert.deepEqual([c.execution.allow_git_push, c.execution.allow_git_merge, c.execution.require_git_commit], [false, false, true], 'the agent can commit on its own branch, never push or merge');
    assert.equal(c.schema, 'jaco.coding-contract/v1');
  }
});

test('Nova needs a git repository with a commit: told how, or made one on request', () => {
  const calls = [];
  const fake = (headOk, failCommit = false) => { let head = headOk; return (_cwd, ...args) => { calls.push(args[0]); if (args[0] === 'rev-parse') return { status: head ? 0 : 1, stderr: '' }; if (args.includes('commit')) { if (failCommit) return { status: 1, stderr: 'no identity', stdout: '' }; head = true; } return { status: 0, stderr: '', stdout: '' }; }; };
  const dir = tmp();
  assert.deepEqual(ensureGitProject(dir, { run: fake(true) }), { ok: true });
  const refused = ensureGitProject(dir, { run: fake(false) });
  assert.deepEqual([refused.ok, refused.code], [false, 'PROJECT_NOT_GIT']);
  assert.match(refused.message, /git init/);
  const made = ensureGitProject(dir, { initGit: true, run: fake(false) });
  assert.deepEqual([made.ok, made.initialized], [true, true]);
  assert.ok(calls.includes('init') && calls.includes('add'));
  assert.equal(ensureGitProject(dir, { initGit: true, run: fake(false, true) }).code, 'GIT_COMMIT_FAILED');
});

test('createLiteGoal makes a project mission with the allowed tasks, the contract and the project root', () => {
  const dir = tmp(); write(dir, 'package.json', JSON.stringify({ scripts: { test: 'node --test' } }));
  const created = [];
  const novaMissions = { create: input => { created.push(input); return { id: 'mission-1', status: 'ACTIVE' }; } };
  const run = () => ({ status: 0, stderr: '', stdout: '' });
  const ok = createLiteGoal({ novaMissions, projectRoot: dir, goal: '  Add a function mul(a, b)  ', run });
  assert.deepEqual([ok.ok, ok.testsRequired, ok.testCommand, ok.mission.id], [true, true, 'npm test', 'mission-1']);
  assert.deepEqual([created[0].goal, created[0].projectRoot, created[0].source, created[0].allowedTasks], ['Add a function mul(a, b)', dir, 'lite-goal', LITE_TASKS]);
  assert.equal(created[0].contract.verification.tests_required, true);
  assert.ok(/^lite-\d+-/.test(created[0].idempotencyKey));
  assert.equal(createLiteGoal({ novaMissions, projectRoot: dir, goal: '   ', run }).code, 'GOAL_REQUIRED');
  assert.equal(createLiteGoal({ novaMissions, projectRoot: dir, goal: 'x'.repeat(12001), run }).code, 'GOAL_TOO_LARGE');
  assert.equal(created.length, 1, 'nothing is created for a rejected goal');
  assert.equal(createLiteGoal({ novaMissions, projectRoot: dir, goal: 'Do it', run: (_c, ...a) => ({ status: a[0] === 'rev-parse' ? 1 : 0, stderr: '' }) }).code, 'PROJECT_NOT_GIT');
});

test('Lite: Nova\'s model chain is what the user connected (any kind), with no fixed local server in it', () => {
  const env = { JACO_LITE: '1', JACO_PLANNER_CHOICE_FILE: path.join(tmp(), 'none.json'), GROQ_API_KEY: 'x' };
  try {
    setConnectedProvidersForTest([
      { name: 'my-cloud', url: 'https://cloud.example/v1/chat/completions', envKey: 'MY_CLOUD_KEY', model: 'big' },
      { name: 'lmstudio', url: 'http://127.0.0.1:1234/v1/chat/completions', envKey: null, model: 'qwen', free: true },
    ]);
    const names = orderedBrainProviders(env).map(p => p.name);
    assert.deepEqual(names.slice(0, 2), ['my-cloud', 'lmstudio'], 'the connected ones lead, in the order the runtime gave');
    assert.equal(names.includes('ollama') || names.includes('ollama-local'), false, 'nothing is tied to one local server');
    assert.ok(names.includes('groq'), 'keyed cloud providers stay as fallbacks');
    assert.equal(orderedBrainProviders({ ...env, JACO_PRIMARY_PROVIDER: 'lmstudio' })[0].name, 'lmstudio', 'the operator\'s primary provider still wins');
    assert.ok(orderedBrainProviders({ ...env, JACO_LITE: '' }).some(p => p.name === 'ollama'), 'outside Lite the fixed chain is unchanged');
  } finally { setConnectedProvidersForTest([]); }
});

test('Lite never takes commands from the maintainers\' GitHub repository', async () => {
  const { createGithubNovaControlInbox } = await import('../../agents/lib/github-control-inbox.mjs');
  const on = createGithubNovaControlInbox({ missionClient: {} });
  assert.equal(on.enabled, true, 'the maintainers\' own setup keeps it');
  const lite = createGithubNovaControlInbox({ missionClient: {}, repo: '' });
  assert.equal(lite.enabled, false, 'an empty repo switches the inbox off');
  const src = fs.readFileSync(new URL('../../agents/hands-off-agent.mjs', import.meta.url), 'utf8');
  assert.match(src, /JACO_LITE === '1' && !process\.env\.JACO_GITHUB_CONTROL_REPO \? \{ repo: '' \}/, 'the agent passes it in Lite');
});
