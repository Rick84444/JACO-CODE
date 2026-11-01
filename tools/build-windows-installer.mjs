#!/usr/bin/env node
// Wrap the canonical, already built Lite payload in an offline per-user Windows installer.
// A successful build always produces a real NSIS PE file. No source build or npm runs on the user's PC.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkInstall, checkReleaseIntegrity } from '../lite/start.mjs';
import { readZip } from './lib/zip.mjs';
import { filesUnder, PAYLOAD_SCHEMA, verifyPayload } from '../packaging/windows/install-state.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const ARCH_MACHINE = { x64: 0x8664, arm64: 0xaa64 };

export function verifyWindowsExecutable(data, arch) {
  if (!ARCH_MACHINE[arch] || data.length < 256 || data.toString('ascii', 0, 2) !== 'MZ') throw new Error('WINDOWS_EXECUTABLE_INVALID');
  const offset = data.readUInt32LE(0x3c);
  if (offset + 6 > data.length || data.toString('ascii', offset, offset + 4) !== 'PE\0\0'
    || data.readUInt16LE(offset + 4) !== ARCH_MACHINE[arch]) throw new Error('WINDOWS_EXECUTABLE_ARCH_MISMATCH');
}

export function verifyNodeArchive({ archive, checksums, filename, arch }) {
  if (!ARCH_MACHINE[arch]) throw new Error('WINDOWS_ARCH_UNSUPPORTED');
  const match = /^node-v(24\.\d+\.\d+)-win-(x64|arm64)\.zip$/.exec(filename);
  if (!match || match[2] !== arch) throw new Error('NODE_ARCHIVE_NAME_INVALID');
  const lines = String(checksums).split(/\r?\n/).map(line => /^([a-f0-9]{64})\s+\*?([^\s]+)$/i.exec(line)).filter(Boolean)
    .filter(line => line[2] === filename);
  if (lines.length !== 1 || sha(archive) !== lines[0][1].toLowerCase()) throw new Error('NODE_ARCHIVE_CHECKSUM_MISMATCH');
  const entries = readZip(archive);
  const prefix = filename.slice(0, -4) + '/';
  const executable = entries.filter(entry => entry.name === `${prefix}node.exe`);
  const license = entries.filter(entry => entry.name === `${prefix}LICENSE`);
  if (executable.length !== 1 || license.length !== 1) throw new Error('NODE_ARCHIVE_INCOMPLETE');
  verifyWindowsExecutable(executable[0].data, arch);
  const files = entries.filter(entry => entry.name.startsWith(prefix) && !entry.name.endsWith('/')).map(entry => ({
    path: entry.name.slice(prefix.length), data: entry.data,
  })).filter(entry => /^(?:node\.exe|LICENSE|npm(?:\.cmd|\.ps1)?|npx(?:\.cmd|\.ps1)?)$/.test(entry.path) || entry.path.startsWith('node_modules/npm/'));
  if (!files.some(entry => entry.path === 'npm.cmd') || !files.some(entry => entry.path === 'npx.cmd')
    || !files.some(entry => entry.path === 'node_modules/npm/bin/npm-cli.js')) throw new Error('NODE_NPM_MISSING');
  return { version: match[1], arch, archiveSha256: sha(archive), executableSha256: sha(executable[0].data),
    filename, executable: executable[0].data, license: license[0].data, files };
}

function archivePathSafe(relative) {
  return relative && !relative.startsWith('/') && !relative.includes('\\') && !relative.includes(':')
    && !relative.includes('\0') && !relative.split('/').some(part => !part || part === '.' || part === '..');
}

export function verifyGitArchive({ archive, checksum, filename, arch }) {
  const match = /^MinGit-(\d+\.\d+\.\d+(?:\.\d+)?)-(64-bit|arm64)\.zip$/.exec(filename);
  if (!match || match[2] !== (arch === 'x64' ? '64-bit' : arch === 'arm64' ? 'arm64' : 'invalid')) throw new Error('GIT_ARCHIVE_NAME_INVALID');
  if (!/^[a-f0-9]{64}$/i.test(checksum || '') || sha(archive) !== checksum.toLowerCase()) throw new Error('GIT_ARCHIVE_CHECKSUM_MISMATCH');
  const entries = readZip(archive).filter(entry => !entry.name.endsWith('/'));
  const names = new Set();
  const files = entries.map(entry => {
    if (!archivePathSafe(entry.name) || names.has(entry.name)) throw new Error('GIT_ARCHIVE_PATH_INVALID');
    names.add(entry.name);
    return { path: entry.name, data: entry.data };
  });
  const executable = files.find(entry => entry.path === 'cmd/git.exe');
  if (!executable) throw new Error('GIT_EXECUTABLE_MISSING');
  verifyWindowsExecutable(executable.data, arch);
  return { version: match[1], arch, filename, archiveSha256: sha(archive), executableSha256: sha(executable.data), files };
}

export async function obtainGit({ arch = 'x64', archivePath, checksum, cacheDir, fetchImpl = fetch }) {
  if (Boolean(archivePath) !== Boolean(checksum)) throw new Error('GIT_ARCHIVE_AND_CHECKSUM_REQUIRED_TOGETHER');
  if (archivePath) return { ...verifyGitArchive({ archive: fs.readFileSync(archivePath), checksum, filename: path.basename(archivePath), arch }),
    provenance: 'operator-supplied-official-archive-and-checksum' };
  const releaseUrl = 'https://api.github.com/repos/git-for-windows/git/releases/latest';
  const response = await fetchImpl(releaseUrl, { signal: AbortSignal.timeout(30_000), headers: { accept: 'application/vnd.github+json', 'user-agent': 'JACO-installer-builder' } });
  if (!response.ok) throw new Error(`GIT_RELEASE_DOWNLOAD_FAILED:${response.status}`);
  const release = await response.json();
  const expected = arch === 'x64' ? /^MinGit-\d+\.\d+\.\d+(?:\.\d+)?-64-bit\.zip$/ : /^MinGit-\d+\.\d+\.\d+(?:\.\d+)?-arm64\.zip$/;
  const assets = release.assets?.filter(asset => expected.test(asset.name)) ?? [];
  if (assets.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(assets[0].digest || '')) throw new Error('GIT_RELEASE_DIGEST_REQUIRED');
  const asset = assets[0];
  const url = new URL(asset.browser_download_url);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith('/git-for-windows/git/releases/download/')) throw new Error('GIT_RELEASE_URL_INVALID');
  const download = await fetchImpl(url.href, { signal: AbortSignal.timeout(120_000) });
  if (!download.ok) throw new Error(`GIT_ARCHIVE_DOWNLOAD_FAILED:${download.status}`);
  const archive = Buffer.from(await download.arrayBuffer());
  const verified = verifyGitArchive({ archive, checksum: asset.digest.slice('sha256:'.length), filename: asset.name, arch });
  if (cacheDir) {
    fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(path.join(cacheDir, asset.name), archive);
    fs.writeFileSync(path.join(cacheDir, `${asset.name}.sha256`), `${verified.archiveSha256}  ${asset.name}\n`);
  }
  return { ...verified, provenance: 'official-github-release-asset-digest', archiveUrl: url.href, releaseUrl };
}

export async function obtainNode({ arch = 'x64', archivePath, checksumsPath, cacheDir, fetchImpl = fetch }) {
  if (Boolean(archivePath) !== Boolean(checksumsPath)) throw new Error('NODE_ARCHIVE_AND_CHECKSUMS_REQUIRED_TOGETHER');
  if (archivePath) return { ...verifyNodeArchive({ archive: fs.readFileSync(archivePath), checksums: fs.readFileSync(checksumsPath, 'utf8'),
    filename: path.basename(archivePath), arch }), provenance: 'operator-supplied-official-archive-and-checksums' };
  // The official checksum list selects the exact Node version; the version is not guessed or scraped from HTML.
  const distribution = 'https://nodejs.org/dist/latest-v24.x';
  const sumsResponse = await fetchImpl(`${distribution}/SHASUMS256.txt`, { signal: AbortSignal.timeout(30_000) });
  if (!sumsResponse.ok) throw new Error(`NODE_CHECKSUM_DOWNLOAD_FAILED:${sumsResponse.status}`);
  const checksums = await sumsResponse.text();
  const names = checksums.split(/\r?\n/).map(line => /^([a-f0-9]{64})\s+\*?(node-v24\.\d+\.\d+-win-(x64|arm64)\.zip)$/i.exec(line))
    .filter(match => match && match[3] === arch);
  if (names.length !== 1) throw new Error('NODE_DISTRIBUTION_AMBIGUOUS');
  const filename = names[0][2];
  const response = await fetchImpl(`${distribution}/${filename}`, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`NODE_ARCHIVE_DOWNLOAD_FAILED:${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const verified = verifyNodeArchive({ archive, checksums, filename, arch });
  if (cacheDir) {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, filename), archive);
    fs.writeFileSync(path.join(cacheDir, 'SHASUMS256.txt'), checksums);
  }
  return { ...verified, provenance: 'nodejs.org-https-checksum', archiveUrl: `${distribution}/${filename}`,
    checksumsUrl: `${distribution}/SHASUMS256.txt` };
}

function isWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function inspectStage(stage, sourceCommit) {
  const problems = [...checkInstall(stage), ...checkReleaseIntegrity(stage)];
  if (problems.length) throw new Error(`INSTALLER_STAGE_INVALID:${problems.join(', ')}`);
  const release = JSON.parse(fs.readFileSync(path.join(stage, 'release.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(release.version || '') || pkg.version !== release.version)
    throw new Error('INSTALLER_VERSION_INVALID');
  if (!/^[a-f0-9]{40}$/.test(release.sourceCommit || '') || (sourceCommit && sourceCommit !== release.sourceCommit))
    throw new Error('INSTALLER_SOURCE_COMMIT_MISMATCH');
  return release;
}

export function prepareWindowsPayload({ stage, destination, node, git, sourceCommit }) {
  stage = path.resolve(stage); destination = path.resolve(destination);
  if (isWithin(stage, destination) || isWithin(destination, stage)) throw new Error('INSTALLER_STAGE_OVERLAP');
  const release = inspectStage(stage, sourceCommit);
  verifyWindowsExecutable(node.executable, node.arch);
  if (node.executableSha256 !== sha(node.executable) || !/^[a-f0-9]{64}$/.test(node.archiveSha256 || ''))
    throw new Error('NODE_PROVENANCE_INVALID');
  if (!Array.isArray(node.files) || !git || git.arch !== node.arch || !Array.isArray(git.files)
    || !/^[a-f0-9]{64}$/.test(git.archiveSha256 || '')) throw new Error('GIT_PROVENANCE_INVALID');

  const originals = filesUnder(stage);
  if (originals.some(file => file.split('/').some(part => ['.env', '.jaco', '.git'].includes(part)))) throw new Error('INSTALLER_PRIVATE_STATE_REFUSED');
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.join(destination, 'app'), { recursive: true });
  for (const relative of originals) {
    const target = path.join(destination, 'app', relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(stage, relative), target);
  }
  for (const [directory, files] of [['node', node.files], ['git', git.files]]) {
    const written = new Set();
    for (const entry of files) {
      if (!archivePathSafe(entry.path) || written.has(entry.path)) throw new Error('BUNDLED_TOOL_PATH_INVALID');
      written.add(entry.path);
      const target = path.join(destination, directory, entry.path); fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.data);
    }
  }
  for (const name of ['install-state.mjs', 'installed-launch.mjs', 'startup-error.vbs'])
    fs.copyFileSync(path.join(repo, 'packaging', 'windows', name), path.join(destination, name));
  const files = filesUnder(destination).map(relative => {
    const bytes = fs.readFileSync(path.join(destination, relative));
    return { path: relative, bytes: bytes.length, sha256: sha(bytes) };
  });
  const contentSha = sha(JSON.stringify(files));
  const manifest = {
    schema: PAYLOAD_SCHEMA, version: release.version, sourceCommit: release.sourceCommit, arch: node.arch,
    buildId: `${release.version}-${release.sourceCommit.slice(0, 12)}-${contentSha.slice(0, 12)}-${node.arch}`,
    payloadSha256: contentSha, node: {
      version: node.version, archive: node.filename, archiveSha256: node.archiveSha256, executableSha256: node.executableSha256,
      provenance: node.provenance, archiveUrl: node.archiveUrl ?? null, checksumsUrl: node.checksumsUrl ?? null,
    }, git: {
      version: git.version, archive: git.filename, archiveSha256: git.archiveSha256, executableSha256: git.executableSha256,
      provenance: git.provenance, archiveUrl: git.archiveUrl ?? null, releaseUrl: git.releaseUrl ?? null,
    }, files,
  };
  fs.writeFileSync(path.join(destination, 'installer-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  verifyPayload(destination);
  return manifest;
}

function nsisValue(value) {
  if (/[\r\n\0]/.test(value)) throw new Error('NSIS_VALUE_INVALID');
  return String(value).replaceAll('$', '$$').replaceAll('"', '$\\"');
}

export async function buildWindowsInstaller({ stage, outDir, arch = 'x64', sourceCommit,
  archivePath, checksumsPath, gitArchivePath, gitChecksum, compiler = process.env.MAKENSIS || 'makensis', fetchImpl = fetch, run = spawnSync } = {}) {
  if (!stage || !outDir) throw new Error('INSTALLER_STAGE_AND_OUTPUT_REQUIRED');
  if (!ARCH_MACHINE[arch]) throw new Error('WINDOWS_ARCH_UNSUPPORTED');
  outDir = path.resolve(outDir);
  const work = path.join(outDir, `work-${arch}`);
  fs.mkdirSync(work, { recursive: true });
  const release = inspectStage(path.resolve(stage), sourceCommit);
  const filename = `JACO-Setup-${release.version}-${arch}.exe`;
  const target = path.join(outDir, filename);
  for (const file of [target, `${target}.sha256`, `${target}.receipt.json`]) fs.rmSync(file, { force: true });
  const node = await obtainNode({ arch, archivePath, checksumsPath, cacheDir: path.join(work, 'node-download'), fetchImpl });
  const git = await obtainGit({ arch, archivePath: gitArchivePath, checksum: gitChecksum, cacheDir: path.join(work, 'git-download'), fetchImpl });
  const payload = path.join(work, 'payload');
  const manifest = prepareWindowsPayload({ stage, destination: payload, node, git, sourceCommit });
  const license = path.join(work, 'license.txt');
  fs.writeFileSync(license, fs.readFileSync(path.join(repo, 'packaging/windows/consent.txt'), 'utf8') + '\n\n'
    + fs.readFileSync(path.join(repo, 'LICENSE'), 'utf8'));
  const defines = {
    PRODUCT_VERSION: manifest.version, FILE_VERSION: `${manifest.version.split('-')[0]}.0`, BUILD_ID: manifest.buildId,
    TARGET_ARCH: arch, PAYLOAD_DIR: payload, OUTPUT_FILE: target, LICENSE_FILE: license,
    LAUNCHER_FILE: path.join(repo, 'packaging/windows/launch.vbs'),
    NODE_EXECUTABLE: path.join(payload, 'node/node.exe'), INSTALL_STATE_FILE: path.join(payload, 'install-state.mjs'),
  };
  const options = path.join(work, 'build-options.nsh');
  fs.writeFileSync(options, Object.entries(defines).map(([key, value]) => `!define ${key} "${nsisValue(value)}"`).join('\n') + '\n');
  const result = run(compiler, ['-V2', `-DOPTIONS=${options}`, path.join(repo, 'packaging/windows/setup.nsi')], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`WINDOWS_INSTALLER_COMPILE_FAILED:${result.error?.message || String(result.stderr || result.stdout).slice(-2000)}`);
  if (!fs.existsSync(target)) throw new Error('WINDOWS_INSTALLER_OUTPUT_MISSING');
  const executable = fs.readFileSync(target);
  if (executable.length < 50_000 || executable.toString('ascii', 0, 2) !== 'MZ') throw new Error('WINDOWS_INSTALLER_OUTPUT_INVALID');
  const receipt = {
    schema: 'jaco.windows-installer-receipt/v1', file: filename, version: manifest.version, sourceCommit: manifest.sourceCommit,
    arch, buildId: manifest.buildId, bytes: executable.length, sha256: sha(executable), payloadSha256: manifest.payloadSha256,
    node: manifest.node, git: manifest.git, signature: 'unsigned', verification: { payloadFiles: manifest.files.length, checksums: 'passed',
      windowsHostInstall: 'unobserved', windowsHostStartup: 'unobserved' },
  };
  fs.writeFileSync(`${target}.sha256`, `${receipt.sha256}  ${filename}\n`);
  fs.writeFileSync(`${target}.receipt.json`, JSON.stringify(receipt, null, 2) + '\n');
  return { path: target, ...receipt };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--stage', '--out', '--arch', '--source-commit', '--node-archive', '--node-checksums', '--git-archive', '--git-checksum', '--makensis'].includes(args[i]) || !args[i + 1])
      throw new Error('Usage: node tools/build-windows-installer.mjs --stage DIR --out DIR [--arch x64|arm64] [--source-commit SHA] [--node-archive ZIP --node-checksums TXT] [--git-archive ZIP --git-checksum SHA256] [--makensis EXE]');
    values[args[i]] = args[i + 1];
  }
  buildWindowsInstaller({ stage: values['--stage'], outDir: values['--out'] || path.join(repo, 'build/installers'), arch: values['--arch'] || 'x64',
    sourceCommit: values['--source-commit'] || process.env.JACO_BUILD_SOURCE_COMMIT, archivePath: values['--node-archive'],
    checksumsPath: values['--node-checksums'], gitArchivePath: values['--git-archive'], gitChecksum: values['--git-checksum'],
    compiler: values['--makensis'] || process.env.MAKENSIS || 'makensis' }).then(result => {
    console.log(`Built ${result.path} (${result.bytes} bytes)`);
    console.log(`SHA-256 ${result.sha256}`);
    console.log('Windows installation and startup remain unobserved until the installer is tested on Windows.');
  }, error => { console.error(error.message); process.exitCode = 1; });
}
