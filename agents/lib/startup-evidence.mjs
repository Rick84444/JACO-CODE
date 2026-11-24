import fs from 'node:fs';
import path from 'node:path';

// A service's HTTP 200 is not proof that the canonical Windows startup
// completed its Chrome/Continuum attachment contract. The only acceptable
// READY state is a committed starter checkpoint with every required capability.
const STATES = new Set(['READY', 'DEGRADED', 'BLOCKED', 'STARTING']);
const BROWSER = new Set(['ATTACHED', 'FAILED', 'UNAVAILABLE', 'PENDING', 'NOT_REQUIRED']);

export function evaluateStartupEvidence(raw) {
  if (!raw || raw.schema !== 'jaco.local-startup/v1') {
    return { state: 'UNVERIFIED', phase: 'unknown', browserAttachment: 'UNVERIFIED', browserRequired: true, ok: false };
  }
  const state = STATES.has(raw.state) ? raw.state : 'UNVERIFIED';
  const browserAttachment = BROWSER.has(raw.browserAttachment) ? raw.browserAttachment : 'UNVERIFIED';
  // Legacy checkpoints do not encode whether CDP was enabled. Fail closed
  // rather than infer browser readiness from a listening Chrome/CDP port.
  const browserRequired = raw.expected?.browserAttachment !== false;
  const validBrowser = !browserRequired || browserAttachment === 'ATTACHED';
  // Phase is deliberately not free-form in the result because status may be
  // published through GitHub; provide only stable, non-sensitive labels.
  const phase = raw.phase === 'browser-attachment' || raw.phase === 'browser-degraded'
    ? 'browser-attachment'
    : raw.phase === 'preflight' || raw.phase === 'chrome' || raw.phase === 'chrome-degraded'
      ? 'preflight'
      : raw.phase === 'complete' ? 'complete' : 'other';
  const ok = state === 'READY' && validBrowser && phase === 'complete';
  return { state, phase, browserAttachment, browserRequired, ok };
}

// Where the starter may have written its checkpoint. local-stack.mjs writes it under its DATA root
// (`JACO_DATA_DIR` when set, otherwise the install root), while callers pass the root they derived
// themselves. On Windows nothing sets JACO_ROOT (install-activation.sh is the Linux/Termux installer),
// so system-control derived repoRoot from the ~/.local/bin wrapper and landed on $HOME: the checkpoint
// was never found and a fully started stack reported UNVERIFIED/DEGRADED. Look in every root the
// starter could legitimately have used, in the order most likely to be this installation's own.
export function startupEvidenceRoots(root, env = process.env, cwd = process.cwd()) {
  const candidates = [root, env.JACO_DATA_DIR, env.JACO_INSTALL_ROOT, env.JACO_REPO_ROOT, env.JACO_ROOT, cwd];
  return [...new Set(candidates
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => path.resolve(value)))];
}

export function readStartupEvidence(root, { fileSystem = fs, env = process.env, cwd = process.cwd() } = {}) {
  for (const base of startupEvidenceRoots(root, env, cwd)) {
    try {
      const raw = JSON.parse(fileSystem.readFileSync(path.join(base, 'logs', 'startup', 'status.json'), 'utf8'));
      // Only the canonical checkpoint counts. Anything else leaves the search running and, if nothing
      // canonical exists anywhere, the result stays UNVERIFIED: this never infers readiness from a path.
      if (raw?.schema === 'jaco.local-startup/v1') return evaluateStartupEvidence(raw);
    } catch { /* not this root; try the next */ }
  }
  return evaluateStartupEvidence(null);
}

export function reconcileStartupActivation(report, evidence) {
  const startup = evidence || evaluateStartupEvidence(null);
  const problems = Array.isArray(report?.problems) ? [...report.problems] : [];
  if (!startup.ok) {
    problems.push('Windows startup is not fully READY (phase=' + startup.phase +
      ', browserAttachment=' + startup.browserAttachment + ').');
  }
  return { ...report, startup, problems, ok: report?.ok === true && startup.ok };
}
