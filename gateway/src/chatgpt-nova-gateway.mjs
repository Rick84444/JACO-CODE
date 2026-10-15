// JACO ChatGPT/Nova Gateway v1
// Public ingress facade for ChatGPT Actions / Plugins / generic HTTP clients.
// SECURITY: Nova itself remains bound to loopback. This gateway proxies only an explicit allow-list.

import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ORDER_ID, reportDir } from '../../agents/lib/repo-scan.mjs';
import { paymentRequired as x402PaymentRequired, encodeHeader as encodeX402Header, verifyAndSettle as verifyAndSettleX402 } from '../../agents/lib/x402-seller.mjs';
import { verifyAnswer, verifyOffer, verifyBazaar, validateVerifyRequest, freeQuota, VERIFY_PRICE_USD } from '../../agents/lib/verify-api.mjs';
import { verifySignature as verifyInboxSignature, storeMessage as storeInboxMessage } from '../../agents/lib/inbox.mjs';
import { checkX402, checkPageHtml as x402CheckPage } from '../../agents/lib/x402-check.mjs';
import { ensureServiceActive as ensureSkyfireServiceActive } from '../../agents/lib/skyfire-seller.mjs';
import { offer as agentOffer, openApi as repoScanOpenApi, termsHtml as repoScanTerms, purchaseX402 as agentPurchaseX402, purchase as agentPurchase, orderStatus as agentOrderStatus, chargeDelivered, loadState as loadOrderState, saveState as saveOrderState } from '../../agents/lib/agent-orders.mjs';

async function createOrderMission(input) {
  const res = await fetch(`${process.env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000'}/api/connected/nova/missions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, 'x-gateway-token': TOKEN },
    body: JSON.stringify(input), signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`RUNTIME_${res.status}`);
  return body.mission;
}
// The order file is read-modified-written only inside this queue, so a purchase and a charge never
// overwrite each other.
// The free x402 check calls Coinbase for each request: at most 10 checks per client address per hour.
const x402CheckStats = { count: 0 };
const verifyQuota = freeQuota();
const x402CheckHits = new Map();
const x402CheckAllowed = ip => { const now = Date.now(); const hits = (x402CheckHits.get(ip) || []).filter(t => now - t < 3600_000); if (hits.length >= 10) return false; hits.push(now); x402CheckHits.set(ip, hits); return true; };
const devicePairHits = new Map();
const devicePairAllowed = ip => { const now = Date.now(); const hits = (devicePairHits.get(ip) || []).filter(t => now - t < 3600_000); if (hits.length >= 10) return false; hits.push(now); devicePairHits.set(ip, hits); return true; };
let orderQueue = Promise.resolve();
const withOrders = fn => { const run = orderQueue.then(fn, fn); orderQueue = run.catch(() => {}); return run; };
// Charges Skyfire orders once their report is delivered; this process is the order file's only writer.
setInterval(() => withOrders(async () => {
  try {
    const state = loadOrderState();
    const charged = await chargeDelivered({ state });
    if (charged.length) { saveOrderState(state); for (const c of charged) console.log(`[skyfire] ${c.order.slice(0, 24)} ${c.status}`); }
  } catch (e) { console.error(`[skyfire] charge loop: ${e.message}`); }
}), 30_000).unref();

// Skyfire service: activated automatically once Skyfire approves it (agents/lib/skyfire-seller.mjs).
let skyfireServiceState = null;
const checkSkyfireService = async () => {
  try {
    const r = await ensureSkyfireServiceActive();
    if (r.state !== skyfireServiceState) console.log(`[skyfire] seller service ${r.state}${r.error ? ` ${r.error}` : ""}`);
    skyfireServiceState = r.state;
  } catch (e) { console.error(`[skyfire] service check: ${e.message}`); }
};
void checkSkyfireService();
setInterval(() => { void checkSkyfireService(); }, 10 * 60_000).unref();

const PORT = Number(process.env.JACO_GATEWAY_PORT || 4250);
const HOST = process.env.JACO_GATEWAY_HOST || '127.0.0.1';
const NOVA_BASE_URL = process.env.JACO_NOVA_URL || 'http://127.0.0.1:4243';
const SEER_BASE_URL = process.env.JACO_SEER_URL || 'http://127.0.0.1:2997';
const TOKEN = process.env.JACO_GATEWAY_TOKEN || '';
const ALLOW_MUTATIONS = process.env.JACO_GATEWAY_ALLOW_MUTATIONS === '1';
const ALLOWED_HOSTS = new Set(
  String(process.env.JACO_GATEWAY_ALLOWED_HOSTS || '')
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean)
);
const MAX_BODY_BYTES = Number(process.env.JACO_GATEWAY_MAX_BODY_BYTES || 65536);
const REQUEST_TIMEOUT_MS = Number(process.env.JACO_GATEWAY_TIMEOUT_MS || 30000);

function writeJson(res, status, body, requestId) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-jaco-request-id': requestId,
  });
  res.end(JSON.stringify(body));
}

function bearer(req) {
  const raw = String(req.headers.authorization || '');
  return raw.startsWith('Bearer ') ? raw.slice(7) : '';
}

function secureEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function authorized(req) {
  return TOKEN.length >= 24 && secureEqual(bearer(req), TOKEN);
}

async function readRaw(req, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('invalid JSON'), { status: 400 });
  }
}

function assertMutationAllowed(op) {
  if (!ALLOW_MUTATIONS) {
    throw Object.assign(new Error(`${op} disabled by gateway policy`), { status: 403, code: 'MUTATIONS_DISABLED' });
  }
}

function assertNavigationAllowed(rawUrl) {
  let target;
  try { target = new URL(rawUrl); }
  catch { throw Object.assign(new Error('invalid target URL'), { status: 400 }); }
  if (!['https:', 'http:'].includes(target.protocol)) {
    throw Object.assign(new Error('only http/https navigation is allowed'), { status: 400 });
  }
  if (!ALLOWED_HOSTS.has('*') && !ALLOWED_HOSTS.has(target.hostname.toLowerCase())) {
    throw Object.assign(new Error(`navigation host not allowed: ${target.hostname}`), { status: 403, code: 'HOST_NOT_ALLOWED' });
  }
}

async function nova(path, { method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${NOVA_BASE_URL}${path}`, {
      method,
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; }
    catch { data = { ok: false, error: 'nova returned non-JSON response' }; }
    if (!response.ok) {
      const error = new Error(data.error || `nova HTTP ${response.status}`);
      error.status = 502;
      error.novaStatus = response.status;
      error.nova = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function seer(path, { method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${SEER_BASE_URL}${path}`, {
      method,
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; }
    catch { data = { ok: false, error: 'seer returned non-JSON response' }; }
    if (!response.ok) {
      const error = new Error(data.error || `seer HTTP ${response.status}`);
      error.status = 502;
      error.seerStatus = response.status;
      error.seer = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function envelope(requestId, operation, result) {
  return {
    ok: result?.ok !== false,
    requestId,
    operation,
    executedBy: 'nova-cdp',
    observedAt: new Date().toISOString(),
    result,
  };
}

function serveScanReport(res, order, requestId) {
  const html = (status, body, refresh = false) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'x-jaco-request-id': requestId });
    res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh ? '<meta http-equiv="refresh" content="20">' : ''}<title>Repo security scan</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px}</style></head><body>${body}</body></html>`);
  };
  if (!ORDER_ID.test(order)) return html(404, '<h1>Not found</h1>');
  const file = path.join(reportDir(), `${order}.html`);
  if (fs.existsSync(file)) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'x-jaco-request-id': requestId });
    return res.end(fs.readFileSync(file));
  }
  return html(202, '<h1>Thank you, your scan is running</h1><p>Your report appears on this page as soon as it is ready, usually within a few minutes. The page refreshes by itself; you can also bookmark it.</p>', true);
}

const server = createServer(async (req, res) => {
  const requestId = randomUUID();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      const novaHealth = await nova('/health').catch(err => ({ ok: false, error: err.message }));
      const seerHealth = await seer('/health').catch(err => ({ ok: false, error: err.message }));
      return writeJson(res, (novaHealth.ok && seerHealth.ok) ? 200 : 503, {
        ok: novaHealth.ok === true && seerHealth.ok === true,
        service: 'jaco-chatgpt-nova-gateway',
        nova: novaHealth,
        seer: seerHealth,
        policy: {
          mutationsEnabled: ALLOW_MUTATIONS,
          navigationConfigured: ALLOWED_HOSTS.size > 0,
        },
      }, requestId);
    }

    // Public: the repo-scan report for one order. The Stripe checkout session id in the path is the
    // access capability (unguessable, known only to the buyer via Stripe's redirect).
    // Public, signed: mail for JACO's own addresses from the Cloudflare Email Worker (agents/lib/inbox.mjs).
    if (req.method === 'POST' && url.pathname === '/v1/inbox') {
      const raw = await readRaw(req, 1024 * 1024);
      if (!verifyInboxSignature(raw, req.headers['x-jaco-signature'], process.env.JACO_INBOX_SECRET)) return writeJson(res, 401, { error: 'INVALID_SIGNATURE' }, requestId);
      let message;
      try { message = JSON.parse(raw); } catch { return writeJson(res, 400, { error: 'INVALID_JSON' }, requestId); }
      const stored = storeInboxMessage(message);
      console.log(`[inbox] ${new Date().toISOString()} to=${String(message.to || '').slice(0, 60)} stored=${stored.stored}${stored.reason ? ` ${stored.reason}` : ''}`);
      return writeJson(res, 200, { ok: true, stored: stored.stored }, requestId);
    }
    // Public: free "is your API agent-payable?" check (agents/lib/x402-check.mjs), HTML and JSON.
    if (req.method === 'GET' && (url.pathname === '/x402-check' || url.pathname === '/v1/x402-check')) {
      const json = url.pathname === '/v1/x402-check';
      const target = url.searchParams.get('url') || '';
      const method = (url.searchParams.get('method') || 'GET').toUpperCase();
      let report = null, error = null;
      if (target) {
        const ip = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '');
        if (!x402CheckAllowed(ip)) error = 'Too many checks from this address; try again in an hour.';
        else {
          try { report = await checkX402(target, method); x402CheckStats.count++; }
          catch (e) { error = String(e.message || e); }
        }
        console.log(`[x402-check] ${new Date().toISOString()} ok=${Boolean(report)} payable=${report?.agentPayable ?? '-'} total=${x402CheckStats.count}`);
      }
      if (json) return writeJson(res, report ? 200 : target ? 400 : 200, report || { error: error || 'Pass ?url=https://...&method=GET|POST' }, requestId);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-jaco-request-id': requestId });
      const base = String(process.env.JACO_GATEWAY_PUBLIC_URL || '').replace(/\/+$/, '');
      return res.end(x402CheckPage({ report, error, url: target, method, exampleUrl: `${base}/v1/repo-scan` }));
    }
    // Joined devices (a second PC, the phone) run their own Nova against this hub with a device key.
    // Only the mission paths a Nova needs are forwarded; the runtime checks the key and limits the
    // device to missions routed to it (runtime src/server/connected/deviceAccess.mjs).
    const memoryRoute = url.pathname.match(/^\/v1\/device\/workplace\/(health|v1\/(register|sync|ack|events|heartbeat|session\/end))$/);
    if (memoryRoute) {
      const method = memoryRoute[1] === 'health' ? 'GET' : 'POST';
      if (req.method !== method) return writeJson(res,405,{error:'METHOD_NOT_ALLOWED'},requestId);
      const input = method==='POST' ? await readJson(req) : null;
      const response = await fetch((process.env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000') + '/api/connected/device/workplace/' + memoryRoute[1], {
        method, headers:{'content-type':'application/json',authorization:String(req.headers.authorization||''),'x-jaco-session-token':String(req.headers['x-jaco-session-token']||'')},
        ...(input?{body:JSON.stringify(input)}:{}), signal:AbortSignal.timeout(20000), redirect:'error'
      }).catch(()=>null);
      if (!response) return writeJson(res,503,{error:'HUB_RUNTIME_UNAVAILABLE'},requestId);
      return writeJson(res,response.status,await response.json(),requestId);
    }
    const deviceRoute = url.pathname.match(/^\/v1\/device\/(current|pair|missions\/[A-Za-z0-9-]{1,100}(?:\/(claim|preflight|begin|finish|release))?)$/);
    if (deviceRoute) {
      const post = Boolean(deviceRoute[2]) || deviceRoute[1] === 'pair';
      // Pairing is the one call without a key: a few attempts per address and hour.
      if (deviceRoute[1] === 'pair' && !devicePairAllowed(String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || ''))) {
        return writeJson(res, 429, { success: false, error: 'TOO_MANY_PAIRING_ATTEMPTS' }, requestId);
      }
      if (req.method !== (post ? 'POST' : 'GET')) return writeJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED' }, requestId);
      const body = post ? await readJson(req) : null;
      const upstream = await fetch(`${process.env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000'}/api/connected/device/${deviceRoute[1]}`, {
        method: req.method,
        headers: { 'content-type': 'application/json', authorization: String(req.headers.authorization || '') },
        ...(post ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000),
      }).catch(() => null);
      if (!upstream) return writeJson(res, 502, { success: false, error: 'HUB_RUNTIME_UNAVAILABLE' }, requestId);
      return writeJson(res, upstream.status, await upstream.json().catch(() => ({ success: false, error: 'HUB_RUNTIME_BAD_RESPONSE' })), requestId);
    }
    // Public: terms of service of the repo scan (linked from the offer, the OpenAPI spec and Skyfire).
    if (req.method === 'GET' && url.pathname === '/terms') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600', 'x-jaco-request-id': requestId });
      return res.end(repoScanTerms());
    }
    if (req.method === 'GET' && url.pathname.startsWith('/scan/')) {
      return serveScanReport(res, url.pathname.slice('/scan/'.length), requestId);
    }
    // Public: agents buy the repo scan with a Skyfire token (agents/lib/agent-orders.mjs).
    // Public purchase traffic is logged (method, path, client) so discovery and buyer requests are visible.
    if (url.pathname.startsWith('/v1/repo-scan')) console.log(`[repo-scan] ${new Date().toISOString()} ${req.method} ${url.pathname} ua=${String(req.headers['user-agent'] || '').slice(0, 60)} country=${req.headers['cf-ipcountry'] || '-'} paid=${Boolean(req.headers['payment-signature'] || req.headers['x-payment'] || req.headers['kyapay-token'])}`);
    if (req.method === 'GET' && url.pathname === '/v1/repo-scan') return writeJson(res, 200, agentOffer(), requestId);
    if (req.method === 'GET' && url.pathname === '/v1/repo-scan/openapi.json') return writeJson(res, 200, repoScanOpenApi(), requestId);
    if (req.method === 'POST' && url.pathname === '/v1/repo-scan') {
      const body = await readJson(req);
      const token = req.headers['kyapay-token'] || req.headers['skyfire-pay-id'] || '';
      const x402 = req.headers['payment-signature'] || req.headers['x-payment'] || '';
      const r = await withOrders(async () => {
        const state = loadOrderState();
        const out = x402
          ? await agentPurchaseX402({ paymentHeader: String(x402), repo: body?.repo, state, createMission: createOrderMission })
          : await agentPurchase({ token: String(token), repo: body?.repo, state, createMission: createOrderMission });
        if (out.status === 202 || out.status === 500) saveOrderState(state);
        return out;
      });
      // x402 v2 headers: what to pay (402) and the settlement receipt (202).
      if (r.status === 402) res.setHeader('PAYMENT-REQUIRED', encodeX402Header(x402PaymentRequired(`${String(process.env.JACO_GATEWAY_PUBLIC_URL || '').replace(/\/+$/, '')}/v1/repo-scan`)));
      if (r.settlement) res.setHeader('PAYMENT-RESPONSE', encodeX402Header(r.settlement));
      return writeJson(res, r.status, r.body, requestId);
    }
    // Public: JACO Verify API (agents/lib/verify-api.mjs). A free daily quota per client, then x402.
    if (url.pathname === '/v1/verify') {
      const base = String(process.env.JACO_GATEWAY_PUBLIC_URL || '').replace(/\/+$/, '');
      const priced = { priceUsd: VERIFY_PRICE_USD, description: verifyOffer().description, bazaar: verifyBazaar() };
      if (req.method === 'GET') return writeJson(res, 200, verifyOffer(), requestId);
      if (req.method !== 'POST') return writeJson(res, 405, { error: 'METHOD_NOT_ALLOWED' }, requestId);
      const body = await readJson(req);
      // An empty request is a discovery probe (x402 validators and agents send one): answer 402 with the
      // price. An invalid request is refused before anything is charged.
      if (!body || !Object.keys(body).length) {
        res.setHeader('PAYMENT-REQUIRED', encodeX402Header(x402PaymentRequired(`${base}/v1/verify`, process.env, priced)));
        return writeJson(res, 402, { error: 'PAYMENT_REQUIRED', offer: verifyOffer() }, requestId);
      }
      try { validateVerifyRequest(body); } catch (e) { return writeJson(res, 400, { error: e.message, offer: verifyOffer() }, requestId); }
      const client = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '');
      const x402 = String(req.headers['payment-signature'] || req.headers['x-payment'] || '');
      let paid = null;
      if (x402) {
        paid = await verifyAndSettleX402(x402, { priceUsd: VERIFY_PRICE_USD });
        if (!paid.ok) {
          res.setHeader('PAYMENT-REQUIRED', encodeX402Header(x402PaymentRequired(`${base}/v1/verify`, process.env, priced)));
          return writeJson(res, 402, { error: paid.error, offer: verifyOffer() }, requestId);
        }
        res.setHeader('PAYMENT-RESPONSE', encodeX402Header(paid.settlement));
      } else if (!verifyQuota.take(client)) {
        res.setHeader('PAYMENT-REQUIRED', encodeX402Header(x402PaymentRequired(`${base}/v1/verify`, process.env, priced)));
        return writeJson(res, 402, { error: 'FREE_QUOTA_USED', offer: verifyOffer() }, requestId);
      }
      try {
        const result = await verifyAnswer(body);
        console.log(`[verify] ${new Date().toISOString()} paid=${Boolean(paid)} claims=${result.claims} ok=${result.ok}`);
        return writeJson(res, 200, result, requestId);
      } catch (e) {
        console.error(`[verify] failed after ${paid ? 'payment' : 'free use'}: ${e.message}`);
        return writeJson(res, 500, { error: 'VERIFY_FAILED', paid: Boolean(paid) }, requestId);
      }
    }
    if (req.method === 'GET' && url.pathname.startsWith('/v1/repo-scan/')) {
      const r = agentOrderStatus(url.pathname.slice('/v1/repo-scan/'.length), { state: loadOrderState() });
      return writeJson(res, r.status, r.body, requestId);
    }

    if (!authorized(req)) {
      // Never log any part of the presented credential.
      console.error(`AUTH FAILED: path=${url.pathname} credentialPresented=${Boolean(req.headers.authorization)}`);
      return writeJson(res, 401, { ok: false, error: 'unauthorized', requestId }, requestId);
    }

    if (req.method === 'GET' && url.pathname === '/v1/nova/observe') {
      return writeJson(res, 200, envelope(requestId, 'observe', await nova('/observe')), requestId);
    }

    if (req.method === 'GET' && url.pathname === '/v1/nova/targets') {
      return writeJson(res, 200, envelope(requestId, 'targets', await nova('/targets')), requestId);
    }

    if (req.method === 'POST' && url.pathname === '/v1/nova/navigate') {
      assertMutationAllowed('navigate');
      const body = await readJson(req);
      assertNavigationAllowed(body.url);
      return writeJson(res, 200, envelope(requestId, 'navigate', await nova('/navigate', { method: 'POST', body })), requestId);
    }

    if (req.method === 'POST' && url.pathname === '/v1/nova/click') {
      assertMutationAllowed('click');
      const body = await readJson(req);
      if (!body.selector || typeof body.selector !== 'string') throw Object.assign(new Error('selector required'), { status: 400 });
      return writeJson(res, 200, envelope(requestId, 'click', await nova('/click', { method: 'POST', body })), requestId);
    }

    if (req.method === 'POST' && url.pathname === '/v1/nova/type') {
      assertMutationAllowed('type');
      const body = await readJson(req);
      if (!body.selector || typeof body.selector !== 'string') throw Object.assign(new Error('selector required'), { status: 400 });
      if (typeof body.text !== 'string') throw Object.assign(new Error('text required'), { status: 400 });
      return writeJson(res, 200, envelope(requestId, 'type', await nova('/type', { method: 'POST', body })), requestId);
    }

    if (req.method === 'POST' && url.pathname === '/v1/nova/survey') {
      const body = await readJson(req);
      return writeJson(res, 200, envelope(requestId, 'survey', await nova('/survey', { method: 'POST', body })), requestId);
    }

    // SEER Strategic Cognitive Kernel proxying
    if (url.pathname.startsWith('/cortex/')) {
      if (req.method === 'GET') {
        return writeJson(res, 200, await seer(url.pathname + url.search), requestId);
      }
      if (req.method === 'POST') {
        const body = await readJson(req);
        return writeJson(res, 201, await seer(url.pathname + url.search, { method: 'POST', body }), requestId);
      }
    }

    return writeJson(res, 404, { ok: false, error: 'not found', requestId }, requestId);
  } catch (error) {
    const status = Number(error.status || 500);
    return writeJson(res, status, {
      ok: false,
      requestId,
      error: error.message,
      code: error.code || 'GATEWAY_ERROR',
      ...(error.novaStatus ? { novaStatus: error.novaStatus } : {}),
    }, requestId);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`JACO ChatGPT/Nova Gateway -> http://${HOST}:${PORT}`);
  console.log(`Nova upstream -> ${NOVA_BASE_URL}`);
  console.log(`Mutations -> ${ALLOW_MUTATIONS ? 'ENABLED' : 'DISABLED'}`);
});
