// lite/install.sh against a local release server: checksum refusal, update/rollback/prune, a downloaded Node.js
// checked against SHASUMS256, and uninstall. Needs sh, curl, unzip, tar and python3 (to make a zip); skipped elsewhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(root, 'lite', 'install.sh');
const tools = ['sh', 'curl', 'uname', 'mktemp', 'sed', 'tr', 'cut', 'grep', 'head', 'ls', 'mv', 'rm', 'ln', 'mkdir', 'chmod', 'cp', 'readlink', 'cat', 'date', 'tar', 'unzip', 'basename', 'sha256sum', 'dirname', 'printf', 'sleep', 'gzip'];
const where = name => spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
const missing = tools.filter(n => !where(n)).concat(spawnSync('python3', ['--version']).error ? ['python3'] : []);
const skip = process.platform === 'win32' ? 'POSIX installer' : missing.length ? `missing: ${missing.join(' ')}` : false;
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const NODE_OS = process.platform === 'darwin' ? 'darwin' : 'linux';
const NODE_ARCH = os.arch() === 'arm64' ? 'arm64' : 'x64';

function makeZip(dir, name, builtAt) {
  const top = path.join(dir, 'stage', name);
  fs.mkdirSync(top, { recursive: true });
  fs.writeFileSync(path.join(top, 'start.mjs'), `console.log('FAKE-LITE ' + process.argv.slice(2).join(' ') + ' built=${builtAt}');\n`);
  fs.writeFileSync(path.join(top, 'start.sh'), '#!/bin/sh\n'); fs.writeFileSync(path.join(top, 'START-ANDROID.sh'), '#!/bin/sh\n');
  const zip = path.join(dir, `${name}.zip`);
  assert.equal(spawnSync('python3', ['-m', 'zipfile', '-c', zip, top], { cwd: path.join(dir, 'stage') }).status, 0);
  return fs.readFileSync(zip);
}

async function release(t, { builtAt = '2026-10-13T10:00:00.000Z', tamper = false, unsafeFile = false, nodeSumOk = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-install-srv-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const zip = makeZip(dir, 'jaco-lite-fake', builtAt);
  const latest = { schema: 'jaco.lite-latest/v1', version: '9.9.9', builtAt, files: { universal: { file: unsafeFile ? '../evil.zip' : 'jaco-lite.zip', bytes: zip.length, sha256: sha(zip) }, windows: { file: 'jaco-lite-windows.zip', bytes: zip.length, sha256: sha(zip) } } };
  // a fake Node.js: a script named bin/node that accepts -e (version check) and --version
  const nodeDir = path.join(dir, 'nodepkg', `node-v24.0.0-${NODE_OS}-${NODE_ARCH}`, 'bin');
  fs.mkdirSync(nodeDir, { recursive: true });
  fs.writeFileSync(path.join(nodeDir, 'node'), '#!/bin/sh\ncase "$1" in -e) exit 0;; --version) echo v24.0.0;; *) echo "FAKE-NODE $*";; esac\n', { mode: 0o755 });
  const tgzName = `node-v24.0.0-${NODE_OS}-${NODE_ARCH}.tar.gz`;
  assert.equal(spawnSync('tar', ['-czf', path.join(dir, tgzName), '-C', path.join(dir, 'nodepkg'), `node-v24.0.0-${NODE_OS}-${NODE_ARCH}`]).status, 0);
  const tgz = fs.readFileSync(path.join(dir, tgzName));
  const files = {
    '/latest.json': JSON.stringify(latest, null, 2),
    '/jaco-lite.zip': tamper ? Buffer.concat([zip, Buffer.from('x')]) : zip,
    '/jaco-lite-windows.zip': tamper ? Buffer.concat([zip, Buffer.from('x')]) : zip,
    '/install.ps1': fs.readFileSync(path.join(root, 'lite', 'install.ps1')),
    '/install.sh': fs.readFileSync(SCRIPT),
    '/node/SHASUMS256.txt': `${nodeSumOk ? sha(tgz) : '0'.repeat(64)}  ${tgzName}\n`,
    [`/node/${tgzName}`]: tgz,
  };
  const server = http.createServer((req, res) => { const body = files[req.url]; if (!body) { res.statusCode = 404; return res.end(); } res.end(body); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}`, latest, files, setBuild(next) { Object.assign(files, next); } };
}

function jail(t, { withNode = true } = {}) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-install-bin-'));
  t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
  for (const n of [...tools, ...(withNode ? ['node'] : [])]) fs.symlinkSync(where(n) || process.execPath, path.join(bin, n));
  if (!withNode) fs.symlinkSync(where('python3'), path.join(bin, 'python3'));
  return bin;
}

function run(script, env, args = []) {
  return new Promise(resolve => {
    const child = spawn('sh', [script, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.on('close', code => resolve({ code, out, err }));
  });
}
const setup = (t, rel, extra = {}) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-install-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const bin = jail(t, extra);
  const env = { PATH: bin, HOME: home, TMPDIR: os.tmpdir(), JACO_LITE_BASE_URL: rel.url, JACO_LITE_INSTALL_URL: `${rel.url}/install.sh`, JACO_LITE_NODE_DIST_URL: `${rel.url}/node`,
    JACO_LITE_HOME: path.join(home, 'jl'), JACO_LITE_BIN_DIR: path.join(home, 'bin'), ...extra.env };
  return { home, env, jl: path.join(home, 'jl') };
};
const cmd = (file, args, env) => spawnSync(file, args, { env, encoding: 'utf8' });

test('install: checks the download, installs, adds the jaco-lite command, and the command starts, diagnoses and passes arguments', { skip }, async t => {
  const rel = await release(t), s = setup(t, rel);
  const r = await run(SCRIPT, s.env);
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /SHA-256 matches/);
  assert.ok(fs.existsSync(path.join(s.jl, 'current', 'start.mjs')));
  const info = JSON.parse(fs.readFileSync(path.join(s.jl, 'install.json'), 'utf8'));
  assert.equal(info.sha256, rel.latest.files.universal.sha256); assert.equal(info.version, '9.9.9');
  const link = path.join(s.home, 'bin', 'jaco-lite');
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  const started = cmd(link, ['--port', '3100'], { ...s.env, PATH: s.env.PATH });
  assert.match(started.stdout, /FAKE-LITE --port 3100 built=2026-10-13T10:00:00.000Z/);
  assert.equal(cmd(link, ['version'], s.env).stdout.trim(), '9.9.9');
  const doctor = cmd(link, ['doctor'], s.env);
  assert.match(doctor.stdout, /current build/); assert.match(doctor.stdout, /FAKE-LITE --check/);
  assert.match(r.out, /Start it in any project folder with|Start it with/);
});

test('install: a download that does not match latest.json is refused and nothing is installed', { skip }, async t => {
  const rel = await release(t, { tamper: true }), s = setup(t, rel);
  const r = await run(SCRIPT, s.env);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /does not match its SHA-256/);
  assert.equal(fs.existsSync(path.join(s.jl, 'current')), false);
  assert.equal(fs.existsSync(path.join(s.jl, 'install.json')), false);
});

test('install: an unsafe file name in latest.json is refused before anything is downloaded', { skip }, async t => {
  const rel = await release(t, { unsafeFile: true }), s = setup(t, rel);
  const r = await run(SCRIPT, s.env);
  assert.notEqual(r.code, 0); assert.match(r.err, /unsafe file/);
});

test('update: same build says up to date; a new build keeps the old one for rollback and removes older ones; rollback and uninstall work', { skip }, async t => {
  const rel = await release(t, { builtAt: '2026-10-13T10:00:00.000Z' }), s = setup(t, rel);
  assert.equal((await run(SCRIPT, s.env)).code, 0);
  const again = await run(SCRIPT, s.env);
  assert.match(again.out, /already up to date/);
  const launcher = path.join(s.jl, 'bin', 'jaco-lite');
  const build = async (stamp) => { // a newer release on the same server
    const next = await release(t, { builtAt: stamp });
    rel.setBuild({ '/latest.json': next.files['/latest.json'], '/jaco-lite.zip': next.files['/jaco-lite.zip'] });
  };
  await build('2026-10-14T10:00:00.000Z');
  const updated = await run(launcher, s.env, ['update']);
  assert.equal(updated.code, 0, updated.err + updated.out);
  assert.match(cmd(launcher, ['--x'], s.env).stdout, /built=2026-10-14/);
  assert.ok(fs.lstatSync(path.join(s.jl, 'previous')).isSymbolicLink());
  await build('2026-10-15T10:00:00.000Z');
  assert.equal((await run(launcher, s.env, ['update'])).code, 0);
  assert.deepEqual(fs.readdirSync(path.join(s.jl, 'versions')).sort(), ['2026-10-14T10-00-00-000Z'.replace('T', 'T'), '2026-10-15T10-00-00-000Z'].map(x => x), 'the oldest build was removed');
  assert.match(cmd(launcher, ['rollback'], s.env).stdout, /now on versions\/2026-10-14/);
  assert.match(cmd(launcher, ['--x'], s.env).stdout, /built=2026-10-14/);
  const gone = cmd(launcher, ['uninstall', '--yes'], s.env);
  assert.match(gone.stdout, /removed/);
  assert.equal(fs.existsSync(s.jl), false); assert.equal(fs.existsSync(path.join(s.home, 'bin', 'jaco-lite')), false);
});

test('install without Node.js: downloads the official build, checks it against SHASUMS256, and refuses a mismatch', { skip }, async t => {
  const ok = await release(t), s = setup(t, ok, { withNode: false });
  const r = await run(SCRIPT, s.env);
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /downloading the official Node.js LTS build/);
  assert.ok(fs.existsSync(path.join(s.jl, 'runtime', 'node', 'bin', 'node')));
  assert.match(cmd(path.join(s.home, 'bin', 'jaco-lite'), ['--x'], s.env).stdout, /FAKE-NODE .*start\.mjs --x/, 'the launcher uses the private Node.js');
  const bad = await release(t, { nodeSumOk: false }), b = setup(t, bad, { withNode: false });
  const refused = await run(SCRIPT, b.env);
  assert.notEqual(refused.code, 0); assert.match(refused.err, /does not match nodejs\.org's checksum/);
  assert.equal(fs.existsSync(path.join(b.jl, 'current')), false);
});

test('install: Windows and other systems are pointed to the right installer', { skip }, async t => {
  const rel = await release(t), s = setup(t, rel);
  const fakeUname = path.join(s.env.PATH, 'uname'); fs.rmSync(fakeUname); fs.writeFileSync(fakeUname, '#!/bin/sh\necho MINGW64_NT-10.0\n', { mode: 0o755 });
  const r = await run(SCRIPT, s.env);
  assert.notEqual(r.code, 0); assert.match(r.err, /install\.ps1/);
});

// The Windows installer runs under PowerShell 7 here (symbolic links stand in for junctions); the Windows runner in CI
// runs the real thing. Skipped without pwsh.
const pwsh = spawnSync('sh', ['-c', 'command -v pwsh'], { encoding: 'utf8' }).stdout.trim();
const skipPs = process.platform === 'win32' ? 'run on Linux/macOS' : !pwsh ? 'no pwsh' : false;
const runPs = (env, extra = {}) => new Promise(resolve => {
  const child = spawn(pwsh, ['-NoProfile', '-File', path.join(root, 'lite', 'install.ps1')], { env: { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1', JACO_LITE_NO_SHORTCUT: '1', JACO_LITE_NO_MODIFY_PATH: '1', ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; }); child.on('close', code => resolve({ code, out: out.replace(/\x1b\[[0-9;]*m/g, ''), err }));
});

test('install.ps1: installs from a checked download, keeps the real ISO build time, updates, rolls back and uninstalls', { skip: skipPs }, async t => {
  const rel = await release(t, { builtAt: '2026-10-13T10:00:00.000Z' });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-ps-')); t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const env = { HOME: home, JACO_LITE_HOME: path.join(home, 'jl'), JACO_LITE_BASE_URL: rel.url };
  const first = await runPs(env);
  assert.equal(first.code, 0, first.out + first.err);
  assert.match(first.out, /SHA-256 matches/);
  const info = fs.readFileSync(path.join(home, 'jl', 'install.json'), 'utf8');
  assert.match(info, /"builtAt": "2026-10-13T10:00:00.000Z"/, 'not a culture-formatted date');
  assert.deepEqual(fs.readdirSync(path.join(home, 'jl', 'versions')), ['2026-10-13T10-00-00-000Z']);
  assert.match((await runPs(env)).out, /already up to date/);
  const next = await release(t, { builtAt: '2026-10-14T10:00:00.000Z' });
  rel.setBuild({ '/latest.json': next.files['/latest.json'], '/jaco-lite-windows.zip': next.files['/jaco-lite-windows.zip'] });
  assert.equal((await runPs(env)).code, 0);
  assert.deepEqual(fs.readdirSync(path.join(home, 'jl', 'versions')).sort(), ['2026-10-13T10-00-00-000Z', '2026-10-14T10-00-00-000Z']);
  const back = await runPs(env, { JACO_LITE_ACTION: 'rollback' });
  assert.match(back.out, /now on .*2026-10-13T10-00-00-000Z/);
  const gone = await runPs(env, { JACO_LITE_ACTION: 'uninstall', JACO_LITE_YES: '1' });
  assert.match(gone.out, /removed/); assert.equal(fs.existsSync(path.join(home, 'jl')), false);
});

test('install.ps1: a download that does not match latest.json is refused and exits non-zero', { skip: skipPs }, async t => {
  const rel = await release(t, { tamper: true });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-ps-')); t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const r = await runPs({ HOME: home, JACO_LITE_HOME: path.join(home, 'jl'), JACO_LITE_BASE_URL: rel.url });
  assert.notEqual(r.code, 0);
  assert.match(r.out + r.err, /does not match its SHA-256/);
  assert.equal(fs.existsSync(path.join(home, 'jl', 'current')), false);
});
