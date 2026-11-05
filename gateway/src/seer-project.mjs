import path from 'node:path';
import { detectProjectTestCommand } from '../../agents/lib/project-test-command.mjs';

// Project mode: a goal the operator starts while a project is open in the IDE is work on that
// project. Nova runs each node in its own git worktree of the project (agents/lib/mission-worktree.mjs),
// so the contract may cover the whole tree and commit there, but never push or merge.
export const PROJECT_TASKS = ['repo-list', 'repo-read', 'repo-write', 'repo-edit', 'repo-test', 'repo-service', 'git-status', 'git-diff', 'git-commit', 'web-fetch', 'mcp-call'];
// Read-only means the project is not changed. Reading the web and read-only connectors still count as reading;
// an operator who wants them off says "no network", handled below.
const PROJECT_READ_TASKS = ['repo-list', 'repo-read', 'git-status', 'git-diff', 'web-fetch', 'mcp-call'];

// Explicit operator restrictions are executable policy, not prompt advice. This
// is deliberately narrow: only clear negative language removes capabilities;
// ambiguous goals retain the normal project contract and are bounded elsewhere.
export function projectGoalCapabilities(statement) {
  const text = String(statement || '');
  const readOnly = /\b(?:read[ -]?only|no (?:edits?|changes?|writes?)|do not (?:edit|change|modify|write))\b|\b(?:ändra|modifiera|skriv) inte\b|\binga (?:ändringar|skrivningar)\b/i.test(text);
  const noNetwork = /\bno (?:network|internet)\b|\b(?:do not|don't|without)\b[^.\n]*\b(?:network|internet)\b|\b(?:inget|ingen|utan) (?:nätverk|internet)\b/i.test(text);
  const tasks = readOnly ? [...PROJECT_READ_TASKS] : [...PROJECT_TASKS];
  // A browser observation remains an Aura mission even when an IDE project is
  // open. Project binding scopes repository access; it must not erase the CDP
  // capability the operator explicitly requested.
  const browserObservation = /\b(?:cdp|browser|web page|webpage|webbläsar|webbsida)\b/i.test(text)
    && /\b(?:observe|inspect|survey|capture|screenshot|read|visa|granska|inspektera|skärmbild)\b/i.test(text);
  if (browserObservation) tasks.push('browser-survey-site');
  // restricted: the operator narrowed the scope in words. Otherwise SEER does not pick tools at all:
  // planning is one of Aura's abilities and the mission gets whatever Aura has switched on.
  return { readOnly, restricted: readOnly || noNetwork, tasks: [...new Set(noNetwork ? tasks.filter(task => !['web-fetch', 'mcp-call'].includes(task)) : tasks)] };
}

export function normalizeProjectRoot(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.includes('\0') || value.length > 500 || !path.isAbsolute(value)) throw new Error('PROJECT_ROOT_INVALID');
  return path.resolve(value);
}

export function projectNodeContract({ title, objective, mainGoal, projectRoot = null }) {
  const what = String(objective || title || '').trim();
  if (!what) throw new Error('PROJECT_NODE_OBJECTIVE_REQUIRED');
  const { readOnly } = projectGoalCapabilities(`${what}\n${String(mainGoal || '')}`);
  const testCommand = readOnly ? null : detectProjectTestCommand(projectRoot);
  const needsNewTests = !readOnly && /\b(?:test|tests|testing|fix|bug|debug|repair|regression|verify|verification|falsifier|testa|felsök)\b/i.test(what);
  return {
    schema: 'jaco.coding-contract/v1',
    objective: `${what}\n\nPart of the operator goal: ${String(mainGoal || '').slice(0, 2000)}`.slice(0, 12000),
    scope: { allowed: ['**'] },
    acceptance: readOnly
      ? [`${String(title || what).slice(0, 300)} is answered from verified read receipts`, 'No repository mutation is permitted']
      : [`${String(title || what).slice(0, 300)} is implemented in the project and observable through a receipt`, testCommand ? `The project's tests (${testCommand}) pass after the last code change` : needsNewTests ? 'Create and pass a new workspace test after the final code change' : 'No project test command discovered; report that automated tests were not verified'],
    execution: {
      autonomous: true,
      require_human_before_destructive_action: true,
      allow_git_commit: !readOnly,
      require_git_commit: !readOnly,
      allow_git_push: false,
      allow_git_merge: false,
    },
    verification: { tests_required: Boolean(testCommand) || needsNewTests, allow_workspace_tests: !readOnly, falsifier_required: false, receipt_required: true, commands: testCommand ? [testCommand] : [] },
    budget: { max_steps: 40, max_tool_calls: 60, max_failures: 5, max_duration_ms: 3_600_000 },
  };
}

export function projectGraphPolicy(projectRoot, statement = '') {
  if (!projectRoot) return {};
  const scope = projectGoalCapabilities(statement);
  return { project_root: projectRoot, executor: 'nova', ...(scope.restricted ? { allowedTasks: scope.tasks } : {}) };
}

// A project instruction is done once one of its graphs is verified; it must not be executed again.
export function projectGoalDone(graphs, goalId) {
  return Boolean(goalId) && (graphs || []).some(graph => graph?.policy?.strategic_goal_id === goalId && graph.status === 'VERIFIED');
}

// An instruction on the operator's own project is the task itself, as in any coding IDE: it is not
// re-strategised by the governor. Nova decomposes it while working, inside one contract.
export function projectGoalGraph(primaryGoal) {
  const statement = String(primaryGoal?.statement || '').trim();
  const projectRoot = normalizeProjectRoot(primaryGoal?.project_root);
  if (!statement || !projectRoot) throw new Error('PROJECT_GOAL_REQUIRED');
  const title = statement.replace(/\s+/g, ' ').slice(0, 80);
  return {
    title,
    objective: statement,
    policy: {
      ...projectGraphPolicy(projectRoot, statement),
      source: 'operator-start-prompt',
      autonomy: 'closed-loop',
      strategic_goal_id: primaryGoal.id || null,
      reversible: true,
      external_spend: 0,
    },
    nodes: [{ key: 'implement', title, objective: statement, dependencies: [], contract: projectNodeContract({ title, objective: statement, mainGoal: statement, projectRoot }) }],
  };
}
