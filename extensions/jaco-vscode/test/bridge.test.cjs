'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { runtimeOrigin, embedUrl, probeJacoRuntime, makeWebviewHtml } = require('../lib/bridge.cjs');

test('the extension accepts only local JACO Core endpoints', () => {
  assert.equal(runtimeOrigin('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
  assert.equal(runtimeOrigin('http://localhost:4230'), 'http://localhost:4230');
  assert.equal(embedUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000/vscode-embed');
  for (const unsafe of [
    'https://example.com', 'http://192.168.1.10:3000',
    'http://attacker@127.0.0.1:3000',
    'http://127.0.0.1:3000/api/terminal/exec',
    'http://127.0.0.1:3000/?token=abc',
    'javascript:alert(1)', 'file:///etc/passwd',
  ]) assert.throws(() => runtimeOrigin(unsafe), /JACO_VSCODE_LOCALHOST_ONLY/, unsafe);
});

test('no generic HTTP 200 or impostor server is accepted as JACO', async () => {
  const fake = async url => ({
    ok: true, status: 200,
    json: async () => ({ success: true, product: 'Other server' }),
    headers: { get: () => 'text/html' },
  });
  await assert.rejects(probeJacoRuntime('http://127.0.0.1:3000', fake), /JACO_VSCODE_RUNTIME_IDENTITY_MISMATCH/);
});

test('identity and explicit opt-in marker are both required', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({url, method:options.method});
    if (url.endsWith('/identity')) return {
      ok:true, json: async () => ({success:true,product:'JACO Autonomus IDE',version:'0.22.0'}),
    };
    return {
      ok:true,
      headers: { get: key => key === 'x-jaco-embed' ? 'vscode-v1' : 'text/html; charset=utf-8' },
      body: { cancel: async () => {} },
    };
  };
  const result = await probeJacoRuntime('http://127.0.0.1:3000',fetcher);
  assert.equal(result.embed, 'http://127.0.0.1:3000/vscode-embed');
  assert.deepEqual(calls.map(c => c.url), [
    'http://127.0.0.1:3000/api/runtime/identity',
    'http://127.0.0.1:3000/vscode-embed',
  ]);
  const disabled = async (url) => url.endsWith('/identity')
    ? { ok:true, json:async () => ({success:true,product:'JACO Autonomus IDE'}) }
    : { ok:true, headers:{get: key => key === 'x-jaco-embed' ? null : 'text/html'} };
  await assert.rejects(probeJacoRuntime('http://127.0.0.1:3000',disabled), /JACO_VSCODE_EMBED_DISABLED_OR_OUTDATED/);
});

test('webview renders full GUI with a single narrowly scoped iframe and no script bridge', () => {
  const html = makeWebviewHtml('https://abc.vscode-webview.net/vscode-embed');
  assert.match(html, /<iframe/);
  assert.match(html, /complete live IDE/);
  assert.match(html, /frame-src https:\/\/abc\.vscode-webview\.net/);
  assert.match(html, /sandbox="allow-scripts allow-same-origin allow-forms/);
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /allow-top-navigation/);
  assert.doesNotMatch(html, /postMessage/);
  for (const bad of ['javascript:alert(1)', 'https://a.test/other','https://foo:pass@a.test/vscode-embed']) {
    assert.throws(() => makeWebviewHtml(bad), /JACO_VSCODE_EMBED_URI_INVALID/);
  }
});

test('extension entry exposes a real activity bar command and uses VS Code forwarding', () => {
  const ext = fs.readFileSync(path.join(__dirname,'..','extension.cjs'),'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname,'..','package.json'),'utf8'));
  assert.equal(pkg.main, './extension.cjs');
  assert.ok(pkg.contributes.views.jaco.some(x => x.id === 'jaco.workspace'));
  assert.ok(pkg.contributes.commands.some(x => x.command === 'jaco.openFullGUI'));
  assert.match(ext, /vscode\.env\.asExternalUri/);
  assert.match(ext, /vscode\.window\.createWebviewPanel/);
  assert.match(ext, /makeWebviewHtml/);
  assert.match(ext, /JACO_VSCODE_EMBED: '1'/);
  assert.match(ext, /vscode\.workspace\.isTrusted/);
  assert.ok(pkg.activationEvents.includes('onUri'));
  assert.ok(pkg.activationEvents.includes('onStartupFinished'));
  assert.ok(ext.includes("uri.path === '/open'"));
  assert.ok(!/uri\.(query|fragment)/.test(ext), 'a link cannot pass parameters');
  assert.doesNotMatch(ext, /https?:\/\/jacocode\.com\/api\/aura/);
});


test('discovery falls back to the running Lite record only when the configured address is unreachable', async () => {
  const { probeWithDiscovery, readRuntimeRecord } = require('../lib/bridge.cjs');
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (url.startsWith('http://127.0.0.1:3000')) throw new Error('fetch failed');
    if (url.endsWith('/api/runtime/identity')) return { ok: true, json: async () => ({ success: true, product: 'JACO Autonomus IDE', version: '0.22.0' }) };
    return { ok: true, headers: { get: h => (h === 'x-jaco-embed' ? 'vscode-v1' : 'text/html') }, body: null };
  };
  const found = await probeWithDiscovery('http://127.0.0.1:3000', { fetchImpl, record: () => 'http://127.0.0.1:3001' });
  assert.equal(found.base, 'http://127.0.0.1:3001');
  assert.ok(calls.some(url => url.startsWith('http://127.0.0.1:3001')));
  await assert.rejects(probeWithDiscovery('http://127.0.0.1:3000', { fetchImpl, record: () => null }), /fetch failed/);
  // A wrong product at the configured address is an error, never a reason to look elsewhere.
  const wrong = async url => ({ ok: true, json: async () => ({ success: true, product: 'Something else' }), headers: { get: () => null } });
  await assert.rejects(probeWithDiscovery('http://127.0.0.1:3000', { fetchImpl: wrong, record: () => 'http://127.0.0.1:3001' }), /IDENTITY_MISMATCH/);

  const fsStub = body => ({ readFileSync: () => body });
  const osStub = { homedir: () => '/home/u' };
  const rec = { product: 'JACO Autonomus IDE', url: 'http://127.0.0.1:3001', launcherPid: 4242 };
  assert.equal(readRuntimeRecord({ fs: fsStub(JSON.stringify(rec)), os: osStub, alive: () => true }), 'http://127.0.0.1:3001');
  assert.equal(readRuntimeRecord({ fs: fsStub(JSON.stringify(rec)), os: osStub, alive: () => false }), null, 'a dead process id is a stale record');
  assert.equal(readRuntimeRecord({ fs: fsStub(JSON.stringify({ ...rec, url: 'https://evil.example' })), os: osStub, alive: () => true }), null, 'only local addresses');
  assert.equal(readRuntimeRecord({ fs: fsStub('not json'), os: osStub, alive: () => true }), null);
});
