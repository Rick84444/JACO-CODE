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

test('non-main upgrade is guarded and switches only after lockfile backup', () => {
  assert.match(source, /merge-base --is-ancestor HEAD FETCH_HEAD/);
  assert.match(source, /merge-base --is-ancestor main FETCH_HEAD/);
  assert.match(source, /git -C "\$ROOT" switch main/);
  assert.match(source, /git -C "\$ROOT" switch -c main --track origin\/main/);
  assert(at('stash push') < at('git -C "$ROOT" switch main'));
  assert.doesNotMatch(source, /git -C "\$ROOT" switch -[fC]/);
});

function git(cwd, ...args) {
  const result = spawnSync('git', ['-C', cwd, ...args], {encoding:'utf8'});
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function fixture(t) {
  const os = requireOs();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-aura-git-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const remote = path.join(dir, 'remote');
  const working = path.join(dir, 'working');
  fs.mkdirSync(remote);
  git(remote, 'init', '-q', '-b', 'main');
  git(remote, 'config', 'user.name', 'JACO regression');
  git(remote, 'config', 'user.email', 'test@example.invalid');
  fs.writeFileSync(path.join(remote, 'README.md'), 'base\n');
  git(remote, 'add', '.');
  git(remote, 'commit', '-qm', 'base');
  git(dir, 'clone', '-q', '--branch', 'main', remote, working);
  git(working, 'config', 'user.name', 'JACO regression');
  git(working, 'config', 'user.email', 'test@example.invalid');
  return {remote, working};
}

function requireOs() {
  return osModule;
}

const osModule = await import('node:os').then(m => m.default);

function advanceRemote(remote) {
  fs.appendFileSync(path.join(remote,'README.md'), 'remote-next\n');
  git(remote, 'add', '.');
  git(remote, 'commit', '-qm', 'updated main');
  return git(remote, 'rev-parse', 'HEAD');
}

function runGitUpgradeSegment(working) {
  const start = at("say 'Fetching current main without overwriting local files.'");
  const end = at('TARGET="$(git -C "$ROOT" rev-parse HEAD)"');
  assert(start > 0 && end > start, 'source markers for Git update block must exist');
  const block = source.slice(start, end);
  const script = `set -Eeuo pipefail
say(){ :; }
fail(){ echo "BLOCKED: $*" >&2; exit 1; }
${block}`;
  return spawnSync('bash', ['-c', script], {encoding:'utf8', env:{...process.env, ROOT:working}});
}

test('safe temporary branch becomes canonical main via fast-forward', t => {
  const {remote, working} = fixture(t);
  const old = git(working,'rev-parse','HEAD');
  git(working,'switch','-qc','temporary-work');
  const latest = advanceRemote(remote);
  const result = runGitUpgradeSegment(working);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(working,'branch','--show-current'), 'main');
  assert.equal(git(working,'rev-parse','HEAD'), latest);
  assert.equal(git(working,'rev-parse','temporary-work'), old);
});

test('divergent temporary branch is preserved and upgrade stops', t => {
  const {remote, working} = fixture(t);
  git(working,'switch','-qc','independent-work');
  fs.writeFileSync(path.join(working,'my-work.txt'),'important');
  git(working,'add','my-work.txt');
  git(working,'commit','-qm','local-only');
  const customHead = git(working,'rev-parse','HEAD');
  advanceRemote(remote);
  const result = runGitUpgradeSegment(working);
  assert.notEqual(result.status, 0, 'non-fast-forward work must not be overwritten');
  assert.match(result.stderr, /outside fetched main/);
  assert.equal(git(working,'branch','--show-current'), 'independent-work');
  assert.equal(git(working,'rev-parse','HEAD'), customHead);
});

test('detached HEAD upgrades by switching to main if ancestry is safe', t => {
  const {remote,working} = fixture(t);
  git(working,'switch','--detach','HEAD');
  const latest = advanceRemote(remote);
  const result = runGitUpgradeSegment(working);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(working,'branch','--show-current'), 'main');
  assert.equal(git(working,'rev-parse','HEAD'),latest);
});

test('unique local main commits prevent automatic switch from temporary branch', t => {
  const {remote,working} = fixture(t);
  const base = git(working,'rev-parse','HEAD');
  fs.writeFileSync(path.join(working,'local-main.txt'), 'keep');
  git(working,'add','local-main.txt');
  git(working,'commit','-qm','local-main-unique');
  const originalMain = git(working,'rev-parse','HEAD');
  git(working,'switch','-qc','temporary-work',base);
  advanceRemote(remote);
  const result=runGitUpgradeSegment(working);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Local main contains commits outside fetched main/);
  assert.equal(git(working,'branch','--show-current'),'temporary-work');
  assert.equal(git(working,'rev-parse','main'),originalMain);
});
