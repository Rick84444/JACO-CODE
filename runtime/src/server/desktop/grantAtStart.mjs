// Operator standing instruction (2026-11-21, repeated): Aura's tools are ON when JACO activates, and the
// operator switches off what they do not want. Before this, every activation left the desktop and browser
// hands-off grants disabled, so Aura could read the machine but never act on it until someone opened the UI.
//
// This renews the operator's standing grant at activation. It does NOT widen what a grant may contain: every
// value still goes through the surface's own configureGrant, so the permanently blocked credential and logon
// processes stay blocked, process and origin names are still validated, and the 8-hour ceiling still applies.
// It automates a decision the operator already made; it does not make a new one.

export const GRANT_AT_START_SCHEMA = 'jaco.grant-at-start/v1';
// The ceiling the surfaces enforce. Renewing at each activation is what keeps the grant alive, never a longer one.
export const MAX_GRANT_MS = 8 * 60 * 60_000;

const flagOff = value => String(value ?? '').trim() === '0';
const list = value => String(value ?? '')
  .split(',').map(item => item.trim()).filter(Boolean).slice(0, 10);

// Applications Aura drives on a developer's desktop. Credential managers and logon surfaces are not here and
// could not be granted anyway: the surface rejects them by name whatever this list says.
export const DEFAULT_DESKTOP_PROCESSES = Object.freeze(['chrome', 'msedge', 'explorer', 'code', 'notepad']);

/** What the operator's environment asks for, or null when they switched the surface off. */
export function desktopGrantRequest(env = process.env, now = Date.now()) {
  if (flagOff(env.JACO_DESKTOP_GRANT_AT_START)) return null;
  const processes = list(env.JACO_DESKTOP_GRANT_PROCESSES);
  return {
    enabled: true,
    allowed_processes: processes.length ? processes : [...DEFAULT_DESKTOP_PROCESSES],
    allow_invoke: true,
    // Typing into a field is how text reaches a password box or a payment form, so it stays an explicit choice.
    allow_value_set: env.JACO_DESKTOP_GRANT_VALUE_SET === '1',
    allow_toggle: true,
    allow_select: true,
    allow_scroll: true,
    expires_at: new Date(now + MAX_GRANT_MS).toISOString(),
  };
}

/** The browser surface only acts on origins the operator already listed; with none listed there is nothing to grant. */
export function browserGrantRequest(env = process.env, now = Date.now()) {
  if (flagOff(env.JACO_BROWSER_GRANT_AT_START)) return null;
  const origins = list(env.JACO_BROWSER_ALLOWED_ORIGINS);
  if (!origins.length) return null;
  return {
    enabled: true,
    scope_mode: 'allowlist',
    allowed_origins: origins,
    allow_click: true,
    allow_value_set: env.JACO_BROWSER_GRANT_VALUE_SET === '1',
    allow_navigate: true,
    allow_select: true,
    allow_scroll: true,
    expires_at: new Date(now + MAX_GRANT_MS).toISOString(),
  };
}

/**
 * Renew both standing grants. A surface that refuses is reported and never retried into a weaker request:
 * a refusal is the contract working, not something to negotiate around.
 * @param {{desktop?: any, browser?: any, env?: any, now?: number, log?: (level: string, message: string) => void}} input
 */
export function renewStandingGrants({ desktop = null, browser = null, env = process.env, now = Date.now(), log = () => {} } = {}) {
  const applied = [];
  for (const [surface, client, request] of [
    ['desktop', desktop, desktopGrantRequest(env, now)],
    ['browser', browser, browserGrantRequest(env, now)],
  ]) {
    if (!client || typeof client.configureGrant !== 'function') continue;
    if (!request) { applied.push({ surface, state: 'OFF_BY_OPERATOR' }); continue; }
    // A surface this host does not support is not an error worth shouting about.
    if (typeof client.isSupported === 'function' && !client.isSupported()) {
      applied.push({ surface, state: 'UNSUPPORTED' });
      continue;
    }
    try {
      const grant = client.configureGrant(request);
      applied.push({ surface, state: 'ACTIVE', expiresAt: grant?.expires_at || null });
      log('info', `${surface} hands-off grant renewed at activation until ${grant?.expires_at}`);
    } catch (error) {
      const reason = String(error?.message || error).slice(0, 200);
      applied.push({ surface, state: 'REFUSED', reason });
      log('warn', `${surface} hands-off grant refused at activation: ${reason}`);
    }
  }
  return { schema: GRANT_AT_START_SCHEMA, applied };
}
