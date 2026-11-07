import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { remoteLoginUrl } from '../../runtime/src/lib/remoteLink.mjs';
import { createIdeRemoteGate, LOGIN_SCRIPT, PUBLIC_APP_FILES } from '../../runtime/src/server/connected/ideAccess.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Remote pairing links remain on the configured HTTPS IDE login, without open redirects', () => {
  assert.equal(remoteLoginUrl('https://ide.example.com/ide-login'), 'https://ide.example.com/ide-login?next=remote');
  assert.equal(remoteLoginUrl('https://ide.example.com/ide-login?from=devices#fragment'), 'https://ide.example.com/ide-login?from=devices&next=remote');
  for (const invalid of [null, '', 'http://ide.example.com/ide-login', 'javascript:alert(1)', 'https://user:pass@ide.example.com/ide-login', 'https://ide.example.com/other']) {
    assert.equal(remoteLoginUrl(invalid), null);
  }
  assert.match(LOGIN_SCRIPT, /next==='remote'\?'\/\?remote=1':'\/'/);
  assert.doesNotMatch(LOGIN_SCRIPT, /location\.replace\(next\)/);
});

test('Remote entry redirects to pairing only through existing IDE gate; local work remains unchanged', () => {
  const host = 'ide.example.com';
  const gate = createIdeRemoteGate({ verify: () => null, redeem: () => { throw Error('No pairing'); } }, { env: { JACO_IDE_PUBLIC_HOST: host } });
  function request(query, headers = {}) {
    let redirection = null, passed = false;
    const req = { method: 'GET', path: '/', query, headers: { host, 'cf-connecting-ip': '198.51.100.4', ...headers } };
    const res = {
      setHeader() {},
      status() { return this; },
      json() { return this; },
      redirect(code, target) { redirection = { code, target }; return this; },
    };
    gate(req, res, () => { passed = true; });
    return { redirection, passed };
  }
  assert.deepEqual(request({ remote: '1' }).redirection, { code: 302, target: '/ide-login?next=remote' });
  assert.deepEqual(request({ remote: 'https://evil.example' }).redirection, { code: 302, target: '/ide-login' });
  assert.equal(request({ remote: '1' }, { 'cf-connecting-ip': undefined, host: '127.0.0.1:3000' }).passed, true);
  assert.equal(PUBLIC_APP_FILES.has('/remote.webmanifest'), true);
});

test('Remote PWA opens the same Aura owner and does not introduce another chat executor', () => {
  const manifest = JSON.parse(read('runtime/public/remote.webmanifest'));
  assert.equal(manifest.start_url, '/?remote=1');
  assert.equal(manifest.display, 'standalone');
  assert.notEqual(manifest.id, '/');
  const main = read('runtime/src/main.tsx');
  const workbench = read('runtime/src/components/JacoAuraComputeIDE.tsx');
  const workspace = read('runtime/src/components/CognitiveWorkspace.tsx');
  const devices = read('runtime/src/components/DevicesView.tsx');
  const css = read('runtime/src/cognitive-workspace.css');
  assert.match(main, /\/remote\.webmanifest/);
  assert.match(workbench, /remoteMode=\{remoteMode\}/);
  assert.equal((workbench.match(/<AuraChatPanel\b/g) || []).length, 1);
  assert.match(workspace, /cognitive-remote-navigation/);
  assert.match(workspace, /props\.onCanvas\(view\)/);
  assert.match(workspace, /props\.onApprovals/);
  assert.match(workspace, /href="\/" className="cognitive-remote-full"/);
  assert.match(devices, /remoteLoginUrl\(ideUrl\)/);
  assert.match(css, /data-remote-mode="true"/);
});
