// What the browser actuators may touch. One owner for the Nova bridge and the runtime's BrowserHandsOff, so the
// two cannot drift apart.
//
// Scope (JACO_BROWSER_SCOPE):
//   broad_web  any http(s) page, except the sign-in, payment and security surfaces below. The default in the Aura
//              runtime: the operator wants the agent to work on the web, and signs in by hand once.
//   origins    only JACO_BROWSER_ALLOWED_ORIGINS (the older, stricter behaviour). The default everywhere else.
// Whatever the scope, a password field and a secret typed as text are never driven by an agent.

/** Authentication, payment and security origins. Never granted. */
export const BLOCKED_ORIGIN_PATTERN =
  /(accounts\.google|login\.microsoftonline|appleid\.apple|okta\.com|auth0\.com|onelogin|duosecurity|bankid|swish|paypal\.com|checkout\.stripe)/i;

export const BLOCKED_PATH_PATTERN = /(wp-login\.php|\/login|\/signin|\/oauth|\/authorize|\/checkout|\/payment)/i;

/** Text that must be typed by a human, never driven into a field by an agent. */
export const SECRET_TEXT =
  /(password|lösenord|passcode|one.?time|otp|verification code|api.?key|secret|private.?key|seed phrase)/i;

/** Selectors that address a credential field, whatever the value being set. */
export const PASSWORD_TARGET = /(type=["']?password|#user_pass|\[name=["']?pwd|autocomplete=["']?current-password)/i;

// Loopback and private networks hold JACO itself (its GUI, its approvals) and the operator's other machines.
// In the broad-web scope they are not "the web": a local page needs an explicit origin or a mission's own contract.
export function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|\[::1?\]|\[(fe80|f[cd][0-9a-f]{2}):.*\])$/.test(h)) return true;
  // WHATWG URL canonically prints IPv4-mapped IPv6 as hex groups, for example
  // [::ffff:7f00:1] rather than [::ffff:127.0.0.1].
  const mapped = h.replace(/^\[|\]$/g, '').match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) {
    const first = parseInt(mapped[1], 16), second = parseInt(mapped[2], 16);
    return isPrivateHost(`${first >> 8}.${first & 255}.${second >> 8}.${second & 255}`);
  }
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]);
  return a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

export function browserScope(env = process.env) {
  const configured = String(env.JACO_BROWSER_SCOPE || '').toLowerCase();
  if (configured === 'broad_web' || configured === 'origins') return configured;
  return env.JACO_AURA_UNIFIED_RUNTIME === '1' ? 'broad_web' : 'origins';
}

export function allowedOrigins(env = process.env) {
  return new Set(String(env.JACO_BROWSER_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean));
}

/** Why a page is off limits whatever the scope, or null. */
export function hardDenied(url) {
  try {
    const u = new URL(url);
    if (BLOCKED_ORIGIN_PATTERN.test(u.hostname) || BLOCKED_PATH_PATTERN.test(u.pathname)) return 'AUTH_OR_PAYMENT_SURFACE';
    return null;
  } catch { return 'URL_INVALID'; }
}

/** May the agent click, type or press keys on this page? */
export function inputAllowed(url, env = process.env) {
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    if (hardDenied(url)) return false;
    return browserScope(env) === 'broad_web' ? !isPrivateHost(u.hostname) : allowedOrigins(env).has(u.origin);
  } catch { return false; }
}

/** Navigation, click, type and press are mutations; they are on in the Aura runtime unless switched off. */
export function mutationsEnabled(env = process.env) {
  if (env.JACO_GATEWAY_ALLOW_MUTATIONS === '0') return false;
  return env.JACO_GATEWAY_ALLOW_MUTATIONS === '1' || env.JACO_AURA_UNIFIED_RUNTIME === '1';
}
