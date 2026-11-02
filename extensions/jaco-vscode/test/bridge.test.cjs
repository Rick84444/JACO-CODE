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
  assert.doesNotMatch(ext, /https?:\/\/jacocode\.com\/api\/aura/);
});
