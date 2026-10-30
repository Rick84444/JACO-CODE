// Aura control plane: deterministic, read-only, sanitised projection.
// Sources may be down; never translate "listener exists" into work verified.
const NAMES = Object.freeze(['substrate','workplace','seer','novaBridge','cdpBridge','chromeCdp','gateway','ollama']);
const STATUS = /^(?:READY|REACHABLE|DISCOVERABLE|UNVERIFIED|UNHEALTHY|AUTH_REQUIRED|DOWN|DISABLED|NOT_CONNECTED|NOT_SUPERVISED)(?: \([A-Z0-9_ :-]{1,48}\))?$/;

export function projectAuraOversight({
  serviceHealth = null, statusCounts = null, missions = null, truncated = false,
  now = new Date().toISOString(),
} = {}) {
  const observed = serviceHealth && typeof serviceHealth === 'object' && !Array.isArray(serviceHealth);
  const services = Object.fromEntries(NAMES.map(name => {
    const raw = observed ? serviceHealth[name] : null;
    return [name, typeof raw === 'string' && STATUS.test(raw) ? raw : 'UNOBSERVED'];
  }));
  const isReady = name => services[name] === 'READY (200)';
  const browser = services.cdpBridge.startsWith('DISABLED') && services.novaBridge.startsWith('DISABLED')
    ? 'DISABLED' : !observed ? 'UNOBSERVED'
      : isReady('cdpBridge') && isReady('novaBridge') && services.chromeCdp === 'DISCOVERABLE (200)'
        ? 'VERIFIED_RECENT' : 'BLOCKED';
  const counts = statusCounts && typeof statusCounts === 'object' ? statusCounts : null;
  const count = key => counts && Number.isSafeInteger(counts[key]) && counts[key] >= 0 ? counts[key] : null;
  const visible = Array.isArray(missions) ? missions : null;
  return {
    schema: 'jaco.aura-oversight/v1',
    observedAt: now,
    scope: 'read-only; one operator identity; independent technical service owners',
    services,
    browser: {
      state: browser,
      meaning: browser === 'VERIFIED_RECENT' ? 'Fresh WebSocket-evaluation + Workplace authority, not a completed browser mission'
        : browser === 'DISABLED' ? 'Aura Lean intentionally keeps CDP adapters stopped'
          : browser === 'UNOBSERVED' ? 'Service observation unavailable' : 'One or more CDP/Workplace gates are unverified',
    },
    missions: {
      active: count('ACTIVE'), blocked: count('BLOCKED'),
      awaitingVerification: count('AWAITING_VERIFICATION'),
      visibleUnknownOutcomes: visible
        ? visible.filter(m => m?.lastResult?.outcomeUnknown === true).length : null,
      visibleWindowTruncated: truncated === true,
    },
    runtimeConsolidated: false,
  };
}
