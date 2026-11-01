import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createZip } from '../../tools/lib/zip.mjs';
import { buildWindowsInstaller, obtainGit, obtainNode, prepareWindowsPayload, verifyGitArchive, verifyNodeArchive } from '../../tools/build-windows-installer.mjs';
import { activatePayload, compareVersions, installationPipe, installAction, readCurrent, requestDesktop, verifyPayload } from '../../packaging/windows/install-state.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const commit = 'a'.repeat(40);
const compiler = process.env.MAKENSIS || 'makensis';
const compilerReady = spawnSync(compiler, ['-VERSION'], { encoding: 'utf8' }).status === 0;

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-setup-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

async function listenForTest(t, server, address) {
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(address, resolve); });
    return true;
  } catch (error) {
    if (process.platform !== 'win32' && ['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) {
      t.skip('This executor does not permit local sockets; run the real named-pipe check on Windows.');
      return false;
    }
    throw error;
  }
}

// Deliberately tiny PE and runtime fixtures exercise packaging checks; they are never distributed.
function nodeFixture(arch = 'x64') {
  const executable = Buffer.alloc(512);
  executable.write('MZ'); executable.writeUInt32LE(128, 0x3c); executable.write('PE\0\0', 128);
  executable.writeUInt16LE(arch === 'x64' ? 0x8664 : 0xaa64, 132);
  const filename = `node-v24.0.0-win-${arch}.zip`;
  const prefix = filename.slice(0, -4);
  const archive = createZip([{ name: `${prefix}/node.exe`, data: executable }, { name: `${prefix}/LICENSE`, data: 'Fixture license' },
    { name: `${prefix}/npm.cmd`, data: 'fixture npm' }, { name: `${prefix}/npx.cmd`, data: 'fixture npx' },
    { name: `${prefix}/node_modules/npm/bin/npm-cli.js`, data: '// fixture npm CLI' }]);
  const checksums = `${digest(archive)}  ${filename}\n`;
  return { archive, checksums, filename, ...verifyNodeArchive({ archive, checksums, filename, arch }) };
}

function gitFixture(arch = 'x64') {
  const filename = `MinGit-2.0.0-${arch === 'x64' ? '64-bit' : 'arm64'}.zip`;
  const archive = createZip([{ name: 'cmd/git.exe', data: nodeFixture(arch).executable }, { name: 'LICENSE.txt', data: 'fixture Git license' }]);
  return { archive, checksum: digest(archive), ...verifyGitArchive({ archive, checksum: digest(archive), filename, arch }) };
}

function gitOffline(directory) {
  const fixture = gitFixture();
  const gitArchivePath = path.join(directory, fixture.filename); fs.writeFileSync(gitArchivePath, fixture.archive);
  return { gitArchivePath, gitChecksum: fixture.checksum };
}

function stageFixture(directory, { version = '0.22.0', sourceCommit = commit } = {}) {
  const stage = path.join(directory, `stage-${version}`);
  const files = {
    'start.mjs': 'export async function main() { return 0; }\n',
    'package.json': JSON.stringify({ name: 'fixture-runtime', version }),
    'dist/index.html': '<script src="/assets/main.js"></script>',
    'dist/server.cjs': '// fixture server\n',
    'dist/assets/main.js': '// fixture client\n',
    'dist/workplace.mjs': '// fixture coordination\n',
    'dist/jaco-editor.mjs': '// fixture editor\n',
    'dist/connect.html': '<p>fixture setup</p>',
    'node_modules/express/package.json': '{"name":"express"}',
  };
  for (const [relative, data] of Object.entries(files)) {
    const target = path.join(stage, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data);
  }
  fs.writeFileSync(path.join(stage, 'release.json'), JSON.stringify({ schema: 'jaco.lite-release/v1', workspace: 'cognitive-live/v1',
    version, sourceCommit, entry: '/assets/main.js', indexSha256: digest(files['dist/index.html']),
    clientSha256: digest(files['dist/assets/main.js']), serverSha256: digest(files['dist/server.cjs']) }));
  return stage;
}

function pendingPayload(directory, version, node = nodeFixture()) {
  const stage = stageFixture(directory, { version });
  const prepared = path.join(directory, `payload-${version}`);
  const manifest = prepareWindowsPayload({ stage, destination: prepared, node, git: gitFixture(node.arch), sourceCommit: commit });
  const root = path.join(directory, 'install');
  const pending = path.join(root, 'versions', `.pending-${manifest.buildId}`);
  fs.mkdirSync(path.dirname(pending), { recursive: true }); fs.renameSync(prepared, pending);
  return { root, pending, manifest, stage };
}

test('Windows Node archive requires the official-shaped name, exact checksum and matching PE architecture', () => {
  const good = nodeFixture();
  assert.equal(good.version, '24.0.0'); assert.equal(good.arch, 'x64');
  assert.throws(() => verifyNodeArchive({ ...good, checksums: '0'.repeat(64) + `  ${good.filename}`, arch: 'x64' }), /CHECKSUM_MISMATCH/);
  assert.throws(() => verifyNodeArchive({ ...good, filename: '../node.exe', arch: 'x64' }), /NAME_INVALID/);
  assert.throws(() => verifyNodeArchive({ ...good, arch: 'arm64' }), /NAME_INVALID/);
  const bad = createZip([{ name: 'node-v24.0.0-win-x64/node.exe', data: Buffer.from('not executable') },
    { name: 'node-v24.0.0-win-x64/LICENSE', data: 'license' }]);
  assert.throws(() => verifyNodeArchive({ archive: bad, checksums: `${digest(bad)}  ${good.filename}`, filename: good.filename, arch: 'x64' }), /EXECUTABLE_INVALID/);
});

test('Node download selects one exact official checksum entry and verifies downloaded bytes', async () => {
  const fixture = nodeFixture(), requested = [];
  const downloaded = await obtainNode({ arch: 'x64', fetchImpl: async url => {
    requested.push(url);
    return url.endsWith('.txt') ? { ok: true, text: async () => fixture.checksums }
      : { ok: true, arrayBuffer: async () => fixture.archive };
  } });
  assert.equal(downloaded.archiveSha256, digest(fixture.archive));
  assert.deepEqual(requested, ['https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt', `https://nodejs.org/dist/latest-v24.x/${fixture.filename}`]);
  await assert.rejects(obtainNode({ arch: 'x64', fetchImpl: async () => ({ ok: true, text: async () => fixture.checksums.repeat(2) }) }), /AMBIGUOUS/);
});

test('MinGit requires one official release asset digest and validates bytes and architecture', async () => {
  const fixture = gitFixture(), requested = [];
  const git = await obtainGit({ arch: 'x64', fetchImpl: async url => {
    requested.push(url);
    return url.includes('/releases/latest') ? { ok: true, json: async () => ({ assets: [{ name: fixture.filename,
      digest: `sha256:${fixture.checksum}`, browser_download_url: `https://github.com/git-for-windows/git/releases/download/fixture/${fixture.filename}` }] }) }
      : { ok: true, arrayBuffer: async () => fixture.archive };
  } });
  assert.equal(git.archiveSha256, fixture.checksum); assert.equal(requested.length, 2);
  await assert.rejects(obtainGit({ fetchImpl: async () => ({ ok: true, json: async () => ({ assets: [{ name: fixture.filename }] }) }) }), /DIGEST_REQUIRED/);
  assert.throws(() => verifyGitArchive({ ...fixture, checksum: '0'.repeat(64), arch: 'x64' }), /CHECKSUM_MISMATCH/);
});

test('Installer consumes the complete canonical stage and retains exact source and Node provenance', t => {
  const directory = temporary(t), node = nodeFixture();
  const { root, pending, manifest } = pendingPayload(directory, '0.22.0', node);
  assert.equal(verifyPayload(pending).sourceCommit, commit);
  assert.equal(manifest.node.archiveSha256, digest(node.archive));
  assert.ok(manifest.files.some(item => item.path === 'app/dist/workplace.mjs'));
  assert.ok(manifest.files.some(item => item.path === 'app/node_modules/express/package.json'));
  assert.ok(!fs.existsSync(path.join(root, 'current.json')));
  fs.appendFileSync(path.join(pending, 'app/dist/server.cjs'), '// changed');
  assert.throws(() => verifyPayload(pending), /CHECKSUM_MISMATCH/);
});

test('Mixed builds, private state, symbolic links and overlapping output are refused before packaging', t => {
  const directory = temporary(t), stage = stageFixture(directory), node = nodeFixture(), git = gitFixture();
  const destination = path.join(directory, 'payload');
  assert.throws(() => prepareWindowsPayload({ stage, destination, node, git, sourceCommit: 'b'.repeat(40) }), /SOURCE_COMMIT_MISMATCH/);
  assert.throws(() => prepareWindowsPayload({ stage, destination: path.join(stage, 'out'), node, git }), /STAGE_OVERLAP/);
  fs.writeFileSync(path.join(stage, '.env'), 'PROVIDER_KEY=fixture-do-not-package');
  assert.throws(() => prepareWindowsPayload({ stage, destination, node, git }), /PRIVATE_STATE_REFUSED/);
  fs.rmSync(path.join(stage, '.env'));
  if (process.platform !== 'win32') {
    fs.symlinkSync(path.join(stage, 'package.json'), path.join(stage, 'linked-package.json'));
    assert.throws(() => prepareWindowsPayload({ stage, destination, node, git }), /UNSAFE_PATH/);
  }
});

test('Payload verification rejects additional files and manifest path traversal', t => {
  const directory = temporary(t), { pending } = pendingPayload(directory, '0.22.0');
  fs.writeFileSync(path.join(pending, 'injected.mjs'), '');
  assert.throws(() => verifyPayload(pending), /FILES_CHANGED/);
  fs.rmSync(path.join(pending, 'injected.mjs'));
  const file = path.join(pending, 'installer-manifest.json'), manifest = JSON.parse(fs.readFileSync(file));
  manifest.files[0].path = '../outside'; fs.writeFileSync(file, JSON.stringify(manifest));
  assert.throws(() => verifyPayload(pending), /MANIFEST_INVALID/);
});

test('Versioned activation switches one atomic pointer, preserves the prior version and keeps user data separate', t => {
  const directory = temporary(t), first = pendingPayload(directory, '0.22.0');
  const userData = path.join(directory, 'user-data'); fs.mkdirSync(userData); fs.writeFileSync(path.join(userData, 'settings'), 'keep');
  activatePayload(first.root, first.pending);
  assert.equal(readCurrent(first.root).buildId, first.manifest.buildId);
  assert.equal(fs.existsSync(first.pending), false);
  const second = pendingPayload(directory, '0.23.0'); activatePayload(second.root, second.pending);
  const pointer = readCurrent(first.root);
  assert.equal(pointer.buildId, second.manifest.buildId); assert.equal(pointer.previousBuildId, first.manifest.buildId);
  assert.ok(fs.existsSync(path.join(first.root, 'versions', first.manifest.buildId, 'app/start.mjs')));
  assert.equal(fs.readFileSync(path.join(userData, 'settings'), 'utf8'), 'keep');
  const pointerAgain = activatePayload(first.root, path.join(first.root, 'versions', second.manifest.buildId));
  assert.equal(pointerAgain.previousBuildId, first.manifest.buildId, 'same build does not erase rollback reference');
});

test('Failed verification and downgrade leave the current pointer unchanged', t => {
  const directory = temporary(t), newer = pendingPayload(directory, '0.23.0'); activatePayload(newer.root, newer.pending);
  const before = fs.readFileSync(path.join(newer.root, 'current.json'), 'utf8');
  const older = pendingPayload(directory, '0.22.0');
  assert.throws(() => activatePayload(older.root, older.pending), /DOWNGRADE_REFUSED/);
  fs.appendFileSync(path.join(older.pending, 'app/start.mjs'), '// altered');
  assert.throws(() => activatePayload(older.root, older.pending), /CHECKSUM_MISMATCH/);
  assert.equal(fs.readFileSync(path.join(newer.root, 'current.json'), 'utf8'), before);
});

test('Architecture changes cannot silently replace a current installation', t => {
  const directory = temporary(t), first = pendingPayload(directory, '0.22.0'); activatePayload(first.root, first.pending);
  const second = pendingPayload(directory, '0.23.0', nodeFixture('arm64'));
  assert.throws(() => activatePayload(second.root, second.pending), /ARCHITECTURE_CHANGE_REFUSED/);
});

test('Semver comparison orders stable and prerelease versions for downgrade refusal', () => {
  assert.equal(compareVersions('0.23.0', '0.22.12'), 1);
  assert.equal(compareVersions('0.22.0', '0.22.0-rc.1'), 1);
  assert.equal(compareVersions('0.22.0-rc.2', '0.22.0-rc.10'), -1);
  assert.equal(compareVersions('0.22.0', '0.22.0'), 0);
});

test('A running desktop blocks activation; status uses a bounded local pipe handshake', async t => {
  const directory = temporary(t), { root, pending } = pendingPayload(directory, '0.22.0');
  const server = net.createServer(connection => connection.on('data', () => connection.end(JSON.stringify({ schema: 'jaco.desktop-control/v1', running: true }) + '\n')));
  if (!await listenForTest(t, server, installationPipe(root))) return;
  t.after(() => new Promise(resolve => server.close(resolve)));
  assert.equal((await requestDesktop(root)).running, true);
  await assert.rejects(installAction('activate', root, pending), /RUNNING_CLOSE_FIRST/);
  assert.equal(readCurrent(root), null);
});

test('An unknown desktop response fails closed instead of triggering a second launch', async t => {
  const directory = temporary(t), root = path.join(directory, 'root'); fs.mkdirSync(root);
  const server = net.createServer(connection => connection.once('data', () => connection.end('invalid\n')));
  if (!await listenForTest(t, server, installationPipe(root))) return;
  t.after(() => new Promise(resolve => server.close(resolve)));
  await assert.rejects(requestDesktop(root));
});

test('A compiler failure cannot leave an old executable or success receipt in the output', async t => {
  const directory = temporary(t), stage = stageFixture(directory), fixture = nodeFixture();
  const outDir = path.join(directory, 'out'), archivePath = path.join(directory, fixture.filename), checksumsPath = path.join(directory, 'SHASUMS256.txt');
  fs.writeFileSync(archivePath, fixture.archive); fs.writeFileSync(checksumsPath, fixture.checksums); fs.mkdirSync(outDir);
  const target = path.join(outDir, 'JACO-Setup-0.22.0-x64.exe');
  fs.writeFileSync(target, 'old build'); fs.writeFileSync(`${target}.receipt.json`, '{}');
  await assert.rejects(buildWindowsInstaller({ stage, outDir, archivePath, checksumsPath, ...gitOffline(directory), sourceCommit: commit,
    run: () => ({ status: 1, stderr: 'fixture compiler failure' }) }), /COMPILE_FAILED/);
  assert.equal(fs.existsSync(target), false); assert.equal(fs.existsSync(`${target}.receipt.json`), false);
});

test('Desktop startup uses canonical launcher and setup grant; NSIS keeps data out of uninstall targets', () => {
  const launcher = fs.readFileSync(path.join(repo, 'packaging/windows/installed-launch.mjs'), 'utf8');
  const installer = fs.readFileSync(path.join(repo, 'packaging/windows/setup.nsi'), 'utf8');
  assert.match(launcher, /import\('\.\/app\/start\.mjs'\)/);
  assert.match(launcher, /JACO_REQUIRE_SETUP: '1'/);
  assert.match(installer, /RequestExecutionLevel user/);
  assert.match(installer, /MUI_LICENSEPAGE_CHECKBOX/);
  assert.match(installer, /Section \/o "Launch at Windows sign-in"/);
  assert.doesNotMatch(installer, /RMDir \/r "\$LOCALAPPDATA\\JACO/);
  assert.doesNotMatch(installer, /ExecutionPolicy|taskkill|HKLM/);
});

test('The real NSIS compiler accepts the installer template using a disposable integrity fixture', { skip: !compilerReady && 'NSIS compiler is not installed' }, async t => {
  const directory = temporary(t), stage = stageFixture(directory), fixture = nodeFixture();
  const archivePath = path.join(directory, fixture.filename), checksumsPath = path.join(directory, 'SHASUMS256.txt');
  fs.writeFileSync(archivePath, fixture.archive); fs.writeFileSync(checksumsPath, fixture.checksums);
  const result = await buildWindowsInstaller({ stage, outDir: path.join(directory, 'out'), archivePath, checksumsPath, ...gitOffline(directory), sourceCommit: commit, compiler });
  assert.equal(fs.readFileSync(result.path).toString('ascii', 0, 2), 'MZ');
  assert.equal(result.signature, 'unsigned');
  assert.equal(result.verification.windowsHostStartup, 'unobserved');
  assert.equal(result.sourceCommit, commit);
});
