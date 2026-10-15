import crypto from 'node:crypto';
// Peer URLs are caller-supplied: requests go through the outbound guard (no private addresses, redirects or unbounded bodies).
import { guardedRequest } from '../continuum/outboundGuard.mjs';
const sha = value => crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
export async function discoverAgentCards(urls, { timeoutMs = 8000 } = {}) {
  const results = [];
  for (const raw of urls || []) {
    const url = String(raw || '').trim(); if (!url) continue;
    const started = Date.now();
    try {
      const res = await guardedRequest(url, { timeoutMs });
      const text = res.text; const card = res.json && typeof res.json === 'object' ? res.json : null;
      results.push({ url, ok: res.ok && !!card, status: res.status, latencyMs: Date.now()-started, responseHash: sha(text), card });
    } catch (error) { results.push({ url, ok: false, status: null, latencyMs: Date.now()-started, error: error instanceof Error ? error.message : String(error) }); }
  }
  return results;
}
export async function sendA2ATask({ endpoint, skill, message, id = `task-${Date.now()}`, bearer = null, timeoutMs = 20_000 } = {}) {
  if (!endpoint) throw new Error('A2A_ENDPOINT_REQUIRED');
  const payload = { jsonrpc: '2.0', id, method: 'tasks/send', params: { id, skill, message: typeof message === 'string' ? { parts: [{ type: 'text', text: message }] } : message } };
  const headers = { 'content-type': 'application/json', accept: 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) };
  const started = Date.now(); const res = await guardedRequest(endpoint, { method: 'POST', headers, body: payload, timeoutMs, maxBytes: 1024 * 1024 });
  const text = res.text; const parsed = res.json ?? null;
  if (!res.ok || !parsed || parsed.error) throw new Error(`A2A_REMOTE_FAILURE_${res.status}: ${text.slice(0,400)}`);
  return { endpoint, status: res.status, latencyMs: Date.now()-started, requestHash: sha(JSON.stringify(payload)), responseHash: sha(text), response: parsed };
}
