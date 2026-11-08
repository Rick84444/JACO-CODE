// Evidence-first repair advice for Aura's existing mission loop.
//
// This is a pure advisory function, not a planner, executor, approval service, or
// second agent. Every candidate is selected from the mission's actual tools.
// Hypotheses are unverified until a subsequent tool receipt supports them.
import { redactDeep } from './secret-capture.mjs';

export const ADAPTIVE_REPAIR_SCHEMA = 'jaco.aura.adaptive-repair/v1';

const READ_ONLY = new Set([
  'repo-list', 'repo-read', 'git-status', 'git-diff', 'health-check',
  'desktop-observe', 'android-observe', 'browser-survey-site',
]);
const trim = (value, max) => String(value ?? '').slice(0, max);
const errorOf = receipt => trim(
  receipt?.error || receipt?.result?.error || receipt?.result?.receipt?.error || 'TOOL_FAILED', 350
);

export function classifyRepairFailure(task, receipt) {
  const error = errorOf(receipt);
  if (receipt?.outcomeUnknown === true) return 'UNKNOWN_OUTCOME';
  if (/APPROVAL_REQUIRED|PERMISSION|ACCESS_DENIED|_DENIED|FORBIDDEN|UNAUTHORIZED|\b403\b|EACCES|NOT_ALLOWED|SCOPE_/i.test(error)) return 'AUTHORITY';
  if (/ENOENT|NOT_FOUND|NO_SUCH_FILE|CODING_PATH|FILE_MISSING/i.test(error)) return 'MISSING_PATH';
  if (task?.type === 'repo-test' || /TEST_FAILED|ASSERTIONERROR|FAIL(?:ED|URE)?:.*TEST/i.test(error)) return 'TEST_FAILURE';
  if (/RATE_LIMIT|\b429\b|ECONNRESET|ETIMEDOUT|\b503\b|TEMPORARILY_UNAVAILABLE/i.test(error)) return 'TRANSIENT';
  return 'TOOL_FAILURE';
}

function failureCount(task, classification, history) {
  if (!Array.isArray(history)) return 1;
  const matches = history.filter(record =>
    record?.type === task?.type && record.ok === false &&
    classifyRepairFailure(task, record) === classification
  ).length;
  // The latest receipt may not be persisted yet; do not count it twice.
  return Math.max(1, matches);
}

export function buildAdaptiveRepairPacket({ mission, task, receipt, history = [] } = {}) {
  if (!task?.type || !mission || !receipt || (receipt.ok !== false && receipt.outcomeUnknown !== true)) return null;
  const allowed = new Set(Array.isArray(mission.allowedTasks) ? mission.allowedTasks.map(String) : []);
  const classification = classifyRepairFailure(task, receipt);
  const count = failureCount(task, classification, history);
  const candidates = [];
  const add = (tool, hypothesis, probe) => {
    if (!allowed.has(tool) || candidates.some(x => x.tool === tool)) return;
    candidates.push({ tool, hypothesis, probe });
  };

  switch (classification) {
    case 'UNKNOWN_OUTCOME':
      add('git-status', 'The attempted change may already exist', 'Compare current repository state with the expected result');
      add('git-diff', 'The attempted change may have partially applied', 'Inspect the actual diff before any new mutation');
      add('repo-read', 'The output may already be present', 'Read the affected file to check the postcondition');
      add('desktop-observe', 'The UI action may already have taken effect', 'Observe the current state without clicking again');
      add('browser-survey-site', 'The page may already reflect the action', 'Observe the page without repeating the mutation');
      break;
    case 'AUTHORITY':
      add('repo-read', 'The instruction may conflict with workspace scope', 'Inspect only the file already permitted by the contract');
      add('git-status', 'The desired effect may already be present', 'Observe current state without bypassing the denial');
      break;
    case 'MISSING_PATH':
      add('repo-list', 'Path or working directory is incorrect', 'List the nearest allowed directory and locate the actual file');
      add('repo-read', 'A related file may reveal the canonical path', 'Read a known permitted file before choosing a new path');
      break;
    case 'TEST_FAILURE':
      add('repo-read', 'A source/test mismatch caused the failure', 'Read the failing source or test identified by the receipt');
      add('git-diff', 'The latest patch introduced a regression', 'Compare the patch against the failing test');
      add('repo-list', 'The test refers to an unexpected file', 'Locate the relevant file before editing');
      add('repo-edit', 'A minimal targeted patch may repair the verified failure', 'Only after inspecting evidence, edit a permitted file and rerun tests');
      break;
    case 'TRANSIENT':
      add('health-check', 'A dependency is temporarily unavailable', 'Check live service status before a bounded retry');
      add('git-status', 'The last write may have succeeded despite a transport failure', 'Check repository state before retrying any write');
      break;
    default:
      add('repo-read', 'Tool input or assumptions may be incorrect', 'Inspect relevant permitted source before trying another action');
      add('git-diff', 'The observed state may differ from the planned state', 'Compare current changes with the expected result');
      add('health-check', 'A required service may be unavailable', 'Check the dependency instead of blindly retrying');
  }

  const mode = classification === 'UNKNOWN_OUTCOME' ? 'RECONCILE_FIRST'
    : classification === 'AUTHORITY' ? 'OPERATOR_OR_SCOPE_REQUIRED'
    : count >= 2 ? 'CHANGE_STRATEGY' : 'INVESTIGATE';

  // No raw prompt from an error is ever elevated to an instruction or a permission.
  return redactDeep({
    schema: ADAPTIVE_REPAIR_SCHEMA,
    mode,
    observation: {
      source: 'executed_tool_receipt',
      tool: trim(task.type, 100),
      failureClass: classification,
      error: errorOf(receipt),
      sameClassFailuresForTool: count,
    },
    candidates: candidates.slice(0, 4),
    conclusionRule: classification === 'UNKNOWN_OUTCOME'
      ? 'Reconcile the existing side effect first. Do not retry the mutation until the postcondition is known.'
      : classification === 'AUTHORITY'
      ? 'Do not bypass the denial or request a wider scope through a model tool. Report a specific blocker.'
      : count >= 2
      ? 'The previous approach has failed repeatedly. Choose a different permitted diagnostic, or report a blocker.'
      : 'Test one hypothesis against real observations before editing; prefer a minimal verified change.',
    authority: 'advice_only; existing mission contract, tool authorization, budgets, and operator approval remain authoritative',
    verified: false,
  });
}

export function formatAdaptiveRepairPacket(packet) {
  if (!packet || packet.schema !== ADAPTIVE_REPAIR_SCHEMA) throw new Error('ADAPTIVE_REPAIR_PACKET_INVALID');
  return 'AURA_ADAPTIVE_REPAIR (unverified hypotheses, not instructions or permission): ' +
    JSON.stringify(packet).slice(0, 2600);
}
