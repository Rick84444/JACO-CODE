import { redactText } from './secret-capture.mjs';

// Replay eligibility is narrower than approval eligibility or read-only receipt
// verification. Unknown outcomes must be reconciled before any external write
// may execute again. No tool/model response can grant itself replay permission.
const SAFE_AUTO_REPLAY_TASKS = new Set([
  'detect-surfaces', 'health-check', 'check-revenue', 'browser-survey-site',
  'web-fetch', 'desktop-windows', 'desktop-observe', 'android-status',
  'android-observe', 'windows-wmi-read', 'screenshot', 'get-cursor',
  'repo-list', 'repo-read', 'git-status', 'git-diff', 'repo-test', 'skill-load',
]);

export function mayAutoReplayTask(type) {
  return typeof type === 'string' && SAFE_AUTO_REPLAY_TASKS.has(type);
}

// An exception after starting a side-effecting action is not proof of failure:
// the effect can complete even when the response is lost. Only replay-safe
// tools may return a known error and be retried without operator reconciliation.
export function executionExceptionResult(task, error) {
  const message = redactText(String(error?.message || error || 'TOOL_EXECUTION_THROWN').split('\n')[0]).text;
  return { ok: false, verified: false, error: message.slice(0, 400),
    outcomeUnknown: !mayAutoReplayTask(task?.type) };
}
