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

export function readStartupEvidence(root, { fileSystem = fs } = {}) {
  try {
    const content = fileSystem.readFileSync(path.join(root, 'logs', 'startup', 'status.json'), 'utf8');
    return evaluateStartupEvidence(JSON.parse(content));
  } catch {
    return evaluateStartupEvidence(null);
  }
}
