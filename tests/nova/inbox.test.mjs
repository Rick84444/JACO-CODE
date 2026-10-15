// Operator 2026-10-03: JACO gets past e-mail verification on its own, through its own inbox.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { verifySignature, parseMessage, extractVerification, storeMessage, readInbox, isJacoAddress } = await import('../../agents/lib/inbox.mjs');
const { takeHeld } = await import('../../agents/lib/secret-capture.mjs');

const raw = [
  'From: =?UTF-8?B?U21pdGhlcnk=?= <noreply@smithery.ai>',
  'Subject: Verify your email',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="b1"',
  '',
  '--b1',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Your verification code is 482913.=0AOr open https://smithery.ai/verify?token=3Dabc',
  '--b1',
  'Content-Type: text/html',
  '',
  '<p>ignored when plain text exists</p>',
  '--b1--',
].join('\r\n');

test('signed delivery only; MIME, encoded words and quoted-printable are decoded', () => {
  const body = JSON.stringify({ to: 'jaco-smithery@mimirpower.com', raw });
  const sig = crypto.createHmac('sha256', 's3cret').update(body).digest('hex');
  assert.equal(verifySignature(body, sig, 's3cret'), true);
  assert.equal(verifySignature(body, sig, 'other'), false);
  assert.equal(verifySignature(body, 'nothex', 's3cret'), false);
  assert.equal(verifySignature(body, sig, ''), false, 'no secret configured, nothing accepted');
  const m = parseMessage(raw);
  assert.equal(m.subject, 'Verify your email');
  assert.match(m.from, /^Smithery </);
  assert.equal(m.text, 'Your verification code is 482913.\nOr open https://smithery.ai/verify?token=abc');
  assert.deepEqual(extractVerification(m.text), { codes: ['482913'], links: ['https://smithery.ai/verify?token=abc'] });
  assert.deepEqual(extractVerification(parseMessage('Content-Type: text/html\r\n\r\n<a href="https://x.test/confirm?t=1">Confirm</a> kod: 1234').text), { codes: ['1234'], links: ['https://x.test/confirm?t=1'] });
});

test('only jaco addresses are stored; reads are recent and newest first', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-inbox-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { JACO_WORKSPACE_ROOT: dir, JACO_INBOX_DOMAIN: 'mimirpower.com' };
  assert.equal(isJacoAddress('jaco+gh@mimirpower.com', env), true);
  assert.equal(isJacoAddress('dick@mimirpower.com', env), false);
  assert.equal(storeMessage({ to: 'dick@mimirpower.com', raw }, env).stored, false);
  const now = Date.parse('2026-10-03T20:00:00Z');
  storeMessage({ to: 'jaco-smithery@mimirpower.com', raw, receivedAt: '2026-10-03T19:50:00Z' }, env, now);
  storeMessage({ to: 'jaco-other@mimirpower.com', raw: 'Subject: hi\r\n\r\nhello', receivedAt: '2026-10-03T19:55:00Z' }, env, now);
  storeMessage({ to: 'jaco-old@mimirpower.com', raw, receivedAt: '2026-10-03T17:00:00Z' }, env, now);
  assert.deepEqual(readInbox({ sinceMinutes: 60 }, env, now).map(m => m.to), ['jaco-other@mimirpower.com', 'jaco-smithery@mimirpower.com']);
  const [m] = readInbox({ to: 'JACO-SMITHERY@mimirpower.com' }, env, now);
  assert.deepEqual([m.subject, m.codes], ['Verify your email', ['482913']]);
});

test('Nova sees verification codes only as handles', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-inbox-nova-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); delete process.env.JACO_WORKSPACE_ROOT; });
  process.env.JACO_WORKSPACE_ROOT = dir;
  storeMessage({ to: 'jaco-smithery@mimirpower.com', raw, receivedAt: new Date().toISOString() });
  const { executeTask } = await import('../../agents/hands-off-agent.mjs');
  const r = await executeTask({ type: 'email-inbox', data: { to: 'jaco-smithery@mimirpower.com' } }, {}, null);
  assert.equal(r.count, 1);
  const [msg] = r.messages;
  assert.match(msg.codes[0], /^secret:[0-9a-f]{12}$/);
  assert.ok(!JSON.stringify(r).includes('482913'), 'the code itself never appears');
  assert.equal(takeHeld(msg.codes[0]), '482913');
});
