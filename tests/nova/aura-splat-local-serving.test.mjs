import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {mountAuraSplatAssets, localOperatorOnly, AURA_SPLAT_ROUTE} from '../../runtime/src/server/auraLocalAssets.mjs';
import {auraSplatDir, parseInstallArgs, validateRightsNotice, validateHeadZipHeader, provenanceText, AURA_SPLAT_CONFIRM_FLAG} from '../../runtime/src/lib/auraSplatInstall.mjs';

const express = createRequire(import.meta.url)('express');
const NOTICE = 'I, the subject, license this likeness for local use in this runtime; signed 2026-11-27.';

// A runtime root with a photoreal bundle installed where the installer puts it, plus a public/ copy of a secret.
function fixture({legacy = false} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-splat-'));
  const dir = auraSplatDir(root);
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'avatarz.js'), 'export const ok = true;');
  fs.writeFileSync(path.join(dir, 'head.zip'), 'PK\u0003\u0004FACE');
  fs.writeFileSync(path.join(dir, '.hidden'), 'dot');
  fs.mkdirSync(path.join(root, 'public'), {recursive: true});
  fs.writeFileSync(path.join(root, 'public', 'index.txt'), 'public file');
  if (legacy) { fs.mkdirSync(path.join(root, 'public', 'aura-splat')); fs.writeFileSync(path.join(root, 'public', 'aura-splat', 'head.zip'), 'LEGACY-FACE'); }
  return root;
}
async function serve(root, {remoteSession = false, loopback = true} = {}) {
  const app = express();
  app.use((req, _res, next) => { if (remoteSession) req.ideSession = {name: 'remote'}; next(); });
  // Same behaviour as the server's requireLocalUi: ideSession passes, a proxied or non-loopback request does not.
  const requireLocalUi = (req, res, next) => (req.ideSession || (!req.headers['x-forwarded-for'] && loopback)) ? next() : res.status(403).json({error: 'LOCAL_UI_ONLY'});
  const info = mountAuraSplatAssets(app, {root, guard: requireLocalUi, serveStatic: express.static});
  app.use(express.static(path.join(root, 'public')));
  app.get('*', (_req, res) => res.type('html').send('<html>SPA</html>'));
  const server = await new Promise(r => { const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s)); });
  const get = (p, headers = {}) => new Promise((resolve, reject) => http.get({host: '127.0.0.1', port: server.address().port, path: p, headers}, res => {
    let body = ''; res.on('data', c => { body += c; }); res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body}));
  }).on('error', reject));
  return {get, info, close: () => new Promise(r => server.close(r))};
}

test('the installer target is outside public/, so express.static and the client build never see the face', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-splat-'));
  const rel = path.relative(path.join(root, 'public'), auraSplatDir(root));
  assert.ok(rel.startsWith('..'), rel);
});

test('the local operator gets the bundle with no-sniff and revalidation headers', async () => {
  const s = await serve(fixture());
  try {
    const r = await s.get(AURA_SPLAT_ROUTE + '/head.zip');
    assert.equal(r.status, 200); assert.ok(r.body.endsWith('FACE'));
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.match(r.headers['cache-control'], /private/);
    assert.equal((await s.get(AURA_SPLAT_ROUTE + '/avatarz.js')).status, 200);
  } finally { await s.close(); }
});

test('a proxied request and a signed-in remote IDE session are refused before any file is read', async () => {
  const root = fixture();
  const proxied = await serve(root);
  const remote = await serve(root, {remoteSession: true});
  try {
    const a = await proxied.get(AURA_SPLAT_ROUTE + '/head.zip', {'x-forwarded-for': '203.0.113.9'});
    assert.equal(a.status, 403); assert.ok(!a.body.includes('FACE'));
    const b = await remote.get(AURA_SPLAT_ROUTE + '/head.zip');
    assert.equal(b.status, 403); assert.ok(!b.body.includes('FACE'));
    // Same answer for a file that does not exist: no existence oracle.
    assert.equal((await remote.get(AURA_SPLAT_ROUTE + '/nothing.zip')).status, 403);
  } finally { await proxied.close(); await remote.close(); }
});

test('a missing bundle is a JSON 404, dotfiles and traversal are refused, and nothing falls through to the SPA', async () => {
  const s = await serve(fixture());
  const empty = await serve(fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-splat-empty-')));
  try {
    const missing = await empty.get(AURA_SPLAT_ROUTE + '/avatarz.js');
    assert.equal(missing.status, 404); assert.match(missing.body, /AURA_SPLAT_NOT_INSTALLED/); assert.ok(!missing.body.includes('SPA'));
    assert.equal((await s.get(AURA_SPLAT_ROUTE + '/.hidden')).status, 404);
    const up = await s.get(AURA_SPLAT_ROUTE + '/..%2f..%2fpublic%2findex.txt');
    assert.notEqual(up.status, 200); assert.ok(!up.body.includes('public file'));
  } finally { await s.close(); await empty.close(); }
});

test('a leftover public/aura-splat copy is not served at /aura-splat and is reported', async () => {
  const s = await serve(fixture({legacy: true}));
  try {
    assert.equal(s.info.legacyPublicCopy, true);
    const r = await s.get(AURA_SPLAT_ROUTE + '/head.zip');
    assert.ok(!r.body.includes('LEGACY-FACE'));
    assert.ok(r.body.endsWith('FACE'));
  } finally { await s.close(); }
});

test('negative control: the same face under public/ with the open static handler IS served to anyone', async () => {
  const root = fixture({legacy: true});
  const app = express(); app.use(express.static(path.join(root, 'public')));
  const server = await new Promise(r => { const x = http.createServer(app).listen(0, '127.0.0.1', () => r(x)); });
  try {
    const body = await new Promise(resolve => http.get({host: '127.0.0.1', port: server.address().port, path: '/aura-splat/head.zip', headers: {'x-forwarded-for': '203.0.113.9'}}, res => { let b = ''; res.on('data', c => { b += c; }); res.on('end', () => resolve(b)); }));
    assert.equal(body, 'LEGACY-FACE');
  } finally { await new Promise(r => server.close(r)); }
});

test('localOperatorOnly refuses a remote IDE session even when the base guard would allow it', () => {
  let status = 0, payload = null, passed = false;
  const res = {status(c) { status = c; return this; }, json(p) { payload = p; return this; }};
  localOperatorOnly(() => { passed = true; })({ideSession: {name: 'x'}}, res, () => { passed = true; });
  assert.equal(status, 403); assert.equal(payload.error, 'LOCAL_OPERATOR_REQUIRED'); assert.equal(passed, false);
});

test('install arguments: the likeness-rights flag is required and nothing else is accepted', () => {
  const ok = ['--head', 'a.zip', '--license', 'n.txt', AURA_SPLAT_CONFIRM_FLAG];
  assert.deepEqual(parseInstallArgs(ok), {head: 'a.zip', notice: 'n.txt'});
  assert.deepEqual(parseInstallArgs([AURA_SPLAT_CONFIRM_FLAG, '--license', 'n.txt', '--head', 'a.zip']), {head: 'a.zip', notice: 'n.txt'});
  assert.throws(() => parseInstallArgs(['--head', 'a.zip', '--license', 'n.txt']), /AURA_SPLAT_RIGHTS_CONFIRMATION_REQUIRED/);
  assert.throws(() => parseInstallArgs([...ok, '--extra']), /AURA_SPLAT_ARGS/);
  assert.throws(() => parseInstallArgs(['--head', '--license', 'n.txt', AURA_SPLAT_CONFIRM_FLAG]), /AURA_SPLAT_ARGS/);
  assert.throws(() => parseInstallArgs(['--head', 'a', '--head', 'b', '--license', 'n', AURA_SPLAT_CONFIRM_FLAG]), /AURA_SPLAT_ARGS/);
  assert.throws(() => parseInstallArgs([]), /AURA_SPLAT_ARGS/);
});

test('a rights notice must be real readable text, not an empty, binary or placeholder file', () => {
  assert.equal(validateRightsNotice(Buffer.from('  ' + NOTICE + '\n')), NOTICE);
  for (const bad of [Buffer.alloc(0), Buffer.from('x'), Buffer.from('ok'), Buffer.from('a '.repeat(10)), Buffer.from([0xff, 0xfe, 0x00, 0x41, 0x80]), Buffer.from(NOTICE + '\0')]) {
    assert.throws(() => validateRightsNotice(bad), /AURA_SPLAT_RIGHTS_NOTICE/);
  }
  assert.throws(() => validateRightsNotice(Buffer.alloc(1024 * 1024 + 1, 97)), /AURA_SPLAT_RIGHTS_NOTICE_SIZE/);
  // 40 characters but too few words
  assert.throws(() => validateRightsNotice(Buffer.from('a'.repeat(60))), /TOO_SHORT/);
});

test('head ZIP header check and provenance text', () => {
  assert.doesNotThrow(() => validateHeadZipHeader(Buffer.from([0x50, 0x4b, 0x03, 0x04]), 10));
  assert.throws(() => validateHeadZipHeader(Buffer.from('\xff\xd8\xff\xe0', 'latin1'), 10), /NOT_ZIP/);
  assert.throws(() => validateHeadZipHeader(Buffer.from([0x50, 0x4b, 0x03, 0x04]), 257 * 1024 * 1024), /HEAD_SIZE/);
  const text = provenanceText({rev: 'abc', headSha256: 'h'.repeat(64), noticeSha256: 'n'.repeat(64), at: '2026-11-27T00:00:00.000Z'});
  assert.match(text, /head sha256: h{64}/); assert.match(text, /statement, not verified legal clearance/);
});
