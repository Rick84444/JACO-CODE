import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { mountVscodeEmbedHeaders, VSCODE_EMBED_PATH, vscodeEmbedAllowed } from '../../runtime/src/server/security/vscodeEmbed.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function request({ path = VSCODE_EMBED_PATH, method = 'GET', host = '127.0.0.1:3000', ip = '127.0.0.1', extra = {}, enabled = true, csp } = {}) {
  const req = { path, method, socket: { remoteAddress: ip }, headers: { host, ...extra } };
  const headers = new Map([
    ['content-security-policy', csp === undefined ? "default-src 'self'; script-src 'self'; frame-ancestors 'none'; object-src 'none'" : csp],
    ['x-frame-options', 'DENY'],
  ]);
  let status = 200, body = null, continued = false;
  const res = {
    getHeader(key) { return headers.get(key.toLowerCase()); },
    setHeader(key, value) { headers.set(key.toLowerCase(), String(value)); },
    removeHeader(key) { headers.delete(key.toLowerCase()); },
    status(code) { status = code; return this; },
    json(data) { body = data; return this; },
  };
  let middleware;
  mountVscodeEmbedHeaders({ use(fn) { middleware = fn; } }, { env: { JACO_VSCODE_EMBED: enabled ? '1' : '0' } });
  middleware(req, res, () => { continued = true; });
  return { headers, status, body, continued, req };
}
test('JACO defaults to frame denied and requires explicit opt-in', () => {
  const normal = request({path: '/'});
  assert.equal(normal.continued, true);
  assert.equal(normal.headers.get('x-frame-options'), 'DENY');
  assert.match(normal.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const denied = request({enabled:false});
  assert.equal(denied.continued, false);
  assert.equal(denied.status, 404);
  assert.equal(denied.headers.get('x-frame-options'), 'DENY');
  assert.match(denied.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('only the exact local embed route allows VS Code webview ancestors', () => {
  const embedded = request();
  assert.equal(embedded.continued, true);
  assert.equal(embedded.status, 200);
  assert.equal(embedded.headers.has('x-frame-options'), false);
  assert.equal(embedded.headers.get('x-jaco-embed'), 'vscode-v1');
  assert.match(embedded.headers.get('content-security-policy'), /frame-ancestors https:\/\/\*\.vscode-webview\.net vscode-webview:/);
  assert.match(embedded.headers.get('content-security-policy'), /vscode-file:\/\/vscode-app/);
  assert.match(embedded.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(embedded.headers.get('content-security-policy'), /object-src 'none'/);
  for (const p of ['/', '/vscode-embed/', '/ide-login', '/api/aura/chat', '/assets/app.js']) {
    const ordinary = request({path:p});
    assert.equal(ordinary.headers.get('x-frame-options'), 'DENY', p);
    assert.equal(ordinary.headers.has('x-jaco-embed'), false, p);
  }
});

test('public, proxy, DNS-rebinding, non-loopback and mutation requests cannot embed', () => {
  for (const overrides of [
    { host: 'evil.example:3000' }, { ip: '192.168.1.80' },
    { extra: {'x-forwarded-for':'192.0.2.10'} },
    { extra: {'cf-connecting-ip':'192.0.2.10'} },
    { extra: { forwarded: 'for=127.0.0.1' } },
    { extra: {'x-forwarded-host':'evil.example'} },
    { method: 'POST' }, { method: 'PUT' },
  ]) {
    const result = request(overrides);
    assert.equal(result.status, 404, JSON.stringify(overrides));
    assert.equal(result.continued, false);
    assert.equal(result.headers.get('x-frame-options'), 'DENY');
  }
  assert.equal(vscodeEmbedAllowed({method:'GET',socket:{remoteAddress:'::1'},headers:{host:'[::1]:3000'}}, {JACO_VSCODE_EMBED:'1'}), true);
});

test('if default CSP no longer denies framing, the exception fails closed', () => {
  const missing = request({csp:"default-src 'self'"});
  assert.equal(missing.status, 503);
  assert.equal(missing.headers.get('x-frame-options'), 'DENY');
});

test('runtime mounts embed only after remote IDE authentication and leaves root hardening enabled', () => {
  const server = fs.readFileSync(path.join(root,'runtime/server.ts'), 'utf8');
  const hardening = fs.readFileSync(path.join(root,'runtime/src/server/security/httpHardening.ts'), 'utf8');
  const remoteGate = server.indexOf('app.use(createIdeRemoteGate(');
  const embed = server.indexOf('mountVscodeEmbedHeaders(app)');
  const staticRoot = server.indexOf('app.use(express.static(path.join(WORKSPACE_ROOT, "public")))');
  assert.ok(remoteGate > 0 && embed > remoteGate && staticRoot > embed);
  assert.match(hardening, /"frame-ancestors 'none'"/);
  assert.match(hardening, /res.setHeader\('X-Frame-Options', 'DENY'\)/);
});

test('the GUI button opens the extension through its fixed URI, only for a local top-level page', () => {
  const shell = fs.readFileSync(path.join(root, 'runtime/src/components/CognitiveWorkspace.tsx'), 'utf8');
  assert.ok(shell.includes("VSCODE_OPEN_URL = 'vscode://jacocode.jaco-cognitive-ide/open'"));
  assert.ok(shell.includes('canOpenInVsCode && <button'));
  assert.ok(shell.includes('window.self === window.top'));
});
