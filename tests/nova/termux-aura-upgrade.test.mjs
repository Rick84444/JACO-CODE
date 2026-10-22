import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const file = path.join(root, 'tools/upgrade-aura-termux.sh');
const source = fs.readFileSync(file, 'utf8');
const at = s => source.indexOf(s);

test('Termux upgrade script is valid bash', () => {
  const r = spawnSync('bash', ['-n', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('tracked changes are backed up before fast-forward; untracked files are retained', () => {
  assert.match(source, /branch --show-current/);
  assert.match(source, /remote get-url origin/);
  assert.match(source, /diff --cached --name-only/);
  assert.match(source, /Uncommitted tracked file requires manual review/);
  assert.match(source, /runtime-package-lock\.patch/);
  assert.match(source, /stash push/);
  assert.match(source, /merge --ff-only FETCH_HEAD/);
  assert.doesNotMatch(source, /\bgit\s+(reset|clean|push)\b/);
  assert(at('stash push') < at('merge --ff-only FETCH_HEAD'));
});

test('Aura is built before any process takeover', () => {
  assert.match(source, /Expected mobile Aura navigation is missing from source/);
  assert.match(source, /node scripts\/ensure_rollup_native\.mjs/);
  assert.match(source, /npm run build:termux/);
  assert.match(source, /dist\/\.jaco-ui-source\.sha256/);
  assert(at('npm run build:termux') < at('touch "$SVDIR/$svc/down"'));
  assert(at('npm run build:termux') < at('sv down "$SVDIR/$svc"'));
});

test('service takeover guards against duplicate instances and unrelated process kills', () => {
  assert.match(source, /service-daemon\.pid\.stale/);
  assert.match(source, /service-daemon start/);
  assert.match(source, /"\$RUNTIME\|"\*"server\.ts"/);
  assert.match(source, /"\$RUNTIME\/gateway\|"\*"src\/sentinel\.mjs"/);
  assert.match(source, /"\$ROOT\|"\*"gateway\/src\/workplace\/workplace-server\.mjs"/);
  assert.match(source, /kill -TERM/);
  assert.match(source, /Port \$port still serves health after stopping known owners/);
  const commands = source.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
  assert.doesNotMatch(commands, /\bpkill\b|\bkillall\b|\bkill -KILL\b/);
  assert(at('touch "$SVDIR/$svc/down"') < at('service-daemon start'));
});

test('requires READY, expected Core identity and HTTP 200 before success', () => {
  assert.match(source, /bash "\$RUNTIME\/bin\/jacoctl" activate/);
  assert.match(source, /bash "\$RUNTIME\/bin\/jacoctl" status/);
  assert(source.includes('JACO supervisor does not report READY.'));
  assert.match(source, /live\.releaseId!==release\.releaseId/);
  assert.match(source, /http_code.*200/);
});
