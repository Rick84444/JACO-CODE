// Every sub-test builds its own temp git project and state directory with fs.mkdtempSync and passes
// an explicit cwd to each git command, so one failing sub-test cannot leak state into the next.
// Cleanup runs in an afterEach hook, and progress plus git diagnostics go to stderr, because
// node --test reports failures on stdout, which a harness can swallow.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as nodeTest from 'node:test';
import { createMissionWorktrees } from './mission-worktree.mjs';

const note = message => {
  try { process.stderr.write(`[mission-worktree.test] ${message}\n`); } catch { /* stderr closed */ }
};

note(`boot node=${process.version}`);

// Older node:test builds do not export every named hook, so only what exists is used.
const testFn = typeof nodeTest.test === 'function' ? nodeTest.test
  : typeof nodeTest.default === 'function' ? nodeTest.default
    : typeof nodeTest.it === 'function' ? nodeTest.it
      : null;
if (!testFn) throw new Error('NODE_TEST_UNAVAILABLE');

const afterEachFn = typeof nodeTest.afterEach === 'function' ? nodeTest.afterEach : null;

// Every temp dir a sub-test creates is registered here and removed by the afterEach cleanup.
const tracked = [];

const cleanup = () => {
  for (const dir of tracked.splice(0).reverse()) {
    try { fs.rmSync(dir, { recursive: true, force: true }); }
    catch (error) { note(`cleanup failed for ${dir}: ${error?.message}`); }
  }
};

if (afterEachFn) afterEachFn(cleanup);
else process.on('exit', cleanup);

const it = (name, body) => testFn(name, async () => {
  note(`start: ${name}`);
  try {
    await body();
    note(`ok: ${name}`);
  } catch (error) {
    note(`fail: ${name}: ${error?.name || 'Error'}: ${error?.message}`);
    throw error;
  }
});

// Runs git without throwing, so a sub-test can assert the exit status itself.
const gitRun = (args, cwd) => {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    spawnError: result.error ? result.error.message : null,
  };
};

// Setup helper: a non-zero git exit fails the sub-test with the command, cwd and git diagnostic.
const git = (args, cwd) => {
  const run = gitRun(args, cwd);
  if (run.status !== 0) note(`git ${args.join(' ')} exited ${run.status} in ${cwd}: ${run.stderr}`);
  assert.equal(run.status, 0, `git ${args.join(' ')} exited ${run.status} in ${cwd}: ${run.stderr}`);
  return run.stdout;
};

const makeTempDir = prefix => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tracked.push(dir);
  return dir;
};

// A real repository on disk: `git worktree` cannot be exercised against mocks.
const makeProject = ({ commit = true } = {}) => {
  const dir = makeTempDir('jaco-project-');
  git(['init'], dir);
  git(['config', 'user.email', 'nova@example.invalid'], dir);
  git(['config', 'user.name', 'Nova Test'], dir);
  // A global core.autocrlf=true (common on Windows) would check files out with CRLF in the worktree.
  git(['config', 'core.autocrlf', 'false'], dir);
  if (commit) {
    fs.writeFileSync(path.join(dir, 'README.md'), '# project\n', 'utf8');
    git(['add', 'README.md'], dir);
    git(['commit', '-m', 'initial commit'], dir);
  }
  return dir;
};

const fixture = ({ commit = true } = {}) => {
  const projectRoot = makeProject({ commit });
  const stateDir = makeTempDir('jaco-state-');
  return { projectRoot, stateDir, api: createMissionWorktrees({ stateDir }) };
};

it('pathFor resolves under stateDir/worktrees', () => {
  const stateDir = makeTempDir('jaco-state-');
  const api = createMissionWorktrees({ stateDir });
  assert.equal(api.pathFor('m1'), path.join(stateDir, 'worktrees', 'm1'));
});

it('ensure creates a worktree on branch jaco/m1 with the committed file', () => {
  const { projectRoot, stateDir, api } = fixture();
  const created = api.ensure({ projectRoot, missionId: 'm1' });
  assert.equal(created.path, path.join(stateDir, 'worktrees', 'm1'));
  assert.equal(created.branch, 'jaco/m1');
  assert.equal(created.created, true);
  assert.equal(fs.existsSync(created.path), true);
  assert.equal(fs.readFileSync(path.join(created.path, 'README.md'), 'utf8'), '# project\n');
  const head = gitRun(['rev-parse', '--abbrev-ref', 'HEAD'], created.path);
  assert.equal(head.status, 0);
  assert.equal(head.stdout, 'jaco/m1');
  assert.match(created.base, /^[0-9a-f]{40}$/);
});

it('a second ensure reuses the worktree with created:false', () => {
  const { projectRoot, stateDir, api } = fixture();
  api.ensure({ projectRoot, missionId: 'm1' });
  const again = api.ensure({ projectRoot, missionId: 'm1' });
  assert.deepEqual(again, { path: path.join(stateDir, 'worktrees', 'm1'), branch: 'jaco/m1', created: false });
});

it('a commit in the worktree leaves the project working copy clean', () => {
  const { projectRoot, api } = fixture();
  const created = api.ensure({ projectRoot, missionId: 'm1' });
  fs.writeFileSync(path.join(created.path, 'mission-notes.md'), 'worktree only\n', 'utf8');
  git(['add', 'mission-notes.md'], created.path);
  git(['commit', '-m', 'mission commit'], created.path);
  const status = gitRun(['status', '--porcelain'], projectRoot);
  assert.equal(status.status, 0);
  assert.equal(status.stdout, '');
  assert.equal(fs.existsSync(path.join(projectRoot, 'mission-notes.md')), false);
});

it('remove deletes the worktree but keeps the branch', () => {
  const { projectRoot, api } = fixture();
  const created = api.ensure({ projectRoot, missionId: 'm1' });
  assert.deepEqual(api.remove({ projectRoot, missionId: 'm1' }), { removed: true });
  assert.equal(fs.existsSync(created.path), false);
  const branches = gitRun(['branch', '--list', 'jaco/m1'], projectRoot);
  assert.equal(branches.status, 0);
  assert.match(branches.stdout, /jaco\/m1/);
});

it('ensure after remove re-attaches the existing branch with its commit', () => {
  const { projectRoot, stateDir, api } = fixture();
  const created = api.ensure({ projectRoot, missionId: 'm1' });
  fs.writeFileSync(path.join(created.path, 'mission-notes.md'), 'worktree only\n', 'utf8');
  git(['add', 'mission-notes.md'], created.path);
  git(['commit', '-m', 'mission commit'], created.path);
  api.remove({ projectRoot, missionId: 'm1' });
  const reattached = api.ensure({ projectRoot, missionId: 'm1' });
  assert.equal(reattached.created, true);
  assert.equal(reattached.path, path.join(stateDir, 'worktrees', 'm1'));
  assert.equal(reattached.branch, 'jaco/m1');
  const head = gitRun(['rev-parse', '--abbrev-ref', 'HEAD'], reattached.path);
  assert.equal(head.status, 0);
  assert.equal(head.stdout, 'jaco/m1');
  assert.equal(fs.readFileSync(path.join(reattached.path, 'mission-notes.md'), 'utf8'), 'worktree only\n');
});

it('invalid inputs: missionId ../x throws MISSION_ID_INVALID', () => {
  const { projectRoot, api } = fixture();
  assert.throws(() => api.pathFor('../x'), { message: 'MISSION_ID_INVALID' });
  assert.throws(() => api.ensure({ projectRoot, missionId: '../x' }), { message: 'MISSION_ID_INVALID' });
  assert.throws(() => api.remove({ projectRoot, missionId: '../x' }), { message: 'MISSION_ID_INVALID' });
  assert.equal(fs.existsSync(path.join(projectRoot, 'worktrees')), false);
});

it('invalid inputs: a non-git temp dir throws PROJECT_NOT_GIT_ROOT', () => {
  const api = createMissionWorktrees({ stateDir: makeTempDir('jaco-state-') });
  const projectRoot = makeTempDir('jaco-plain-');
  assert.throws(() => api.ensure({ projectRoot, missionId: 'm1' }), { message: 'PROJECT_NOT_GIT_ROOT' });
});

it('invalid inputs: a subdirectory of the repository throws PROJECT_NOT_GIT_ROOT', () => {
  const { projectRoot, api } = fixture();
  const subdirectory = path.join(projectRoot, 'nested');
  fs.mkdirSync(subdirectory, { recursive: true });
  assert.throws(() => api.ensure({ projectRoot: subdirectory, missionId: 'm1' }), { message: 'PROJECT_NOT_GIT_ROOT' });
});

it('invalid inputs: a fresh git init without a commit throws PROJECT_HAS_NO_COMMITS', () => {
  const { projectRoot, api } = fixture({ commit: false });
  assert.throws(() => api.ensure({ projectRoot, missionId: 'm1' }), { message: 'PROJECT_HAS_NO_COMMITS' });
});

it('invalid inputs: a stateDir inside the project throws STATE_INSIDE_PROJECT', () => {
  const projectRoot = makeProject();
  const stateDir = path.join(projectRoot, '.jaco-worktrees');
  const api = createMissionWorktrees({ stateDir });
  assert.throws(() => api.ensure({ projectRoot, missionId: 'm1' }), { message: 'STATE_INSIDE_PROJECT' });
  assert.throws(() => api.remove({ projectRoot, missionId: 'm1' }), { message: 'STATE_INSIDE_PROJECT' });
  assert.equal(fs.existsSync(stateDir), false);
});
