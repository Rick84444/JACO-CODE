// Skyfire seller side: agents pay for the repo scan with a Skyfire KYAPay token (operator 2026-10-02:
// sell to agents). The buyer sends the token in the kyapay-token header (older clients: skyfire-pay-id).
// It is verified locally against Skyfire's JWKS (ES256), and charged with the seller key only after the
// report is delivered, as Skyfire's seller flow prescribes. No new dependency: node:crypto verifies ES256.
// Docs: docs.skyfire.xyz (verify-and-extract-data-from-tokens, reference/charge-token).
import crypto from 'node:crypto';

export const SKYFIRE = {
  production: { issuer: 'https://app.skyfire.xyz', jwks: 'https://app.skyfire.xyz/.well-known/jwks.json' },
  sandbox: { issuer: 'https://app-sandbox.skyfire.xyz', jwks: 'https://app-sandbox.skyfire.xyz/.well-known/jwks.json' },
};
const API = 'https://api.skyfire.xyz';
const PAY_TYPES = new Set(['pay+jwt', 'kya-pay+jwt']);

export function skyfireEnv(env = process.env) { return env.SKYFIRE_ENV === 'sandbox' ? 'sandbox' : 'production'; }
export function repoScanPriceUsd(env = process.env) {
  const v = Number(env.SKYFIRE_REPO_SCAN_PRICE_USD ?? 9);
  return Number.isFinite(v) && v > 0 ? v : 9;
}

const b64url = s => Buffer.from(s, 'base64url');
let jwksCache = { at: 0, url: '', keys: [] };
export async function fetchJwks(url, fetchImpl = fetch, now = Date.now()) {
  if (jwksCache.url === url && now - jwksCache.at < 60 * 60_000) return jwksCache.keys;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`SKYFIRE_JWKS_${res.status}`);
  const keys = (await res.json()).keys || [];
  jwksCache = { at: now, url, keys };
  return keys;
}
export function resetJwksCache() { jwksCache = { at: 0, url: '', keys: [] }; }

// Verifies signature and the claims the seller must check; returns { claims, amountUsd, orderId }.
export async function verifyPayToken(token, { env = process.env, fetchImpl = fetch, now = Date.now(), minUsd = repoScanPriceUsd(env) } = {}) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('SKYFIRE_TOKEN_MALFORMED');
  let header, claims;
  try { header = JSON.parse(b64url(parts[0])); claims = JSON.parse(b64url(parts[1])); } catch { throw new Error('SKYFIRE_TOKEN_MALFORMED'); }
  if (header.alg !== 'ES256') throw new Error('SKYFIRE_TOKEN_ALG');
  if (!PAY_TYPES.has(header.typ)) throw new Error(`SKYFIRE_TOKEN_TYPE:${header.typ}`);
  const target = SKYFIRE[skyfireEnv(env)];
  const keys = await fetchJwks(target.jwks, fetchImpl, now);
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('SKYFIRE_TOKEN_UNKNOWN_KEY');
  const ok = crypto.verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key: crypto.createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, b64url(parts[2]));
  if (!ok) throw new Error('SKYFIRE_TOKEN_SIGNATURE');
  const sec = Math.floor(now / 1000);
  if (claims.iss !== target.issuer) throw new Error('SKYFIRE_TOKEN_ISSUER');
  if (claims.env && claims.env !== skyfireEnv(env)) throw new Error('SKYFIRE_TOKEN_ENV');
  if (!Number.isInteger(claims.exp) || claims.exp <= sec) throw new Error('SKYFIRE_TOKEN_EXPIRED');
  if (Number.isInteger(claims.iat) && claims.iat > sec + 60) throw new Error('SKYFIRE_TOKEN_IAT');
  // The token must be issued for this seller service (and seller account, when configured).
  if (!env.SKYFIRE_SELLER_SERVICE_ID) throw new Error('SKYFIRE_SELLER_NOT_CONFIGURED');
  if (claims.ssi !== env.SKYFIRE_SELLER_SERVICE_ID) throw new Error('SKYFIRE_TOKEN_WRONG_SERVICE');
  if (env.SKYFIRE_SELLER_ACCOUNT_ID && claims.aud !== env.SKYFIRE_SELLER_ACCOUNT_ID) throw new Error('SKYFIRE_TOKEN_WRONG_SELLER');
  const cur = String(claims.cur || 'USD').toUpperCase();
  if (cur !== 'USD') throw new Error('SKYFIRE_TOKEN_CURRENCY');
  const amountUsd = Number(claims.amount ?? claims.amt ?? claims.value ?? claims.val);
  if (!(amountUsd >= minUsd)) throw new Error(`SKYFIRE_TOKEN_AMOUNT: ${amountUsd} < ${minUsd} USD`);
  if (!/^[A-Za-z0-9-]{8,200}$/.test(String(claims.jti || ''))) throw new Error('SKYFIRE_TOKEN_JTI');
  return { claims, amountUsd, orderId: `sky_${claims.jti}` };
}

export async function chargeToken(token, amountUsd, { env = process.env, fetchImpl = fetch } = {}) {
  const key = env.SKYFIRE_API_KEY;
  if (!key) return { ok: false, error: 'SKYFIRE_API_KEY_MISSING' };
  const res = await fetchImpl(`${API}/api/v1/tokens/charge`, {
    method: 'POST', headers: { 'skyfire-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, chargeAmount: String(amountUsd) }), signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, status: res.status, error: String(body?.message || body?.code || `HTTP_${res.status}`).slice(0, 200) };
  return { ok: true, amountCharged: body?.amountCharged ?? null, remainingBalance: body?.remainingBalance ?? null };
}

// Updating a Skyfire service deactivates it until Skyfire's team approves it, and only an approved
// service can be activated (2026-10-03). The gateway checks this periodically and activates the
// service once it is approved, so nobody has to watch for the approval.
export async function ensureServiceActive({ env = process.env, fetchImpl = fetch } = {}) {
  const key = env.SKYFIRE_API_KEY, id = env.SKYFIRE_SELLER_SERVICE_ID;
  if (!key || !id) return { state: 'NOT_CONFIGURED' };
  const headers = { 'skyfire-api-key': key };
  const res = await fetchImpl(`${API}/api/v1/agents/seller-services`, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return { state: 'ERROR', error: `HTTP_${res.status}` };
  const body = await res.json().catch(() => null);
  const service = (Array.isArray(body) ? body : body?.data || []).find(s => s.id === id);
  if (!service) return { state: 'NOT_FOUND' };
  if (service.active) return { state: 'ACTIVE', approved: Boolean(service.approved) };
  if (!service.approved) return { state: 'AWAITING_APPROVAL' };
  const act = await fetchImpl(`${API}/api/v1/agents/seller-services/${encodeURIComponent(id)}/activate`, { method: 'POST', headers, signal: AbortSignal.timeout(20_000) });
  return act.ok ? { state: 'ACTIVATED' } : { state: 'ERROR', error: `ACTIVATE_HTTP_${act.status}` };
}
