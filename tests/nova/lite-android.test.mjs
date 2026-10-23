import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const source = new URL('../../lite/START-ANDROID.sh', import.meta.url);

function fixture(t, { platform = 'android', running = false, listener = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-lite-android-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const install = path.join(tmp, 'install');
  const home = path.join(tmp, 'home');
  const bin = path.join(tmp, 'bin');
  const prefix = path.join(tmp, 'prefix');
  for (const dir of [install, home, bin, path.join(prefix, 'var/service/jaco-core')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.copyFileSync(source, path.join(install, 'START-ANDROID.sh'));
  fs.writeFileSync(path.join(install, 'start.mjs'), 'throw new Error("should not run");\n');
  fs.writeFileSync(path.join(install, 'release.json'), JSON.stringify({ platform }));
  const stub = (name, body) => fs.writeFileSync(path.join(bin, name), '#!/bin/sh\n' + body + '\n', { mode: 0o755 });
  stub('pkg', 'exit 0');
  // Node's real parser and native node:sqlite must pass; only the final IDE start
  // is intercepted so no server, user process or network port is touched.
  stub('node', [
    'if [ "$1" = "$MOCK_START" ]; then',
    '  printf "ANDROID_BOOT"',
    '  for a in "$@"; do printf " <%s>" "$a"; done',
    '  printf "\\n"; exit 0',
    'fi',
    'exec "$REAL_NODE" "$@"',
  ].join('\n'));
  stub('sv', 'if [ "$MOCK_SV_RUNNING" = 1 ]; then echo "run: jaco-core: (pid 123) 1s"; else echo "down: jaco-core: 0s"; fi');
  stub('curl', 'if [ "$MOCK_JACO_LISTENER" = 1 ]; then printf \'{"success":true,"product":"JACO Autonomus IDE"}\\n\'; exit 0; fi; exit 7');
  const env = {
    ...process.env,
    HOME: home,
    PREFIX: prefix,
    TERMUX_VERSION: '1',
    PATH: bin + ':' + process.env.PATH,
    REAL_NODE: process.execPath,
    MOCK_START: path.join(install, 'start.mjs'),
    MOCK_SV_RUNNING: running ? '1' : '0',
    MOCK_JACO_LISTENER: listener ? '1' : '0',
  };
  return {
    run: (...args) => spawnSync('bash', [path.join(install, 'START-ANDROID.sh'), ...args], {
      env, encoding: 'utf8', timeout: 10000,
    }),
  };
}

test('Android package boots one existing Lite owner and preserves CLI options', t => {
  const r = fixture(t).run('--port', '3100');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ANDROID_BOOT/);
  assert.match(r.stdout, /<--port> <3100>/);
  assert.match(r.stdout, /<--no-open>/);
  assert.match(r.stdout, /LiteRT registry: not ready/);
});

test('Android package refuses the Windows edition', t => {
  const r = fixture(t, { platform: 'windows' }).run();
  assert.equal(r.status, 3);
  assert.match(r.stderr, /install the Android edition/);
  assert.doesNotMatch(r.stdout, /ANDROID_BOOT/);
});

test('Android package refuses overlapping full runit services', t => {
  const r = fixture(t, { running: true }).run();
  assert.equal(r.status, 35);
  assert.match(r.stderr, /Full JACO jaco-core is running/);
  assert.doesNotMatch(r.stdout, /ANDROID_BOOT/);
});

test('Android package refuses an unmanaged existing IDE without killing it', t => {
  const r = fixture(t, { listener: true }).run();
  assert.equal(r.status, 35);
  assert.match(r.stderr, /already owns port 3000/);
});

test('Android launcher never adds a second supervisor or global kill', () => {
  const script = fs.readFileSync(source, 'utf8');
  assert.doesNotMatch(script, /\b(?:pkill|killall|nohup|runsvdir)\b/);
  assert.match(script, /exec node "\$DIR\/start\.mjs" "\$PROJECT" --no-open "\$@"/);
});
