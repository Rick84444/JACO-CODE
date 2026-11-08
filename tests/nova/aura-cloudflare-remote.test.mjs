import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { remoteLoginUrl } from '../../runtime/src/lib/remoteLink.mjs';
import { createIdeRemoteGate, LOGIN_SCRIPT, PUBLIC_APP_FILES, readCookie, upgradeAllowed } from '../../runtime/src/server/connected/ideAccess.mjs';

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
  assert.equal(manifest.icons[0].sizes, '192x192');
  assert.equal(manifest.icons[0].type, 'image/png');
  const icon = fs.readFileSync(path.join(root, 'runtime/public/branding/jaco-remote-icon-192.png'));
  assert.equal(icon.readUInt32BE(16),192);
  assert.equal(icon.readUInt32BE(20),192);
  assert.ok(fs.existsSync(path.join(root,'runtime/public/branding/jaco-remote-icon.svg')));
  assert.equal(manifest.icons[1].type, 'image/svg+xml');
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
  assert.match(workspace, /Sign out of Remote/);
  assert.match(workspace, /ide-auth\/status/);
  assert.match(workspace, /props\.onCanvas\(view\)/);
  assert.match(workspace, /props\.onApprovals/);
  assert.match(workspace, /href="\/" className="cognitive-remote-full"/);
  assert.match(devices, /remoteLoginUrl\(ideUrl\)/);
  assert.match(css, /data-remote-mode="true"/);
});

test('remote device status and revocation are authoritative for API and WebSocket',()=>{
  const host='ide.example.com';
  let active=true;
  const registry={
    verify:key=>active&&key==='test-key'?{name:'pixel-remote'}:null,
    redeem:()=>{throw Error('unexpected redeem');}
  };
  const gate=createIdeRemoteGate(registry,{env:{JACO_IDE_PUBLIC_HOST:host}});
  const request=(method,p,extra={})=>{
    const req={method,path:p,query:{},headers:{host,'cf-connecting-ip':'198.51.100.12',...extra}};
    const observed={status:200,body:null,passed:false};
    const res={
      setHeader(){},
      status(code){observed.status=code;return this;},
      json(body){observed.body=body;return this;},
      redirect(code,to){observed.status=code;observed.body=to;return this;},
      end(body){observed.body=body;return this;}
    };
    gate(req,res,()=>{observed.passed=true;});
    return observed;
  };
  assert.equal(request('GET','/ide-auth/status').status,401);
  assert.equal(request('GET','/api/aura/workbench').status,401);
  const cookie={cookie:'jaco_ide=test-key'};
  assert.equal(request('GET','/ide-auth/status',cookie).body.device,'pixel-remote');
  assert.equal(request('GET','/api/aura/workbench',cookie).passed,true);
  assert.equal(request('POST','/api/aura/chat',{...cookie,origin:'https://other.example'}).status,403);
  assert.equal(request('POST','/api/aura/chat',{...cookie,origin:'https://ide.example.com'}).passed,true);
  assert.equal(request('POST','/api/terminal/exec',{...cookie,origin:'https://ide.example.com'}).status,403);
  const socket={headers:{...cookie,host,'cf-connecting-ip':'198.51.100.12',origin:'https://ide.example.com'}};
  assert.equal(upgradeAllowed(socket,registry,{JACO_IDE_PUBLIC_HOST:host}),true);
  active=false;
  assert.equal(request('GET','/ide-auth/status',cookie).status,401);
  assert.equal(request('GET','/api/aura/workbench',cookie).status,401);
  assert.equal(upgradeAllowed(socket,registry,{JACO_IDE_PUBLIC_HOST:host}),false);
  assert.equal(readCookie('jaco_ide=%broken','jaco_ide'),null);
});
