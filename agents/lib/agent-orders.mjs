// Agent purchases of the repo scan, paid with Skyfire (operator 2026-10-02: sell to agents).
// The public gateway is the only writer of the order file: it accepts purchases and, after Nova has
// delivered the report, charges the buyer's token. Charging after delivery means a failed scan costs
// the buyer nothing.
import fs from 'node:fs';
import path from 'node:path';
import { parseRepoUrl, reportDir } from './repo-scan.mjs';
import { verifyPayToken, chargeToken, repoScanPriceUsd } from './skyfire-seller.mjs';
import { verifyAndSettle, orderIdFor, x402Configured, paymentRequirements } from './x402-seller.mjs';
import { orderMissionGoal } from '../repo-scan-orders.mjs';

export const stateFile = (env = process.env) => path.join(reportDir(env), 'skyfire-orders.json');
export function loadState(env = process.env) { try { return JSON.parse(fs.readFileSync(stateFile(env), 'utf8')); } catch { return {}; } }
export function saveState(state, env = process.env) {
  fs.mkdirSync(path.dirname(stateFile(env)), { recursive: true });
  fs.writeFileSync(stateFile(env), JSON.stringify(state, null, 2));
}

export function offer(env = process.env) {
  const base = String(env.JACO_GATEWAY_PUBLIC_URL || '').replace(/\/+$/, '');
  return {
    service: 'jaco-repo-security-scan',
    description: 'Security scan of a public GitHub repository: exposed credentials in current files (masked) and dependencies with published vulnerabilities (OSV.dev). Deterministic; returns an HTML and JSON report.',
    price: { amount: repoScanPriceUsd(env), currency: 'USD', charged: 'skyfire: after delivery; x402: settled when the order is accepted' },
    payment: [
      { method: 'x402', header: 'PAYMENT-SIGNATURE', network: 'eip155:8453', asset: 'USDC', configured: x402Configured(env), requirements: x402Configured(env) ? paymentRequirements(env) : null },
      { method: 'skyfire', header: 'kyapay-token', sellerServiceId: env.SKYFIRE_SELLER_SERVICE_ID || null, configured: Boolean(env.SKYFIRE_SELLER_SERVICE_ID && env.SKYFIRE_API_KEY) },
    ],
    request: { method: 'POST', url: `${base}/v1/repo-scan`, body: { repo: 'https://github.com/<owner>/<repo>' } },
    status: `${base}/v1/repo-scan/<order>`,
    terms: `${base}/terms`,
  };
}

// Terms of service for the repo scan, served at /terms (Skyfire lists a seller service's terms URL;
// operator 2026-10-03). Every statement describes what the code actually does.
export function termsHtml(env = process.env) {
  const price = repoScanPriceUsd(env);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Terms of Service · JACO Repo Security Scan</title>
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;color:#1d2433}h1{font-size:1.6em}h2{font-size:1.15em;margin-top:1.6em}code{background:#f1f3f6;padding:1px 4px;border-radius:3px}</style></head><body>
<h1>Terms of Service: JACO Repo Security Scan</h1>
<p>Provided by JACO (seller "JACO Nexus" on Skyfire). Effective 2026-10-03.</p>
<h2>1. The service</h2>
<p>For one public GitHub repository URL per order, the service makes a shallow clone of the default branch and produces a report of (a) strings in the current files that match common credential patterns, shown masked, and (b) pinned dependency versions in <code>package-lock.json</code> and <code>requirements.txt</code> that have published advisories in the OSV.dev database. The scan is automated and deterministic. Repositories over 300 MB are refused; files over 1 MB are skipped.</p>
<h2>2. What it is not</h2>
<p>It is not a penetration test, a code review or a guarantee that a repository is secure. Absence of findings does not mean absence of vulnerabilities. Credentials removed in earlier commits and dependencies without a pinned version are not analysed. The report is provided as is, without warranty of any kind.</p>
<h2>3. Price and payment</h2>
<p>${price} USD per scan. Skyfire: your pay or kya-pay token is charged only after the report has been delivered; a scan that fails is not charged. x402 (USDC on Base): the payment is settled through Coinbase's facilitator when the order is accepted; if the scan then cannot be delivered, the order is kept and reviewed by the operator for a refund or a rerun.</p>
<h2>4. Your data</h2>
<p>Only public repositories can be scanned; no access tokens are requested or used. The clone is deleted when the scan finishes. The report (with credentials masked) is stored on the service and is available to anyone who has the order's report URL, which is unguessable; share it accordingly. Request metadata (time, path, user agent, country) is logged for operation and abuse prevention.</p>
<h2>5. Acceptable use</h2>
<p>Scan repositories you own or are allowed to assess. Do not use the service to harvest credentials from third parties. Orders that appear abusive may be refused.</p>
<h2>6. Liability</h2>
<p>To the extent permitted by law, liability is limited to the price paid for the order concerned.</p>
<h2>7. Changes</h2>
<p>These terms may change; the version in force when an order is accepted applies to that order.</p>
</body></html>`;
}

// OpenAPI description for registering the Skyfire seller service (type API needs an openApiSpecUrl).
export function openApi(env = process.env) {
  const base = String(env.JACO_GATEWAY_PUBLIC_URL || '').replace(/\/+$/, '');
  const o = offer(env);
  return {
    openapi: '3.1.0',
    info: { title: 'JACO Repo Security Scan', version: '1.0.0', description: o.description, termsOfService: `${base}/terms` },
    servers: [{ url: base }],
    paths: {
      '/v1/repo-scan': {
        post: {
          summary: `Scan a public GitHub repository (${o.price.amount} USD, charged after delivery)`,
          parameters: [{ name: 'kyapay-token', in: 'header', required: true, schema: { type: 'string' }, description: 'Skyfire pay or kya-pay token for this seller service' }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['repo'], properties: { repo: { type: 'string', example: 'https://github.com/OWASP/NodeGoat' } } } } } },
          responses: { 202: { description: 'Accepted; poll statusUrl or open reportUrl' }, 400: { description: 'Invalid repository URL' }, 402: { description: 'Payment token missing or invalid' }, 409: { description: 'Token already used' } },
        },
      },
      '/v1/repo-scan/{order}': { get: { summary: 'Order status and JSON report', parameters: [{ name: 'order', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'running or delivered' }, 404: { description: 'Unknown order' } } } },
    },
  };
}

// x402 purchase: Coinbase's facilitator verifies and settles before the scan starts (see x402-seller.mjs).
export async function purchaseX402({ paymentHeader, repo, env = process.env, state, createMission, settle = verifyAndSettle, now = Date.now() }) {
  let parsed;
  try { parsed = parseRepoUrl(repo); } catch (e) { return { status: 400, body: { error: e.message } }; }
  const order = orderIdFor(paymentHeader);
  if (state[order]) return { status: 409, body: { error: 'PAYMENT_ALREADY_USED', order } };
  const paid = await settle(paymentHeader, { env });
  if (!paid.ok) return { status: 402, body: { error: paid.error, ...offer(env) } };
  const base = String(env.JACO_GATEWAY_PUBLIC_URL || '').replace(/\/+$/, '');
  let mission = null;
  try {
    mission = await createMission({ goal: orderMissionGoal(order, parsed.url), idempotencyKey: order, allowedTasks: ['repo-scan'], source: 'x402-order' });
    state[order] = { status: 'PAID', via: 'x402', missionId: mission?.id || null, repo: parsed.url, payer: paid.payer, transaction: paid.settlement?.transaction || null, amountUsd: repoScanPriceUsd(env), at: new Date(now).toISOString() };
  } catch (e) {
    // Paid but not started: never silently lost; the operator refunds or restarts it.
    state[order] = { status: 'PAID_NEEDS_OPERATOR', via: 'x402', repo: parsed.url, payer: paid.payer, transaction: paid.settlement?.transaction || null, error: String(e.message), at: new Date(now).toISOString() };
    return { status: 500, body: { error: 'PAID_BUT_NOT_STARTED', order, transaction: paid.settlement?.transaction || null } };
  }
  return { status: 202, settlement: paid.settlement, body: { order, status: 'accepted', reportUrl: `${base}/scan/${order}`, statusUrl: `${base}/v1/repo-scan/${order}`, transaction: paid.settlement?.transaction || null } };
}

export async function purchase({ token, repo, env = process.env, state, createMission, fetchImpl = fetch, now = Date.now() }) {
  if (!token) return { status: 402, body: { error: 'PAYMENT_REQUIRED', ...offer(env) } };
  let parsed;
  try { parsed = parseRepoUrl(repo); } catch (e) { return { status: 400, body: { error: e.message } }; }
  let verified;
  try { verified = await verifyPayToken(token, { env, fetchImpl, now }); } catch (e) { return { status: 402, body: { error: e.message, ...offer(env) } }; }
  const order = verified.orderId;
  if (state[order]) return { status: 409, body: { error: 'TOKEN_ALREADY_USED', order, statusUrl: offer(env).status.replace('<order>', order) } };
  const mission = await createMission({ goal: orderMissionGoal(order, parsed.url), idempotencyKey: order, allowedTasks: ['repo-scan'], source: 'skyfire-order' });
  state[order] = { status: 'MISSION_CREATED', missionId: mission?.id || null, repo: parsed.url, token, amountUsd: repoScanPriceUsd(env), buyer: verified.claims.sub || null, at: new Date(now).toISOString() };
  const base = String(env.JACO_GATEWAY_PUBLIC_URL || '').replace(/\/+$/, '');
  return { status: 202, body: { order, status: 'accepted', reportUrl: `${base}/scan/${order}`, statusUrl: `${base}/v1/repo-scan/${order}`, charge: `${repoScanPriceUsd(env)} USD after delivery` } };
}

export function orderStatus(order, { env = process.env, state }) {
  const s = state[order];
  if (!s) return { status: 404, body: { error: 'NOT_FOUND' } };
  const json = path.join(reportDir(env), `${order}.json`);
  const base = String(env.JACO_GATEWAY_PUBLIC_URL || '').replace(/\/+$/, '');
  if (!fs.existsSync(json)) return { status: 200, body: { order, status: 'running', reportUrl: `${base}/scan/${order}` } };
  const report = JSON.parse(fs.readFileSync(json, 'utf8'));
  return { status: 200, body: { order, status: 'delivered', charge: s.status, reportUrl: `${base}/scan/${order}`, report } };
}

// Charges every delivered, uncharged order once. A failed charge is recorded, not retried blindly.
export async function chargeDelivered({ env = process.env, state, charge = chargeToken }) {
  const out = [];
  for (const [order, s] of Object.entries(state)) {
    if (s.status !== 'MISSION_CREATED') continue;
    if (!fs.existsSync(path.join(reportDir(env), `${order}.html`))) continue;
    const r = await charge(s.token, s.amountUsd, { env });
    Object.assign(s, r.ok ? { status: 'CHARGED', amountCharged: r.amountCharged, chargedAt: new Date().toISOString() } : { status: 'CHARGE_FAILED', chargeError: r.error, chargedAt: new Date().toISOString() });
    delete s.token; // no longer needed once used
    out.push({ order, status: s.status });
  }
  return out;
}
