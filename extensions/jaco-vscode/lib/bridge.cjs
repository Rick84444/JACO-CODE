'use strict';

// Pure, zero-dependency connection and framing helpers. No runtime restarts or model calls.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function runtimeOrigin(configured) {
  const value = String(configured || 'http://127.0.0.1:3000');
  const url = new URL(value);
  if (url.protocol !== 'http:' || !LOCAL_HOSTS.has(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('JACO_VSCODE_LOCALHOST_ONLY');
  }
  return url.origin;
}

const EMBED_PATH = '/vscode-embed';
function embedUrl(origin) { return runtimeOrigin(origin) + EMBED_PATH; }

async function probeJacoRuntime(origin, fetchImpl = globalThis.fetch) {
  const base = runtimeOrigin(origin);
  const identity = await fetchImpl(base + '/api/runtime/identity', {
    method: 'GET', signal: AbortSignal.timeout(4000), redirect: 'error',
  });
  if (!identity.ok) throw new Error('JACO_VSCODE_RUNTIME_UNREACHABLE_' + identity.status);
  const body = await identity.json().catch(() => null);
  if (body?.success !== true || body?.product !== 'JACO Autonomus IDE') {
    throw new Error('JACO_VSCODE_RUNTIME_IDENTITY_MISMATCH');
  }
  const response = await fetchImpl(embedUrl(base), {
    method: 'GET', signal: AbortSignal.timeout(4000), redirect: 'error',
  });
  if (!response.ok || response.headers.get('x-jaco-embed') !== 'vscode-v1' ||
      !String(response.headers.get('content-type') || '').includes('text/html')) {
    throw new Error('JACO_VSCODE_EMBED_DISABLED_OR_OUTDATED');
  }
  if (response.body && typeof response.body.cancel === 'function') {
    await response.body.cancel().catch(() => {});
  }
  return { base, version: body.version || 'unknown', embed: embedUrl(base) };
}

function escapedAttribute(input) {
  return String(input).replace(/[&"<>\u0027]/g, char => ({
    '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;', "'": '&#39;',
  })[char]);
}

function makeWebviewHtml(mappedUrl) {
  const url = new URL(String(mappedUrl));
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      !url.pathname.endsWith(EMBED_PATH)) {
    throw new Error('JACO_VSCODE_EMBED_URI_INVALID');
  }
  const src = escapedAttribute(url.toString());
  const allowedFrameOrigin = escapedAttribute(url.origin);
  // Scripts run in JACO's cross-origin iframe, not in this extension wrapper.
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; frame-src ' + allowedFrameOrigin + '; object-src &#39;none&#39;; base-uri &#39;none&#39;; style-src &#39;unsafe-inline&#39;">',
    '<title>JACO Cognitive IDE</title>',
    '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#050b11;color:#dbeafe}',
    'iframe{border:0;width:100%;height:100%;display:block}</style></head>',
    '<body><iframe title="JACO — complete live IDE" src="' + src + '"',
    ' sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups"',
    ' referrerpolicy="no-referrer" loading="eager"></iframe></body></html>',
  ].join('\n');
}

// JACO Lite writes where it runs to ~/.jaco/lite-runtime.json (a free port when 3000 is taken). The configured
// address is tried first; the record is only a fallback, accepted when its process is alive and the address is local.
function readRuntimeRecord({ fs = require('node:fs'), os = require('node:os'), path = require('node:path'), alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } } } = {}) {
  try {
    const record = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.jaco', 'lite-runtime.json'), 'utf8'));
    if (record?.product !== 'JACO Autonomus IDE' || !Number.isInteger(record.launcherPid) || !alive(record.launcherPid)) return null;
    return runtimeOrigin(record.url);
  } catch { return null; }
}

async function probeWithDiscovery(configured, { fetchImpl = globalThis.fetch, record = readRuntimeRecord } = {}) {
  try { return await probeJacoRuntime(configured, fetchImpl); }
  catch (first) {
    if (!/^JACO_VSCODE_RUNTIME_UNREACHABLE|fetch failed|timeout|aborted|ECONNREFUSED/i.test(String(first?.message || first))) throw first;
    const found = record();
    if (!found || found === runtimeOrigin(configured)) throw first;
    return probeJacoRuntime(found, fetchImpl);
  }
}

module.exports = { runtimeOrigin, embedUrl, probeJacoRuntime, probeWithDiscovery, readRuntimeRecord, makeWebviewHtml };
