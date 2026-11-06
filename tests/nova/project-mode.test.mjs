import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeProjectRoot, projectGoalCapabilities, projectNodeContract, projectGraphPolicy, projectGoalGraph, projectGoalDone, PROJECT_TASKS } from '../../gateway/src/seer-project.mjs';

test('a project goal with a verified graph is done and is not executed again', () => {
  const graphs = [
    { status: 'CANCELLED', policy: { strategic_goal_id: 'g1' } },
    { status: 'VERIFIED', policy: { strategic_goal_id: 'g2' } },
  ];
  assert.equal(projectGoalDone(graphs, 'g2'), true);
  assert.equal(projectGoalDone(graphs, 'g1'), false, 'a cancelled run does not complete the goal');
  assert.equal(projectGoalDone(graphs, null), false);
  assert.equal(projectGoalDone(undefined, 'g2'), false);
});
import { normalizeCodingContract, CODE_TASKS, validateCodingTask, contractVerificationStatus } from '../../agents/lib/coding-contract.mjs';
import { detectProjectTestCommand } from '../../agents/lib/project-test-command.mjs';
import { createCodingWorkspace } from '../../agents/lib/coding-workspace.mjs';
import { workspaceNodeTestPath } from '../../agents/lib/coding-contract.mjs';

const absolute = path.resolve(os.tmpdir(), 'jaco-project-mode');

test('project root is normalised and only absolute paths are accepted', () => {
  assert.equal(normalizeProjectRoot(null), null);
  assert.equal(normalizeProjectRoot(''), null);
  assert.equal(normalizeProjectRoot(absolute + path.sep), absolute);
  for (const bad of ['relative/dir', 42, 'x\0y', '/'.repeat(501)]) assert.throws(() => normalizeProjectRoot(bad), /PROJECT_ROOT_INVALID/);
});

test('project node contract is a valid coding contract that commits but never pushes or merges', () => {
  const contract = normalizeCodingContract(projectNodeContract({ title: 'Add multiply', objective: 'Add mul(a,b) to src/math.js', mainGoal: 'Extend the math helpers' }));
  assert.deepEqual(contract.scope.allowed, ['**']);
  assert.ok(contract.scope.forbidden.includes('.env'), 'default secrets stay forbidden');
  assert.equal(contract.execution.allow_git_commit, true);
  assert.equal(contract.execution.require_git_commit, true);
  assert.equal(contract.execution.allow_git_push, false);
  assert.equal(contract.execution.allow_git_merge, false);
  assert.equal(contract.execution.require_human_before_destructive_action, true);
  assert.match(contract.objective, /Extend the math helpers/);
  assert.throws(() => projectNodeContract({ title: '', objective: '' }), /PROJECT_NODE_OBJECTIVE_REQUIRED/);
});

test('project graph policy routes to Nova with code tools only when a project is set', () => {
  assert.deepEqual(projectGraphPolicy(null), {});
  const policy = projectGraphPolicy(absolute);
  assert.equal(policy.project_root, absolute);
  assert.equal(policy.executor, 'nova');
  assert.ok(PROJECT_TASKS.filter(t => !['web-fetch','mcp-call'].includes(t)).every(t => CODE_TASKS.has(t)));
  assert.ok(!PROJECT_TASKS.includes('git-push') && !PROJECT_TASKS.includes('git-merge'));
});

test('explicit read-only and network restrictions compile into mission authority', () => {
  const statement = 'Read package.json. Do not edit files or use network tools.';
  assert.deepEqual(projectGoalCapabilities(statement), {
    readOnly: true,
    restricted: true,
    tasks: ['repo-list', 'repo-read', 'git-status', 'git-diff'],
  });
  const graph = projectGoalGraph({ id: 'goal-read', statement, project_root: absolute });
  assert.deepEqual(graph.policy.allowedTasks, ['repo-list', 'repo-read', 'git-status', 'git-diff']);
  const contract = normalizeCodingContract(graph.nodes[0].contract);
  assert.equal(contract.execution.allow_git_commit, false);
  assert.equal(contract.execution.require_git_commit, false);
  assert.match(contract.acceptance.join(' '), /No repository mutation is permitted/);
});

test('an explicit CDP observation keeps browser capability while a project is open', () => {
  const statement = 'Use CDP to inspect the browser at http://localhost:3000/. Read only; do not click, type, or modify anything.';
  const capabilities = projectGoalCapabilities(statement);
  assert.equal(capabilities.readOnly, true);
  assert.ok(capabilities.tasks.includes('browser-survey-site'));
  assert.ok(!capabilities.tasks.includes('repo-write'));
  const graph = projectGoalGraph({ id: 'goal-cdp', statement, project_root: absolute });
  assert.ok(graph.policy.allowedTasks.includes('browser-survey-site'));
  assert.equal(normalizeCodingContract(graph.nodes[0].contract).execution.allow_git_commit, false);
});

test('an operator instruction on a project becomes one direct node, not a re-strategised plan', () => {
  const statement = 'Add mul(a, b) to src/math.js and a node:test for it, then commit.';
  const graph = projectGoalGraph({ id: 'goal-1', statement, project_root: absolute });
  assert.equal(graph.objective, statement);
  assert.equal(graph.policy.strategic_goal_id, 'goal-1');
  assert.equal(graph.policy.project_root, absolute);
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0].objective, statement);
  assert.ok(normalizeCodingContract(graph.nodes[0].contract).execution.allow_git_commit);
  assert.throws(() => projectGoalGraph({ id: 'g', statement, project_root: null }), /PROJECT_GOAL_REQUIRED/);
  assert.throws(() => projectGoalGraph({ id: 'g', statement: '  ', project_root: absolute }), /PROJECT_GOAL_REQUIRED/);
});

test('a Nova mission carries the project root in its metadata', async () => {
  const { NovaMissionControl } = await import('../../runtime/src/server/connected/novaMissionControl.mjs');
  const { DurableMissionBus } = await import('../../runtime/src/server/connected/durableMissionBus.mjs');
  const control = new NovaMissionControl(new DurableMissionBus(fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-project-mode-'))));
  const contract = projectNodeContract({ title: 'Add multiply', objective: 'Add mul(a,b)', mainGoal: 'math' });
  const mission = control.create({ goal: 'Add mul(a,b)', idempotencyKey: 'project-mode-1', contract, allowedTasks: ['repo-list', 'repo-read', 'repo-write', 'git-commit'], projectRoot: absolute });
  assert.equal(mission.metadata.projectRoot, absolute);
  const plain = control.create({ goal: 'Something else entirely', idempotencyKey: 'project-mode-2', contract, allowedTasks: ['repo-list'] });
  assert.equal(plain.metadata.projectRoot, undefined);
});

test('invalid project missions are refused', async () => {
  const { NovaMissionControl } = await import('../../runtime/src/server/connected/novaMissionControl.mjs');
  const { DurableMissionBus } = await import('../../runtime/src/server/connected/durableMissionBus.mjs');
  const control = new NovaMissionControl(new DurableMissionBus(fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-project-mode-'))));
  const contract = projectNodeContract({ title: 'x', objective: 'x', mainGoal: 'x' });
  assert.throws(() => control.create({ goal: 'g', idempotencyKey: 'bad-1', contract, allowedTasks: ['repo-list'], projectRoot: 'relative/dir' }), /PROJECT_ROOT_INVALID/);
  assert.throws(() => control.create({ goal: 'g', idempotencyKey: 'bad-2', projectRoot: absolute }), /PROJECT_MISSION_REQUIRES_CONTRACT/);
});

test('read-only keeps web and connector reads unless the operator turns the network off', () => {
  const { tasks } = projectGoalCapabilities('Read-only test, change nothing. Fetch https://example.com and report the title.');
  assert.ok(tasks.includes('web-fetch'));
  assert.ok(tasks.includes('mcp-call'));
  assert.ok(!tasks.includes('repo-write'));
  assert.ok(!projectGoalCapabilities('Read only, utan nätverk.').tasks.includes('web-fetch'));
});

test('without a restriction in the operator words SEER picks no tools: the mission gets what Aura has switched on', () => {
  const open = projectGraphPolicy(absolute, 'Add a mul function and run the tests.');
  assert.equal(open.project_root, absolute);
  assert.equal('allowedTasks' in open, false);
  assert.deepEqual(projectGraphPolicy(absolute, 'Read only, change nothing.').allowedTasks, ['repo-list', 'repo-read', 'git-status', 'git-diff', 'web-fetch', 'mcp-call']);
  assert.ok(projectGraphPolicy(absolute, 'Do not use the network.').allowedTasks.every(task => !['web-fetch', 'mcp-call'].includes(task)));
});


test('project node automatically authorizes tests and cannot claim completion before a passing test after the last edit', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-agentic-verification-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  const graph = projectGoalGraph({ id: 'autonomous-test', statement: 'Fix the code, run tests until green, and commit', project_root: dir });
  const contract = normalizeCodingContract(graph.nodes[0].contract);
  assert.equal(contract.execution.autonomous, true);
  assert.equal(contract.verification.tests_required, true);
  assert.deepEqual(contract.verification.commands, ['npm test']);
  assert.deepEqual(validateCodingTask({ type: 'repo-test', data: { command: 'npm test' } }, contract).data,
    { command: 'npm test', kind: 'test' });

  const write = { actionId: 'm:turn:1', type: 'repo-edit', ok: true, verified: true };
  const failed = { actionId: 'm:turn:2', type: 'repo-test', ok: false, verified: false, result: { kind: 'test', command: 'npm test' } };
  let result = contractVerificationStatus(contract, [write, failed]);
  assert.ok(result.missing.includes('tests'), 'failure must not certify the mission');
  const pass = { ...failed, actionId: 'm:turn:3', ok: true, verified: true };
  result = contractVerificationStatus(contract, [write, failed, pass]);
  assert.ok(!result.missing.includes('tests'), 'Aura may repair and pass without another approval');
  assert.ok(result.missing.includes('commit'), 'existing commit contract still applies');

  const secondEdit = { ...write, actionId: 'm:turn:4' };
  result = contractVerificationStatus(contract, [write, failed, pass, secondEdit]);
  assert.ok(result.missing.includes('tests'), 'the previous green test is invalidated by a later edit');
  const retest = { ...pass, actionId: 'm:turn:5' };
  const commit = { actionId: 'm:turn:6', type: 'git-commit', ok: true, verified: true };
  assert.equal(contractVerificationStatus(contract, [write, failed, pass, secondEdit, retest, commit]).machineVerified, true);
});

test('test discovery is shared, read-only instructions do not request test execution and absent runners are disclosed', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-agentic-discovery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'echo "no test specified" && exit 1' } }));
  assert.equal(detectProjectTestCommand(dir), null, 'placeholder scripts do not count as tests');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'echo "Running tests" && node --test' } }));
  assert.equal(detectProjectTestCommand(dir), 'npm test', 'banner + test runner stays executable');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'echo "Done" && exit 0' } }));
  assert.equal(detectProjectTestCommand(dir), null, 'echo and exit without tests is not verification');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'echo "lint && test"' } }));
  assert.equal(detectProjectTestCommand(dir), null, 'quoted && inside echo is not a second command');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: "echo 'step; && || test' && exit 0" } }));
  assert.equal(detectProjectTestCommand(dir), null, 'quoted separator data followed by exit is still a no-op');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'echo "lint && test" && node --test' } }));
  assert.equal(detectProjectTestCommand(dir), 'npm test', 'quote-aware parser preserves a later real runner');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'echo "Tests disabled" || node --test tests/client.test.mjs' } }));
  assert.equal(detectProjectTestCommand(dir), null, 'unreachable test runner after successful echo cannot certify');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'exit 0 && node --test tests/client.test.mjs' } }));
  assert.equal(detectProjectTestCommand(dir), null, 'exit before test runner cannot certify');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test tests/client.test.mjs || echo "Tests ignored"' } }));
  assert.equal(detectProjectTestCommand(dir), null, 'test failure masked by echo must not look green');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'echo "Starting" && node --test tests/client.test.mjs && echo "Done"' } }));
  assert.equal(detectProjectTestCommand(dir), 'npm test', 'all success paths run and pass the test');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test suite.test.mjs | cat' } }));
  assert.equal(detectProjectTestCommand(dir), null, 'a pipeline must not hide a failed test command');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test fail.test.mjs &' } }));
  assert.equal(detectProjectTestCommand(dir), null, 'backgrounded tests cannot provide a completion receipt');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: '! node --test fail.test.mjs' } }));
  assert.equal(detectProjectTestCommand(dir), null, 'negated test result cannot be a passing receipt');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'echo "starting" && ! node --test fail.test.mjs' } }));
  assert.equal(detectProjectTestCommand(dir), null, 'negation in a later shell stage cannot certify tests');

  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'echo "Tests disabled" # skipped && node --test fail.test.mjs' } }));
  assert.equal(detectProjectTestCommand(dir), null, 'commented-out test runner is not an executable command');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'echo "# not a shell comment" && node --test suite.test.mjs' } }));
  assert.equal(detectProjectTestCommand(dir), 'npm test', 'literal hash inside quoted banner is not a comment');

  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test passing.test.mjs || exit 1; node --test failing.test.mjs || true' } }));
  assert.equal(detectProjectTestCommand(dir), null, 'a later failed test masked by true invalidates previous green suites');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test suiteA.test.mjs && node --test suiteB.test.mjs' } }));
  assert.equal(detectProjectTestCommand(dir), 'npm test', 'two required passing test suites are certified');

  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'echo "a | b" && node --test suite.test.mjs' } }));
  assert.equal(detectProjectTestCommand(dir), 'npm test', 'quoted pipe in a banner does not hide the runner');

  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'npm run lint && node --test tests/client.test.mjs' } }));
  assert.equal(detectProjectTestCommand(dir), 'npm test', 'a successful prerequisite followed by tests is supported');


  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'echo "no test specified" && exit 1' } }));

  fs.writeFileSync(path.join(dir, 'go.mod'), 'module example.com/test\n\ngo 1.22\n');
  assert.equal(detectProjectTestCommand(dir), 'go test ./...');
  const contract = normalizeCodingContract(projectNodeContract({ title: 'Change Go code', objective: 'Fix the bug', mainGoal: 'Go module', projectRoot: dir }));
  assert.deepEqual(contract.verification.commands, ['go test ./...']);
  const readOnly = normalizeCodingContract(projectNodeContract({ title: 'Read code', objective: 'Read-only report, no changes', projectRoot: dir }));
  assert.equal(readOnly.verification.tests_required, false);
  assert.deepEqual(readOnly.verification.commands, []);

  fs.rmSync(path.join(dir, 'go.mod'));
  const noTests = normalizeCodingContract(projectNodeContract({ title: 'Create utility', objective: 'Implement it', projectRoot: dir }));
  assert.equal(noTests.verification.tests_required, false);
  assert.match(noTests.acceptance.join(' '), /automated tests were not verified/);
});

test('a single standing project contract permits newly authored tests without manual approval', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-minted-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const graph = projectGoalGraph({ id: 'mint-1', statement: 'Fix the issue and write a new regression test', project_root: dir });
  const contract = normalizeCodingContract(graph.nodes[0].contract);
  assert.equal(contract.verification.tests_required, true);
  assert.equal(contract.verification.allow_workspace_tests, true);
  assert.deepEqual(contract.verification.commands, [], 'there were no tests when the mission started');
  const runner = 'node --test tests/generated.test.mjs';
  assert.equal(workspaceNodeTestPath(runner), 'tests/generated.test.mjs');
  assert.doesNotThrow(() => validateCodingTask({ type: 'repo-test', data: { command: runner } }, contract));
  for (const cmd of [
    'node --test tests/generated.test.mjs; echo bypass',
    'node --test ../generated.test.mjs',
    'node --test tests/../outside.test.mjs',
    'node --test tests/generated.test.mjs | cat',
  ]) assert.throws(() => validateCodingTask({ type: 'repo-test', data: { command: cmd } }, contract), /CODING_TEST_COMMAND_NOT_CONTRACTED/);

  const work = createCodingWorkspace({ root: dir });
  const missing = await work.execute({ type: 'repo-test', data: { command: runner } }, contract);
  assert.equal(missing.ok, false);
  assert.match(missing.error, /CODING_GENERATED_TEST_NOT_FOUND/);
  const code = [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "test('the generated assertion runs', () => assert.equal(7 * 6, 42));",
    '',
  ].join('\n');
  const written = await work.execute({ type: 'repo-write', data: { path: 'tests/generated.test.mjs', content: code } }, contract);
  assert.equal(written.ok, true);
  const checked = await work.execute({ type: 'repo-test', data: { command: runner } }, contract);
  assert.equal(checked.ok, true, checked.error || 'test execution did not succeed');
  assert.equal(checked.verified, true);
  assert.equal(checked.generatedTest, 'tests/generated.test.mjs');
  const receipts = [
    { type: 'repo-write', actionId: 'mint:turn:1', ok: true, verified: true, result: written },
    { type: 'repo-test', actionId: 'mint:turn:2', ok: true, verified: true, result: checked },
  ];
  const status = contractVerificationStatus(contract, receipts);
  assert.ok(!status.missing.includes('tests'), 'generated test satisfies the original contract');
  assert.ok(status.missing.includes('commit'), 'the existing commit requirement still applies');
});

test('skipped-only generated tests do not certify a coding mission', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-skipped-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.writeFileSync(path.join(dir, 'tests', 'all-skipped.test.mjs'),
    "import test from 'node:test'; test.skip('unrun assertion', () => { throw Error('would fail'); });\n");
  const contract = normalizeCodingContract(projectNodeContract({
    title: 'Test bug', objective: 'Fix a bug and create regression tests', projectRoot: dir,
  }));
  const work = createCodingWorkspace({ root: dir });
  const result = await work.execute({ type: 'repo-test', data: {
    command: 'node --test tests/all-skipped.test.mjs',
  } }, contract);
  assert.equal(result.ok, false, 'a skipped suite without any passing test is not evidence');
  assert.equal(result.verified, false);
  assert.match(result.error, /CODING_GENERATED_TEST_NO_PASSING_TESTS_OBSERVED/);
});

test('dynamically discovered tests never widen an explicitly read-only contract', () => {
  const contract = normalizeCodingContract(projectNodeContract({
    title: 'Read sources', objective: 'Read-only assessment; do not edit or test files',
  }));
  assert.equal(contract.verification.allow_workspace_tests, false);
  assert.throws(() => validateCodingTask({ type: 'repo-test', data: {
    command: 'node --test tests/generated.test.mjs',
  } }, contract), /CODING_TEST_COMMAND_NOT_CONTRACTED/);
});

test('a generated passing test cannot override a failing original project suite', () => {
  const contract = normalizeCodingContract({
    objective: 'Fix application regression',
    scope: { allowed: ['**'] },
    acceptance: ['Original suite passes'],
    verification: { tests_required: true, allow_workspace_tests: true, commands: ['npm test'] },
    execution: { allow_git_commit: false, require_git_commit: false },
  });
  const originalFail = { type: 'repo-test', actionId: 'mint:turn:1', ok: false, verified: false,
    result: { command: 'npm test', kind: 'test' } };
  const mintedPass = { type: 'repo-test', actionId: 'mint:turn:2', ok: true, verified: true,
    result: { command: 'node --test tests/isolated.test.mjs', kind: 'test' } };
  const status = contractVerificationStatus(contract, [originalFail, mintedPass]);
  assert.ok(status.missing.includes('tests'), 'the declared project test suite still fails');
  const originalGreen = { ...originalFail, actionId: 'mint:turn:3', ok: true, verified: true };
  assert.equal(contractVerificationStatus(contract, [originalFail, mintedPass, originalGreen]).machineVerified, true);
});

test('a mission that builds something new does not need the whole project test suite; a fix still does', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
    const made = normalizeCodingContract(projectNodeContract({ title: 'Demo', objective: 'Build a sellable HTML demo page in demo/index.html', mainGoal: 'Create a product demo', projectRoot: root }));
    assert.equal(made.verification.tests_required, false);
    assert.equal(made.verification.change_required, true);
    assert.deepEqual(contractVerificationStatus(made, [{ type: 'repo-list', ok: true, verified: true, actionId: 'm:turn:1' }]).missing, ['change'], 'reading is not making');
    assert.deepEqual(made.verification.commands, []);
    assert.equal(contractVerificationStatus(made, [{ type: 'repo-write', ok: true, verified: true, actionId: 'm:turn:1', result: { beforeSha256: null, afterSha256: 'x' } }, { type: 'git-commit', ok: true, verified: true, actionId: 'm:turn:2' }]).machineVerified, true);
    const fix = normalizeCodingContract(projectNodeContract({ title: 'Fix', objective: 'Fix the bug in the demo page', mainGoal: 'Fix it', projectRoot: root }));
    assert.equal(fix.verification.tests_required, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
