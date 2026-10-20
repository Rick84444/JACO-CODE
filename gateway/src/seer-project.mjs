import path from 'node:path';

// Project mode: a goal the operator starts while a project is open in the IDE is work on that
// project. Nova runs each node in its own git worktree of the project (agents/lib/mission-worktree.mjs),
// so the contract may cover the whole tree and commit there, but never push or merge.
export const PROJECT_TASKS = ['repo-list', 'repo-read', 'repo-write', 'repo-edit', 'repo-test', 'repo-service', 'git-status', 'git-diff', 'git-commit', 'web-fetch', 'mcp-call'];

export function normalizeProjectRoot(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.includes('\0') || value.length > 500 || !path.isAbsolute(value)) throw new Error('PROJECT_ROOT_INVALID');
  return path.resolve(value);
}

export function projectNodeContract({ title, objective, mainGoal }) {
  const what = String(objective || title || '').trim();
  if (!what) throw new Error('PROJECT_NODE_OBJECTIVE_REQUIRED');
  return {
    schema: 'jaco.coding-contract/v1',
    objective: `${what}\n\nPart of the operator goal: ${String(mainGoal || '').slice(0, 2000)}`.slice(0, 12000),
    scope: { allowed: ['**'] },
    acceptance: [
      `${String(title || what).slice(0, 300)} is implemented in the project and observable through a receipt`,
      'Existing project tests still pass when the project has tests',
    ],
    execution: {
      autonomous: true,
      require_human_before_destructive_action: true,
      allow_git_commit: true,
      require_git_commit: true,
      allow_git_push: false,
      allow_git_merge: false,
    },
    verification: { tests_required: false, falsifier_required: false, receipt_required: true, commands: [] },
    budget: { max_steps: 40, max_tool_calls: 60, max_failures: 5, max_duration_ms: 3_600_000 },
  };
}

export function projectGraphPolicy(projectRoot) {
  return projectRoot ? { project_root: projectRoot, executor: 'nova', allowedTasks: PROJECT_TASKS } : {};
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
      ...projectGraphPolicy(projectRoot),
      source: 'operator-start-prompt',
      autonomy: 'closed-loop',
      strategic_goal_id: primaryGoal.id || null,
      reversible: true,
      external_spend: 0,
    },
    nodes: [{ key: 'implement', title, objective: statement, dependencies: [], contract: projectNodeContract({ title, objective: statement, mainGoal: statement }) }],
  };
}
