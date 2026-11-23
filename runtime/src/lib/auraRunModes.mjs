// One model-independent contract for JACO's conversation composer.
// A UI selection is never an authorization grant. Runtime policy remains authoritative.
export const AURA_RUN_MODES = Object.freeze({
  manual: Object.freeze({
    id: 'manual',
    interactionMode: 'question',
    createsMission: false,
    scope: 'read-only conversation and current-work inspection',
  }),
  planning: Object.freeze({
    id: 'planning',
    interactionMode: 'planning',
    createsMission: false,
    scope: 'read-only research and planning, without policy changes or executable goals',
  }),
  autonomous: Object.freeze({
    id: 'autonomous',
    // Operator 2026-11-19: in Full Autonomous Aura acts in the conversation too (browser, local tools, missions).
    // Her mandate, the operator-action guard (publish, send, pay, sign in, secrets) and budgets still decide.
    interactionMode: 'action',
    executionMode: 'autonomous',
    createsMission: true,
    scope: 'durable mission via the canonical Aura runtime under existing budgets, approvals and tools',
  }),
});

export function knownAuraRunMode(value) {
  return typeof value === 'string' && Object.hasOwn(AURA_RUN_MODES, value);
}
// The operator UI has one active workflow. Retain read-only API modes for
// integrations and explicit internal inspection; a default never grants authority.
export function initialAuraRunMode() {
  return 'autonomous';
}
export function normalizeAuraRunMode(value) {
  if (!knownAuraRunMode(value)) throw new Error('AURA_RUN_MODE_UNKNOWN');
  return AURA_RUN_MODES[value];
}
export function normalizeAuraChatMode(value) {
  if (value === 'question' || value === 'planning') return value;
  if (value == null || value === 'action') return 'action'; // preserve existing API clients
  throw new Error('AURA_CHAT_MODE_UNKNOWN');
}
export function normalizeAuraMissionMode(value) {
  // Existing clients without the new field continue through identical canonical contracts.
  if (value == null) return 'legacy';
  if (value === 'autonomous') return 'autonomous';
  throw new Error('AURA_MISSION_MODE_INVALID');
}
