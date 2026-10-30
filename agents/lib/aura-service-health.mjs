// Truthful read-only Aura service probes. These probes never start processes or disclose tokens.
// "Reachable" does not mean a tool/model completed a real task.
const DEFAULT_PORTS = Object.freeze({
  workplace: 2995, seer: 2997, substrate: 3000, novaBridge: 4243,
  gateway: 4250, cdpBridge: 2996, chromeCdp: 9222, ollama: 11434,
});
const PORT_ENV = Object.freeze({
  workplace: 'JACO_WORKPLACE_PORT', seer: 'SEER_PORT', substrate: 'PORT',
  novaBridge: 'NOVA_BRIDGE_PORT', gateway: 'JACO_GATEWAY_PORT',
  cdpBridge: 'JACO_CDP_BRIDGE_PORT', chromeCdp: 'CDP_PORT',
});
const pathFor = name => name === 'chromeCdp' ? '/json/version' : name === 'ollama' ? '/api/tags' : '/health';

function portOf(name, env) {
  const raw = name === 'ollama' ? null : env[PORT_ENV[name]];
  const n = Number(raw || DEFAULT_PORTS[name]);
  return Number.isSafeInteger(n) && n > 0 && n <= 65535 ? n : DEFAULT_PORTS[name];
}

export function serviceUnavailableLabel(name, env = {}, platform = process.platform) {
  if (['cdpBridge','novaBridge'].includes(name) && env.JACO_AURA_LEAN === '1') return 'DISABLED (AURA_LEAN)';
  if (['chromeCdp', 'cdpBridge', 'novaBridge'].includes(name) && env.JACO_ENABLE_CDP === '0') return 'DISABLED (CDP_POLICY)';
  if (name === 'ollama' && env.JACO_ENABLE_OLLAMA === '0') return 'DISABLED (MODEL_POLICY)';
  // Termux's canonical jacoctl does not start the optional ChatGPT gateway.
  if (name === 'gateway' && (platform === 'android' || String(env.PREFIX || '').includes('/com.termux/'))
    && env.JACO_ENABLE_CHATGPT_GATEWAY !== '1') return 'NOT_SUPERVISED (TERMUX)';
  if (name === 'chromeCdp') return 'NOT_CONNECTED (BROWSER_DEBUG_PORT)';
  return 'DOWN';
}

export async function readAuraServiceHealth({ env = process.env, platform = process.platform, fetchImpl = fetch } = {}) {
  const result = {};
  await Promise.all(Object.keys(DEFAULT_PORTS).map(async name => {
    const token = name === 'novaBridge' ? String(env.JACO_GATEWAY_TOKEN || env.GATEWAY_TOKEN || '') : '';
    const url = `http://127.0.0.1:${portOf(name, env)}${pathFor(name)}`;
    try {
      const response = await fetchImpl(url, {
        ...(token.length >= 24 ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        signal: AbortSignal.timeout(1500),
      });
      if (response.status === 401 || response.status === 403) {
        result[name] = `AUTH_REQUIRED (${response.status})`;
        return;
      }
      if (!response.ok) {
        result[name] = `UNHEALTHY (${response.status})`;
        return;
      }
      let body = null;
      try { body = await response.json(); } catch { /* Response without JSON proves only HTTP reachability. */ }
      // A historical MCP facade returned HTTP 200, ok:true while Chrome was
      // absent. Browser bridges now require a recent WebSocket attestation.
      if (name === 'novaBridge' || name === 'cdpBridge') {
        const age = body?.verificationAgeMs;
        const receiptFresh = Number.isFinite(age) && age >= 0 && age <= 4000
          && typeof body?.verifiedAt === 'string' && Number.isFinite(Date.parse(body.verifiedAt))
          && Math.abs(Date.now() - Date.parse(body.verifiedAt) - age) < 5000;
        result[name] = body?.ok === true && body?.browserVerified === true &&
          body?.state === 'READY' && receiptFresh ? `READY (${response.status})`
          : body?.ok === false ? `UNHEALTHY (${response.status})`
          : `UNVERIFIED (${response.status})`;
        return;
      }
      // Discovery proves only a DevTools HTTP endpoint, not a live CDP socket.
      if (name === 'chromeCdp') {
        result[name] = typeof body?.webSocketDebuggerUrl === 'string'
          ? `DISCOVERABLE (${response.status})` : `UNVERIFIED (${response.status})`;
        return;
      }
      if (body?.ok === false || body?.success === false || ['DOWN', 'ERROR', 'FAILED'].includes(body?.status)) {
        result[name] = `UNHEALTHY (${response.status})`;
        return;
      }
      result[name] = body?.ok === true || body?.success === true || body?.status === 'READY'
        ? `READY (${response.status})` : `REACHABLE (${response.status})`;
    } catch {
      result[name] = serviceUnavailableLabel(name, env, platform);
    }
  }));
  return result;
}
