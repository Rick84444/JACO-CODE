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

test('Git fast-forward reloads changed upgrade entrypoint before the old takeover code can run', t => {
  const {remote, working} = fixture(t);
  const relative = 'tools/upgrade-aura-termux.sh';
  const remoteScript = path.join(remote, relative);
  fs.mkdirSync(path.dirname(remoteScript), {recursive:true});
  fs.writeFileSync(remoteScript, '#!/usr/bin/env bash\necho OLD > "$JACO_TEST_REEXEC_RECEIPT"\n');
  git(remote, 'add', relative);
  git(remote, 'commit', '-qm', 'old entrypoint');
  git(working, 'fetch', '--no-tags', 'origin', 'main');
  git(working, 'merge', '--ff-only', 'FETCH_HEAD');

  fs.writeFileSync(remoteScript, '#!/usr/bin/env bash\nprintf "new-entrypoint\\n" > "$JACO_TEST_REEXEC_RECEIPT"\n');
  git(remote, 'add', relative);
  git(remote, 'commit', '-qm', 'new entrypoint');

  const start=at('PRE_UPDATE_HEAD="$(git -C "$ROOT" rev-parse HEAD)"');
  const end=at('[[ -f "$ROOT/runtime/src/components/CognitiveWorkspace.tsx" ]]');
  assert(start>0 && end>start, 'self-reload must be in the Git-update segment');
  const block=source.slice(start,end);
  const receipt=path.join(path.dirname(working),'reexec-receipt');
  const backup=path.join(path.dirname(working),'upgrade-backup');
  fs.mkdirSync(backup, {recursive:true});
  const shell = `set -Eeuo pipefail
say(){ :; }
fail(){ echo "BLOCKED: $*" >&2; exit 1; }
${block}
printf "old-control-flow\\n" >> "$JACO_TEST_REEXEC_RECEIPT"`;
  const run=spawnSync('bash',['-c',shell],{
    encoding:'utf8',
    env:{...process.env,ROOT:working,BACKUP:backup,JACO_TEST_REEXEC_RECEIPT:receipt},
    timeout:15000,
  });
  assert.equal(run.status,0,run.stderr);
  assert.equal(fs.readFileSync(receipt,'utf8').trim(),'new-entrypoint',
    'old in-memory script must be replaced by the new script before service takeover');
  assert.equal(git(working,'rev-parse','HEAD'),git(remote,'rev-parse','HEAD'));
});

test('Aura is built before any process takeover', () => {
  assert.match(source, /Expected mobile Aura navigation is missing from source/);
  assert.match(source, /node scripts\/ensure_rollup_native\.mjs/);
  assert.match(source, /npm run build:termux/);
  assert.match(source, /dist\/\.jaco-ui-source\.sha256/);
  assert(at('npm run build:termux') < at('bash "$RUNTIME/bin/jacoctl" restart'));
  assert.doesNotMatch(source, /touch "\$SVDIR\/\$svc\/down"/);
});

test('service takeover is solely owned by the canonical supervisor', () => {
  assert.match(source, /bash "\$RUNTIME\/bin\/jacoctl" restart/);
  assert.doesNotMatch(source, /service-daemon\.pid\.stale|service-daemon start|Port \$port still serves health/);
  const commands = source.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
  assert.doesNotMatch(commands, /\bpkill\b|\bkillall\b|\bkill -KILL\b|\bkill -TERM\b/);
});

test('fast upgrade checks exact Core identity and GUI without claiming full readiness', () => {
  assert.match(source, /bash "\$RUNTIME\/bin\/jacoctl" restart --fast/);
  assert.match(source, /bash "\$RUNTIME\/bin\/jacoctl" status/);
  assert.match(source, /readiness=STARTING/);
  assert.match(source, /model\/SEER\/Durable Nova not yet READY/);
  assert.match(source, /live\.releaseId!==release\.releaseId/);
  assert.match(source, /http_code.*200/);
});

test('fast startup bypasses model waits but requires canonical ownership and retains strict READY', () => {
  const ctl = fs.readFileSync(path.join(root, 'runtime/bin/jacoctl'), 'utf8');
  assert.match(ctl, /--fast\) FAST=true/);
  assert.match(ctl, /wait_workplace_owner 10/);
  assert.match(ctl, /svc_owner_matches_checkout "\$WORKPLACE_SERVICE"/);
  assert.match(ctl, /wait_core_truth_ready/);
  assert.match(ctl, /if workplace_running; then[\s\S]*emit READY[\s\S]*emit STARTING/);
  assert.match(ctl, /status\)[\s\S]*sentinel_truth_ready && core_truth_ready && workplace_running/);
  assert.doesNotMatch(ctl, /killall node|pkill node/);
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
  const backup = path.join(path.dirname(working), 'upgrade-backup');
  fs.mkdirSync(backup,{recursive:true});
  return spawnSync('bash', ['-c', script], {encoding:'utf8', env:{...process.env, ROOT:working, BACKUP:backup}});
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

test('unique local main commits are preserved under a Git tag before switching', t => {
  const {remote,working} = fixture(t);
  const base = git(working,'rev-parse','HEAD');
  fs.writeFileSync(path.join(working,'local-main.txt'), 'keep');
  git(working,'add','local-main.txt');
  git(working,'commit','-qm','local-main-unique');
  const originalMain = git(working,'rev-parse','HEAD');
  git(working,'switch','-qc','temporary-work',base);
  const latest = advanceRemote(remote);
  const result=runGitUpgradeSegment(working);
  assert.equal(result.status,0,result.stderr);
  assert.equal(git(working,'branch','--show-current'),'main');
  assert.equal(git(working,'rev-parse','main'),latest);
  const tags=git(working,'tag','--list','jaco-main-before-aura-*').split(String.fromCharCode(10));
  assert.equal(tags.length,1);
  assert.equal(git(working,'rev-parse',tags[0]),originalMain);
  const receipt=fs.readFileSync(path.join(path.dirname(working),'upgrade-backup/preserved-local-main.txt'),'utf8');
  assert.match(receipt,/Original local main:/);
  assert(receipt.includes(originalMain));
});

test('main checked out in another worktree is never rewritten', t => {
  const {remote,working} = fixture(t);
  const base=git(working,'rev-parse','HEAD');
  fs.writeFileSync(path.join(working,'local-main.txt'),'keep');
  git(working,'add','local-main.txt');
  git(working,'commit','-qm','local-main-unique');
  const originalMain=git(working,'rev-parse','main');
  git(working,'switch','-qc','temporary-work',base);
  git(working,'worktree','add','-q',path.join(path.dirname(working),'other'),'main');
  advanceRemote(remote);
  const result=runGitUpgradeSegment(working);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Cannot update local main/);
  assert.equal(git(working,'branch','--show-current'),'temporary-work');
  assert.equal(git(working,'rev-parse','main'),originalMain);
  const tags=git(working,'tag','--list','jaco-main-before-aura-*').split(String.fromCharCode(10));
  assert.equal(tags.length,1);
  assert.equal(git(working,'rev-parse',tags[0]),originalMain);
});

test('divergent main backup happens before any local branch ref is changed', () => {
  assert(source.includes('Preserved local main commit'));
  assert(source.includes('preserved-local-main.txt'));
  assert(source.includes('git -C "$ROOT" tag "$SAVED_MAIN_TAG" "$OLD_MAIN"'));
  assert(at('git -C "$ROOT" tag "$SAVED_MAIN_TAG" "$OLD_MAIN"') < at('git -C "$ROOT" branch -f main FETCH_HEAD'));
  assert(!source.includes('git reset --hard'));
});
