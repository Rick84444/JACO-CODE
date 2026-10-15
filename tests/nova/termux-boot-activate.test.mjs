import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve('runtime/termux/boot/10-jaco-auto-activate');

// Run the boot script with a stand-in jacoctl on PATH; resolves with what the stand-in saw.
async function boot({ config, withJacoctl = true }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-home-')), bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  const seen = path.join(home, 'jacoctl.args');
  if (withJacoctl) { fs.writeFileSync(path.join(bin, 'jacoctl'), `#!/bin/sh\necho "$@" > "${seen}"\necho '{"state":"READY"}'\n`); fs.chmodSync(path.join(bin, 'jacoctl'), 0o755); }
  const envFile = path.join(home, 'runtime.env');
  if (config != null) fs.writeFileSync(envFile, config);
  const run = spawnSync('sh', [SCRIPT], { env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, JACO_RUNTIME_ENV: envFile, JACO_BOOT_ACTIVATE_DELAY: '0' }, encoding: 'utf8' });
  // the activation runs in the background; give it a moment
  for (let i = 0; i < 40 && !fs.existsSync(seen); i++) await new Promise(r => setTimeout(r, 50));
  return { run, called: fs.existsSync(seen) ? fs.readFileSync(seen, 'utf8').trim() : null, log: (() => { try { return fs.readFileSync(path.join(home, '.jaco/logs/boot-activate.log'), 'utf8'); } catch { return ''; } })() };
}

test('the boot script is valid shell and executable', () => {
  assert.equal(spawnSync('sh', ['-n', SCRIPT]).status, 0);
  assert.ok(fs.statSync(SCRIPT).mode & 0o111, 'executable');
});
test('on demand stays the default: no config, or the flag off, activates nothing', async () => {
  assert.equal((await boot({ config: null })).called, null);
  assert.equal((await boot({ config: 'export JACO_AUTO_ACTIVATE=0\n' })).called, null);
  assert.equal((await boot({ config: 'export OTHER=1\n' })).called, null);
});
test('JACO_AUTO_ACTIVATE=1 runs jacoctl activate --profile full at boot and logs it', async () => {
  const r = await boot({ config: 'export JACO_AUTO_ACTIVATE=1\n' });
  assert.equal(r.run.status, 0);
  assert.equal(r.called, 'activate --profile full --json');
  assert.match(r.log, /jacoctl activate --profile full/);
  assert.match(r.log, /READY/);
});
test('requested but jacoctl missing: says so and does not fail the boot', async () => {
  const r = await boot({ config: 'export JACO_AUTO_ACTIVATE=1\n', withJacoctl: false });
  assert.equal(r.run.status, 0);
  assert.match(r.run.stderr, /jacoctl is not installed/);
});
