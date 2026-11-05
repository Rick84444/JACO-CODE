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
    return browserScope(env) === 'broad_web' ? true : allowedOrigins(env).has(u.origin);
  } catch { return false; }
}

/** Navigation, click, type and press are mutations; they are on in the Aura runtime unless switched off. */
export function mutationsEnabled(env = process.env) {
  if (env.JACO_GATEWAY_ALLOW_MUTATIONS === '0') return false;
  return env.JACO_GATEWAY_ALLOW_MUTATIONS === '1' || env.JACO_AURA_UNIFIED_RUNTIME === '1';
}
