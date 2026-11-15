import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const runtime = path.join(root, 'runtime');

// The desktop router is TypeScript; run the scenario through the runtime's own tsx loader.
function scenario(workspace) {
  const code = `
import express from 'express';
import { createDesktopRouter } from './src/server/desktop/router.ts';
const app = express(); app.use(express.json());
const write = (req, res, next) => req.get('x-interface') === '1' ? next() : res.status(403).json({ success: false, error: 'INTERFACE_REQUIRED' });
app.use('/d', createDesktopRouter(${JSON.stringify(workspace)}, ${JSON.stringify(runtime)}, (_q, s) => s.status(401).end(), undefined, { read: (_q, _s, n) => n(), write }));
const server = app.listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + server.address().port + '/d/operator/grant';
  const post = (body, iface = true) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', ...(iface ? { 'x-interface': '1' } : {}) }, body: JSON.stringify(body) }).then(async r => [r.status, await r.json()]);
  const out = {};
  out.initial = await fetch(base).then(r => r.json());
  out.noInterface = await post({ enabled: true, processes: ['code'], minutes: 30 }, false);
  out.tooLong = await post({ enabled: true, processes: ['code'], minutes: 999 });
  out.blocked = await post({ enabled: true, processes: ['keepass'], minutes: 30 });
  out.granted = await post({ enabled: true, processes: ['Code.exe'], minutes: 30 });
  out.afterGrant = await fetch(base).then(r => r.json());
  out.revoked = await post({ enabled: false });
  console.log(JSON.stringify(out)); server.close();
});`;
  const run = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { cwd: runtime, encoding: 'utf8', timeout: 60_000 });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout.trim().split('\n').pop());
}

test('the operator grants and revokes desktop control from the interface, within the server limits', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-desktop-grant-'));
  try {
    const r = scenario(workspace);
    assert.equal(r.initial.grant.enabled, false, 'off until the operator allows it');
    assert.equal(r.noInterface[0], 403, 'a request without the interface guard cannot grant');
    assert.equal(r.tooLong[0], 400);
    assert.match(r.blocked[1].error, /can never be granted/, 'credential programs stay out of reach');
    assert.equal(r.granted[0], 200);
    assert.deepEqual(r.granted[1].grant.allowed_processes, ['code']);
    assert.equal(r.granted[1].grant.allow_value_set, false, 'typing is off unless asked for');
    assert.ok(Date.parse(r.granted[1].grant.expires_at) - Date.now() <= 30 * 60_000 + 5000);
    assert.equal(r.afterGrant.grant.enabled, true);
    assert.equal(r.revoked[1].grant.enabled, false);
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
});

test('a refused surface action reaches the planner with its reason, not only the HTTP status', () => {
  const source = fs.readFileSync(path.join(root, 'agents/hands-off-agent.mjs'), 'utf8');
  assert.match(source, /result\.receipt\?\.refusal \|\| result\.receipt\?\.error/);
  assert.match(fs.readFileSync(path.join(runtime, 'src/server/desktop/desktopHandsOff.ts'), 'utf8'), /operator gives one under Devices > Windows desktop control/);
});
