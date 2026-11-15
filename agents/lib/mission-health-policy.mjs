// Health is not approval. Only temporary failures can defer a mission automatically.
// A selected provider remains selected; this does not switch to a paid or unapproved model.
const TRANSIENT_MODEL = /(?:^|[:|])(?:PROVIDER_TIMEOUT|PROVIDER_NOT_READY|PROVIDER_UNREACHABLE|REQUEST_TIMEOUT|TIMEOUT|RATE_LIMIT(?:ED)?|HTTP_429|HTTP_50[02347]|429|50[02347]|SERVICE_UNAVAILABLE|NETWORK_ERROR|FETCH_FAILED|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND)(?=[:|]|$)/i;
const SECURITY_OR_CONFIGURATION = /(?:AUTH|UNAUTHORIZED|FORBIDDEN|INVALID_KEY|BAD_API_KEY|MODEL_NOT_FOUND|SELECTION_REQUIRED|COST_LIMIT|BUDGET|POLICY|PERMISSION|APPROVAL|OUTCOME_UNKNOWN)/i;
export function isTransientModelFailure(message) {
  const value = String(message || '').slice(0, 500);
  return value.startsWith('AURA_SELECTED_MODEL_UNAVAILABLE:') &&
    TRANSIENT_MODEL.test(value) && !SECURITY_OR_CONFIGURATION.test(value);
}

// A health failure can justify refreshing the currently granted tool catalog,
// never replaying an action whose side effect is unknown.
export function isRecoverableToolHealthError(message) {
  const value = String(message || '').slice(0, 500);
  return /(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|TIMEOUT|SERVICE_NOT_READY|SERVICE_UNAVAILABLE|BRIDGE_UNAVAILABLE|HTTP_50[02347]|MCP_SERVER_UNAVAILABLE)/i.test(value) &&
    !SECURITY_OR_CONFIGURATION.test(value);
}

// Preflight is observation, not authorization: retry only transport outages.
// Identity, access, missing repository and policy failures remain hard blockers.
export function isTransientPreflightBlockers(blockers) {
  return Array.isArray(blockers) && blockers.length > 0 &&
    blockers.every(code => code === 'RUNTIME_PREFLIGHT_UNAVAILABLE' || code === 'BROWSER_BRIDGE_UNAVAILABLE');
}
