import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DEFAULT_DESKTOP_PROCESSES, MAX_GRANT_MS, browserGrantRequest, desktopGrantRequest, renewStandingGrants } from '../../runtime/src/server/desktop/grantAtStart.mjs';

const NOW = Date.parse('2026-11-21T20:00:00.000Z');

// Operator standing instruction, repeated 2026-11-21: the tools are on when JACO activates and the operator
// switches off what they do not want. No grant.json had ever been written on the host, so Aura could read
// the desktop but never act on it until someone opened the UI.
test('the standing grant is renewed at activation and the operator can switch each surface off', () => {
  const desktop = desktopGrantRequest({}, NOW);
  assert.equal(desktop.enabled, true);
  assert.deepEqual(desktop.allowed_processes, [...DEFAULT_DESKTOP_PROCESSES]);
  assert.equal(Date.parse(desktop.expires_at) - NOW, MAX_GRANT_MS, 'renewed to the ceiling, never past it');
  assert.deepEqual(desktopGrantRequest({ JACO_DESKTOP_GRANT_PROCESSES: 'code, chrome ,notepad' }, NOW).allowed_processes, ['code', 'chrome', 'notepad']);
  assert.equal(desktopGrantRequest({ JACO_DESKTOP_GRANT_AT_START: '0' }, NOW), null, 'the operator switches it off');

  // The browser acts only on origins the operator already listed; none listed means nothing to grant.
  assert.equal(browserGrantRequest({}, NOW), null);
  const browser = browserGrantRequest({ JACO_BROWSER_ALLOWED_ORIGINS: 'https://example.test' }, NOW);
  assert.deepEqual(browser.allowed_origins, ['https://example.test']);
  assert.equal(browser.scope_mode, 'allowlist');
  assert.equal(browserGrantRequest({ JACO_BROWSER_ALLOWED_ORIGINS: 'https://example.test', JACO_BROWSER_GRANT_AT_START: '0' }, NOW), null);
});

test('typing into a field stays an explicit choice, because that is how text reaches a password box', () => {
  assert.equal(desktopGrantRequest({}, NOW).allow_value_set, false);
  assert.equal(desktopGrantRequest({ JACO_DESKTOP_GRANT_VALUE_SET: '1' }, NOW).allow_value_set, true);
  const origins = { JACO_BROWSER_ALLOWED_ORIGINS: 'https://example.test' };
  assert.equal(browserGrantRequest(origins, NOW).allow_value_set, false);
  assert.equal(browserGrantRequest({ ...origins, JACO_BROWSER_GRANT_VALUE_SET: '1' }, NOW).allow_value_set, true);
  // Everything else Aura needs to drive an app is on, as the operator asked.
  for (const key of ['allow_invoke', 'allow_toggle', 'allow_select', 'allow_scroll']) assert.equal(desktopGrantRequest({}, NOW)[key], true, key);
});

test('renewal goes through the surface contract: it automates the decision, it never widens it', () => {
  const seen = [];
  const desktop = { isSupported: () => true, configureGrant(input) { seen.push(input); return { ...input }; } };
  const result = renewStandingGrants({ desktop, env: {}, now: NOW });
  assert.equal(result.applied.find(a => a.surface === 'desktop').state, 'ACTIVE');
  assert.equal(seen.length, 1, 'the surface validates the request, this module does not bypass it');
  // Never a default that the surface would have to reject: credential and logon surfaces are not requested.
  const blocked = /export const BLOCKED_PROCESSES = \[([\s\S]*?)\];/.exec(require$('runtime/src/server/desktop/desktopHandsOff.ts'))[1]
    .split(',').map(v => v.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.ok(blocked.includes('lsass') && blocked.includes('1password'), 'the blocked list was read');
  for (const name of seen[0].allowed_processes) assert.equal(blocked.includes(name), false, name);

  // A surface that refuses is reported as refused. No weaker retry: a refusal is the contract working.
  const refusing = { isSupported: () => true, configureGrant() { throw new Error("'keepass' is a credential or system-security surface and can never be granted"); } };
  const refused = renewStandingGrants({ desktop: refusing, env: {}, now: NOW }).applied.find(a => a.surface === 'desktop');
  assert.equal(refused.state, 'REFUSED');
  assert.match(refused.reason, /credential or system-security surface/);

  // A host without the surface is not an error, and switching it off is reported plainly.
  assert.equal(renewStandingGrants({ desktop: { isSupported: () => false, configureGrant() { assert.fail('must not grant'); } }, env: {}, now: NOW }).applied[0].state, 'UNSUPPORTED');
  assert.equal(renewStandingGrants({ desktop, env: { JACO_DESKTOP_GRANT_AT_START: '0' }, now: NOW }).applied[0].state, 'OFF_BY_OPERATOR');
  assert.deepEqual(renewStandingGrants({ env: {}, now: NOW }).applied, [], 'no surface, nothing claimed');
});

test('the runtime renews the grant at activation', () => {
  const server = require$('runtime/server.ts');
  assert.match(server, /import \{ renewStandingGrants \} from "\.\/src\/server\/desktop\/grantAtStart\.mjs"/);
  assert.match(server, /renewStandingGrants\(\{\s*\n\s*desktop: desktopHandsOff,/);
});

test('the browser grant is renewed when a page is attached, from the operator\'s listed origins only', () => {
  const seen = [];
  const browser = { configureGrant(input) { seen.push(input); return { ...input }; } };
  const env = { JACO_BROWSER_ALLOWED_ORIGINS: 'http://127.0.0.1:3000, https://remotedesktop.google.com' };
  const result = renewStandingGrants({ browser, env, now: NOW });
  assert.equal(result.applied.find(a => a.surface === 'browser').state, 'ACTIVE');
  assert.deepEqual(seen[0].allowed_origins, ['http://127.0.0.1:3000', 'https://remotedesktop.google.com']);
  assert.equal(seen[0].scope_mode, 'allowlist');
  assert.equal(seen[0].allow_value_set, false, 'typing stays an explicit choice');
  // Nothing listed: nothing is granted and nothing is claimed.
  assert.deepEqual(renewStandingGrants({ browser, env: {}, now: NOW }).applied, [{ surface: 'browser', state: 'OFF_BY_OPERATOR' }]);
  // The runtime wires it where the client comes into existence.
  const router = require$('runtime/src/server/browser/router.ts');
  assert.match(router, /renewStandingGrants\(\{ browser: nextClient/);
});

function require$(rel) {
  return fs.readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');
}
