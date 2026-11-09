// Aura is the sole operator-facing agent. The legacy SEER graph and Nova mission
// runner are internal strategy and execution capabilities, not authority owners.
//
// An operator-started Full Autonomous mission may produce new files even when no
// IDE project is selected. Scope these artifacts to the existing local coding
// workspace rather than granting arbitrary edits to JACO's own source tree.
import { projectGoalCapabilities } from './seer-project.mjs';

export const AURA_ARTIFACT_ROOT = 'artifacts/aura';

export function auraArtifactContract({ goal, objective, nodeTitle, observationOnly = false } = {}) {
  if (observationOnly) return null;
  const statement = [goal, objective].map(value => String(value || '').trim()).filter(Boolean).join('\n');
  // An explicit operator prohibition must still win over the default autonomous
  // artifact scope; neither the graph planner nor the model can remove it.
  if (projectGoalCapabilities(statement).readOnly) return null;
  const title = String(nodeTitle || objective || goal || 'Aura work').slice(0, 250);
  return {
    schema: 'jaco.coding-contract/v1',
    objective: [String(objective || title), 'Parent Aura goal: ' + String(goal || '').slice(0, 2000),
      'Local deliverables must be created under artifacts/aura/. repo-write creates missing parent directories.'].join('\n\n').slice(0, 12000),
    scope: { allowed: [AURA_ARTIFACT_ROOT + '/**'] },
    acceptance: [
      'Aura produces evidence for this step and describes actual results to the operator.',
      'Any newly requested local documents or files are written under artifacts/aura/ with verified file-write receipts.',
    ],
    execution: {
      autonomous: true,
      require_human_before_destructive_action: true,
      allow_git_commit: false,
      require_git_commit: false,
      allow_git_push: false,
      allow_git_merge: false,
    },
    verification: {
      change_required: false,
      tests_required: false, // a Markdown draft must not run JACO's unrelated repository suite
      falsifier_required: false,
      receipt_required: true,
      commands: [],
    },
    budget: { max_steps: 60, max_tool_calls: 140, max_failures: 5, max_duration_ms: 3_600_000 },
  };
}
