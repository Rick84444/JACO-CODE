import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveSiteLogin, listSiteLogins, siteLoginFor, removeSiteLogin, approvedLoginOrigins, loginOrigin } from '../../agents/lib/site-logins.mjs';
import { hardDenied, inputAllowed } from '../../agents/lib/browser-scope.mjs';
import { signInSession } from '../../agents/lib/browser-input.mjs';
import { TASK_FIELDS } from '../../agents/lib/task-fields.mjs';

const tempEnv = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logins-'));
  return { env: { JACO_STATE_DIR: dir, JACO_SECRET_KEY: 'a'.repeat(64) }, dir };
};

test('a saved login keeps the password encrypted and never lists it', () => {
  const { env, dir } = tempEnv();
  try {
    saveSiteLogin({ site: 'forum.example.com', username: 'aura@jaco', password: 'S3cret-pass!' }, { env });
    assert.deepEqual(listSiteLogins({ env }).map(l => [l.origin, l.username]), [['https://forum.example.com', 'aura@jaco']]);
    for (const file of fs.readdirSync(dir)) assert.ok(!fs.readFileSync(path.join(dir, file), 'utf8').includes('S3cret-pass!'), `${file} holds the password in clear`);
    assert.equal(siteLoginFor('https://forum.example.com', { env }).password, 'S3cret-pass!');
    assert.ok(approvedLoginOrigins({ env }).has('https://forum.example.com'));
    assert.equal(removeSiteLogin('https://forum.example.com', { env }), true);
    assert.equal(siteLoginFor('https://forum.example.com', { env }), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('identity providers, payment services, private hosts and plain http cannot get a saved login', () => {
  for (const site of ['https://accounts.google.com', 'https://login.microsoftonline.com', 'https://www.paypal.com', 'https://app.bankid.com'])
    assert.throws(() => loginOrigin(site), /NOT_ALLOWED/);
  assert.throws(() => loginOrigin('http://forum.example.com'), /HTTPS/);
  assert.throws(() => loginOrigin('https://192.168.1.10'), /PRIVATE/);
});

test('a sign-in page opens only for an approved site; checkout, payment and OAuth stay closed', () => {
  const approved = new Set(['https://forum.example.com']);
  const env = { JACO_AURA_UNIFIED_RUNTIME: '1' };
  assert.equal(hardDenied('https://forum.example.com/login'), 'AUTH_OR_PAYMENT_SURFACE');
  assert.equal(hardDenied('https://forum.example.com/login', approved), null);
  assert.ok(inputAllowed('https://forum.example.com/signin', env, approved));
  assert.equal(hardDenied('https://other.example.com/login', approved), 'AUTH_OR_PAYMENT_SURFACE');
  for (const p of ['/checkout', '/payment', '/oauth/start', '/authorize']) assert.equal(hardDenied(`https://forum.example.com${p}`, approved), 'AUTH_OR_PAYMENT_SURFACE');
  assert.equal(hardDenied('https://accounts.google.com/signin', new Set(['https://accounts.google.com'])), 'AUTH_OR_PAYMENT_SURFACE');
});

// A page as the bridge sees it: the scan answers with the form state; typed text is recorded.
function fakePage(states) {
  const typed = []; const keys = []; let step = 0;
  const session = { send: async (method, params) => { if (method === 'Input.insertText') typed.push(params.text); if (method === 'Input.dispatchKeyEvent' && params.type === 'keyDown') keys.push(params.key); return {}; } };
  const evaluate = async (_s, script) => {
    if (script.includes("querySelectorAll('input')")) return states[Math.min(step++, states.length - 1)];
    if (script.includes('.focus()')) return true;
    return true;
  };
  const observe = async () => ({ url: 'https://forum.example.com/' + step, title: 'Forum' });
  return { session, evaluate, observe, typed, keys };
}

test('signing in types the saved details into the site, and the answer carries no credential', async () => {
  const page = fakePage([{ state: 'form', user: true, pass: true }, { state: 'none', user: false, pass: false }]);
  const result = await signInSession(page.session, { username: 'aura@jaco', password: 'S3cret-pass!' }, { evaluate: page.evaluate, observe: page.observe, settleMs: 0 });
  assert.equal(result.signedIn, true);
  assert.deepEqual(page.typed, ['aura@jaco', 'S3cret-pass!']);
  assert.ok(!JSON.stringify(result).includes('S3cret-pass!') && !JSON.stringify(result).includes('aura@jaco'));
});

test('a two-step sign-in gives the username first and the password on the next page', async () => {
  const page = fakePage([{ state: 'user-only', user: true, pass: false }, { state: 'form', user: false, pass: true }, { state: 'none' }]);
  const result = await signInSession(page.session, { username: 'u', password: 'p' }, { evaluate: page.evaluate, observe: page.observe, settleMs: 0 });
  assert.equal(result.signedIn, true);
  assert.deepEqual(page.typed, ['u', 'p']);
});

test('a CAPTCHA or a one-time code hands over to the operator before anything is typed', async () => {
  for (const state of ['captcha', 'otp']) {
    const page = fakePage([{ state }]);
    const result = await signInSession(page.session, { username: 'u', password: 'p' }, { evaluate: page.evaluate, observe: page.observe, settleMs: 0 });
    assert.equal(result.signedIn, false);
    assert.ok(result.operatorNeeded);
    assert.deepEqual(page.typed, []);
  }
});

test('a password still on the page after submit is reported as not signed in', async () => {
  const page = fakePage([{ state: 'form', user: true, pass: true }, { state: 'form', user: true, pass: true }]);
  const result = await signInSession(page.session, { username: 'u', password: 'wrong' }, { evaluate: page.evaluate, observe: page.observe, settleMs: 0 });
  assert.equal(result.signedIn, false);
  assert.equal(result.error, 'SIGN_IN_NOT_CONFIRMED');
});

test('the sign-in step takes no fields, so credentials never pass through a plan', () => {
  assert.deepEqual(TASK_FIELDS['browser-sign-in'], []);
});

test('the agent shell cannot approve a login or touch the budget or the secret store, not even in its sandbox', async () => {
  const { operatorApprovalCheck } = await import('../../agents/lib/operator-action-guard.mjs');
  for (const command of [
    'curl -X POST -H "Origin: http://127.0.0.1:3000" http://127.0.0.1:3000/api/aura/logins -d "{}"',
    'curl -X PATCH http://127.0.0.1:3000/api/aura/budget -d "{\\"monthlyCloudUsd\\":999}"',
    'cat ~/.jaco/site-logins.json', 'type %USERPROFILE%\.jaco\secret.key',
  ]) for (const sandbox of [false, true]) {
    const verdict = operatorApprovalCheck({ type: 'shell', data: { command } }, { sandbox });
    assert.match(String(verdict?.reason), /operator-only setting/, command);
  }
});
