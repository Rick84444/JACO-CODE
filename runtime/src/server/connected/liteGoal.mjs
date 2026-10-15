// A goal in JACO Lite: no SEER, so the runtime creates the Nova mission itself. Differences from the
// SEER path (gateway/src/seer-project.mjs), on purpose:
//   - the contract REQUIRES the project's own tests after the last change when a test command can be
//     found (the SEER path switches that off, which is how an earlier "VERIFIED" Lite package had two
//     failing tests); a project without a test command is labelled as not verified by tests;
//   - Nova works in a git copy of the project, so the project must be a git repository with commits.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { projectNodeContract } from '../../../../gateway/src/seer-project.mjs';

export const LITE_TASKS = ['repo-list', 'repo-read', 'repo-write', 'repo-edit', 'repo-test', 'repo-service', 'git-status', 'git-diff', 'git-commit', 'web-fetch'];

// The command that runs the project's tests, or null. Only commands Nova may run without extra setup:
// npm test (not npm's "no test specified" placeholder), node's own runner, Python's pytest.
export function detectTestCommand(projectRoot, fsImpl = fs) {
  const has = rel => fsImpl.existsSync(path.join(projectRoot, rel));
  if (has('package.json')) {
    try {
      const script = String(JSON.parse(fsImpl.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).scripts?.test || '');
      if (script.trim() && !/no test specified/i.test(script)) return 'npm test';
    } catch { /* unreadable package.json: no command */ }
  }
  if (has('pytest.ini') || has('conftest.py') || (has('pyproject.toml') && /pytest/.test(fsImpl.readFileSync(path.join(projectRoot, 'pyproject.toml'), 'utf8')))) return 'python -m pytest';
  return null;
}

export function liteContract({ goal, testCommand }) {
  const base = projectNodeContract({ title: String(goal).slice(0, 120), objective: goal, mainGoal: goal });
  return {
    ...base,
    acceptance: [
      ...base.acceptance.slice(0, 1),
      testCommand ? `The project's tests (${testCommand}) pass after the last change` : 'No test command was found in this project: the result is NOT verified by tests',
    ],
    verification: { tests_required: Boolean(testCommand), falsifier_required: false, independent_verification: false, receipt_required: true, commands: testCommand ? [testCommand] : [], required_stages: [] },
    budget: { max_steps: 60, max_tool_calls: 120, max_failures: 5, max_duration_ms: 3_600_000 },
  };
}

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });

// Nova needs a repository with at least one commit. With initGit the folder is made one (its own
// .gitignore decides what is committed); without it the operator is told how.
export function ensureGitProject(projectRoot, { initGit = false, run = git } = {}) {
  const head = () => run(projectRoot, 'rev-parse', '--verify', 'HEAD').status === 0;
  if (head()) return { ok: true };
  if (!initGit) {
    return { ok: false, code: 'PROJECT_NOT_GIT', message: 'Nova works in a git copy of the project. This folder is not a git repository with a commit yet: run "git init", "git add ." and "git commit -m start" in it, or let JACO do it.' };
  }
  if (!fs.existsSync(path.join(projectRoot, '.git'))) {
    const init = run(projectRoot, 'init');
    if (init.status !== 0) return { ok: false, code: 'GIT_INIT_FAILED', message: String(init.stderr).slice(0, 200) };
  }
  // The state folder is never part of the project's history.
  run(projectRoot, 'add', '-A', '--', '.', ':!.jaco');
  const commit = run(projectRoot, '-c', 'user.name=JACO', '-c', 'user.email=jaco@localhost', 'commit', '--allow-empty', '-m', 'Initial commit (JACO Lite)');
  if (commit.status !== 0 || !head()) return { ok: false, code: 'GIT_COMMIT_FAILED', message: String(commit.stderr || commit.stdout).slice(0, 200) };
  return { ok: true, initialized: true };
}

export function createLiteGoal({ novaMissions, projectRoot, goal, initGit = false, run = git, fsImpl = fs }) {
  const text = String(goal || '').trim();
  if (!text) return { ok: false, code: 'GOAL_REQUIRED', message: 'Write what you want done.' };
  if (text.length > 12000) return { ok: false, code: 'GOAL_TOO_LARGE', message: 'The goal is too long.' };
  const repo = ensureGitProject(projectRoot, { initGit, run });
  if (!repo.ok) return repo;
  const testCommand = detectTestCommand(projectRoot, fsImpl);
  const mission = novaMissions.create({
    goal: text, source: 'lite-goal', idempotencyKey: `lite-${Date.now()}-${crypto.randomUUID()}`,
    allowedTasks: LITE_TASKS, contract: liteContract({ goal: text, testCommand }), projectRoot,
  });
  return { ok: true, mission, testCommand, testsRequired: Boolean(testCommand), initialized: Boolean(repo.initialized) };
}
