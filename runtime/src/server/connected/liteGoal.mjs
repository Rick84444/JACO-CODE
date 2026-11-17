// JACO Lite creates its project mission directly, without the gateway planner.
// Both full IDE and Lite now discover project test commands through one shared module,
// so an agent can edit, test, retry and verify without a second approval for each run.
// Lite additionally requires a Git repository with an initial commit for its worktree.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { projectNodeContract, projectGoalCapabilities, PROJECT_TASKS } from '../../../../gateway/src/seer-project.mjs';
import { detectProjectTestCommand } from '../../../../agents/lib/project-test-command.mjs';

// The same bounded project tools, including read-only MCP, are available in Lite.
export const LITE_TASKS = [...PROJECT_TASKS];

// The complete IDE and Lite modes use the same evidence-based test discovery.
export { detectProjectTestCommand as detectTestCommand } from '../../../../agents/lib/project-test-command.mjs';

export function liteContract({ goal, testCommand }) {
  return projectNodeContract({
    title: String(goal).replace(/\s+/g, ' ').slice(0, 80),
    objective: goal, mainGoal: goal, discoveredTestCommand: testCommand,
  });
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
  const testCommand = detectProjectTestCommand(projectRoot, fsImpl);
  const contract = liteContract({ goal: text, testCommand });
  const scope = projectGoalCapabilities(text);
  const mission = novaMissions.create({
    goal: text, source: 'lite-goal', idempotencyKey: `lite-${Date.now()}-${crypto.randomUUID()}`,
    allowedTasks: scope.tasks, contract, projectRoot,
  });
  return { ok: true, mission, testCommand: contract.verification.commands[0] || null,
    testsRequired: contract.verification.tests_required, initialized: Boolean(repo.initialized) };
}
