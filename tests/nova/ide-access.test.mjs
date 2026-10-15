import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DeviceRegistry} from '../../runtime/src/server/connected/deviceAccess.mjs';
import {createIdeRemoteGate, upgradeAllowed, IDE_COOKIE, COMMAND_ROUTES} from '../../runtime/src/server/connected/ideAccess.mjs';

const HOST = 'ide.example.com';
const env = {JACO_IDE_PUBLIC_HOST: HOST};

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-gate-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const registry = new DeviceRegistry(path.join(dir, 'devices.json'));
  const gate = createIdeRemoteGate(registry, {env});
  // Runs one request through the gate; returns what the gate answered, or that it passed it on.
  const run = ({method = 'GET', path: p = '/', headers = {}, body} = {}) => {
    const req = {method, path: p, body, headers: {host: HOST, 'cf-connecting-ip': '203.0.113.7', ...headers}};
    const out = {status: 200, headers: {}, body: null, passed: false, req};
    const res = {
      setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
      status(n) { out.status = n; return this; },
      json(v) { out.body = v; return this; },
      end(v) { out.body = v; return this; },
      redirect(code, to) { out.status = code; out.headers.location = to; return this; },
    };
    gate(req, res, () => { out.passed = true; });
    return out;
  };
  const signIn = () => {
    const {code} = registry.invite('telefon', 'ide');
    const r = run({method: 'POST', path: '/ide-auth/pair', body: {code}});
    assert.equal(r.status, 200);
    const cookie = String(r.headers['set-cookie']);
    return {cookie: cookie.split(';')[0], raw: cookie};
  };
  return {registry, run, signIn};
}

test('requests from this computer are untouched; through the tunnel only the IDE host is served', t => {
  const s = setup(t);
  const local = s.run({headers: {'cf-connecting-ip': undefined, host: '127.0.0.1:3000'}});
  assert.equal(local.passed, true);
  const other = s.run({headers: {host: 'api.example.com'}});
  assert.equal(other.status, 403);
  assert.equal(other.passed, false);
});

test('without a session the tunnel shows only the login page', t => {
  const s = setup(t);
  assert.equal(s.run({path: '/'}).headers.location, '/ide-login');
  const api = s.run({path: '/api/aura/workbench'});
  assert.equal(api.status, 401);
  assert.equal(api.passed, false);
  assert.equal(s.run({method: 'POST', path: '/api/connected/goals', headers: {origin: `https://${HOST}`}}).status, 401);
  // Only the app manifest and its icons are public, so the phone can install the IDE as an app.
  assert.equal(s.run({path: '/manifest.webmanifest'}).passed, true);
  assert.equal(s.run({path: '/branding/jaco-icon-512.png'}).passed, true);
  assert.equal(s.run({path: '/branding/jaco-logo.png'}).passed, false);
  assert.equal(s.run({method: 'POST', path: '/manifest.webmanifest'}).passed, false);
  // The production CSP is script-src 'self': the login page may not carry inline script.
  const script = s.run({path: '/ide-login.js'});
  assert.match(String(script.headers['content-type']), /javascript/);
  assert.match(String(script.body), /\/ide-auth\/pair/);
  assert.doesNotMatch(String(s.run({path: '/ide-login'}).body), /<script>(?!<\/script>)[^<]/);
  assert.match(String(s.run({path: '/ide-login'}).body), /<script src="\/ide-login\.js"><\/script>/);
  const login = s.run({path: '/ide-login'});
  assert.match(String(login.body), /Parkopplingskod/);
  assert.equal(login.passed, false);
});

test('an IDE pairing code gives a secure session cookie; a Nova code or key does not', t => {
  const s = setup(t);
  const {raw} = s.signIn();
  assert.match(raw, new RegExp(`^${IDE_COOKIE}=jide_`));
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(raw.includes(flag), flag);
  const nova = s.registry.invite('laptop', 'nova');
  assert.equal(s.run({method: 'POST', path: '/ide-auth/pair', body: {code: nova.code}}).status, 401);
  const {key} = s.registry.add('laptop', 'nova');
  assert.equal(s.run({path: '/api/x', headers: {cookie: `${IDE_COOKIE}=${key}`}}).status, 401);
});

test('a signed-in session reaches the IDE, changes need the IDE origin, and commands stay local', t => {
  const s = setup(t);
  const {cookie} = s.signIn();
  const read = s.run({path: '/api/aura/workbench', headers: {cookie}});
  assert.equal(read.passed, true);
  assert.equal(read.req.ideSession.name, 'telefon');
  assert.equal(s.run({method: 'POST', path: '/api/connected/goals', headers: {cookie}}).status, 403);
  assert.equal(s.run({method: 'POST', path: '/api/connected/goals', headers: {cookie, origin: 'https://evil.example'}}).status, 403);
  assert.equal(s.run({method: 'POST', path: '/api/connected/goals', headers: {cookie, origin: `https://${HOST}`}}).passed, true);
  for (const p of ['/api/terminal/exec', '/API/Terminal/exec', '/api/termux/execute', '/api/openclaw/execute', '/api/plans/p1/step/execute-live', '//api//terminal/exec']) {
    const r = s.run({method: 'POST', path: p, headers: {cookie, origin: `https://${HOST}`, authorization: 'Bearer x'}});
    assert.equal(r.status, 403, p);
    assert.equal(r.body.error, 'TERMINAL_LOCAL_ONLY', p);
  }
  assert.ok(!COMMAND_ROUTES.test('/api/aura/workbench/skills/x/run'));
});

test('revoking the IDE device ends the session; sign-in attempts are limited per address', t => {
  const s = setup(t);
  const {cookie} = s.signIn();
  s.registry.revoke('telefon', 'ide');
  assert.equal(s.run({path: '/api/aura/workbench', headers: {cookie}}).status, 401);
  for (let i = 0; i < 10; i++) s.run({method: 'POST', path: '/ide-auth/pair', body: {code: 'AAAAA-AAAAA'}, headers: {'cf-connecting-ip': '198.51.100.9'}});
  assert.equal(s.run({method: 'POST', path: '/ide-auth/pair', body: {code: 'AAAAA-AAAAA'}, headers: {'cf-connecting-ip': '198.51.100.9'}}).status, 429);
});

test('WebSocket upgrades through the tunnel need the session and the IDE origin', t => {
  const s = setup(t);
  const {cookie} = s.signIn();
  const base = {host: HOST, 'cf-connecting-ip': '203.0.113.7'};
  assert.equal(upgradeAllowed({headers: {host: '127.0.0.1:3000'}}, s.registry, env), true);
  assert.equal(upgradeAllowed({headers: base}, s.registry, env), false);
  assert.equal(upgradeAllowed({headers: {...base, cookie, origin: 'https://evil.example'}}, s.registry, env), false);
  assert.equal(upgradeAllowed({headers: {...base, cookie, origin: `https://${HOST}`}}, s.registry, env), true);
});
