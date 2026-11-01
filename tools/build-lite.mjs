#!/usr/bin/env node
// Builds the JACO Lite download: the IDE and its server (the runtime's dist/), the Nova agent bundled into
// one file (dist/nova.mjs), the packages they need from node_modules (so nothing is downloaded when the
// user starts it), the launcher in lite/, and the license, as one zip. Nothing is published: the zip lands in build/lite/ for the operator to inspect.
//
//   node tools/build-lite.mjs [--out DIR] [--rebuild]
//
// Before the zip is written the staged files are scanned for any secret value from the builder's own .env,
// and the finished zip is read back (every entry inflated and its CRC checked).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createZip, readZip } from './lib/zip.mjs';

// What dist/server.cjs requires at run time (checked against the bundle: express, ws, zod,
// @google/genai and typescript are required; dotenv and undici by the Nova agent bundle). vite is loaded only in dev.
export const LITE_DEPENDENCIES = ['express', 'ws', 'zod', '@google/genai', 'dotenv', 'undici', 'typescript', '@whiskeysockets/baileys', 'qrcode-terminal'];
// Installed by Baileys but not needed for text and voice notes: sharp's native image binaries (28 MB) and type declarations.
export const LITE_PRUNE = ['@img', '@types'];
export const TEMPLATE_FILES = ['start.mjs', 'setup-state.mjs', 'START.cmd', 'start.sh', 'START-ANDROID.sh', 'README.md'];
export const CONNECTION_FILES = ['connect.html', 'connect.js', 'connect.css'];
// One download per platform next to the universal one (operator 2026-10-13): each carries only its own
// launchers, and its release.json says which platform it is. The public names are what jacocode.com serves
// and what latest.json points at. Android is built the same way but has not been run on a phone.
export const PLATFORM_LAUNCHERS = {
  windows: ['START.cmd', 'start.mjs', 'setup-state.mjs', 'README.md'],
  android: ['START-ANDROID.sh', 'start.sh', 'start.mjs', 'setup-state.mjs', 'README.md'],
};
export const PUBLIC_NAMES = { universal: 'jaco-lite.zip', windows: 'jaco-lite-windows.zip', android: 'jaco-lite-android.zip' };
const EXECUTABLE_LAUNCHERS = ['start.sh', 'START-ANDROID.sh'];

// Refuse a stale editor-only build before packaging it as the current Lite download.
export function workspaceBuild(dist) {
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const asset = /src="(\/assets\/[^"?#]+\.js)"/.exec(html)?.[1];
  if (!asset || asset.includes('..')) throw new Error('LITE_WORKSPACE_ENTRY_MISSING');
  const client = fs.readFileSync(path.join(dist, asset.slice(1)));
  const server = fs.readFileSync(path.join(dist, 'server.cjs'));
  if (!client.includes(Buffer.from('data-cognitive-workspace')) || !client.includes(Buffer.from('/api/aura/workbench/live')) || !server.includes(Buffer.from('/api/aura/workbench/live'))) {
    throw new Error('LITE_COGNITIVE_WORKSPACE_MISSING: rebuild the canonical runtime');
  }
  // The downloadable Lite must contain the actual Gameboard API and Codex canvas, not only old assets.
  const assets = fs.readdirSync(path.join(dist, 'assets')).filter(name => name.endsWith('.js'))
    .map(name => fs.readFileSync(path.join(dist, 'assets', name)));
  if (!server.includes(Buffer.from('/api/aura/workbench/gameboard'))
    || !assets.some(content => content.includes(Buffer.from('/api/aura/workbench/gameboard')))
    || !assets.some(content => content.includes(Buffer.from('Spelplan'))))
    throw new Error('LITE_GAMEBOARD_MISSING: rebuild the current Codex workspace and server');
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  return { workspace: 'cognitive-live/v1', entry: asset, clientSha256: hash(client), serverSha256: hash(server), indexSha256: hash(html) };
}

export async function bundleConnections(stage, { repoRoot, runtimeDir }) {
  const esbuild = createRequire(path.join(runtimeDir, 'package.json'))('esbuild');
  for (const [source, target] of [[path.join(runtimeDir, 'src', 'server', 'connected', 'voiceLink.mjs'), 'voice-link.mjs'], [path.join(runtimeDir, 'tools', 'jaco-editor-mcp.mjs'), 'jaco-editor.mjs'], [path.join(repoRoot, 'gateway', 'src', 'workplace', 'workplace-server.mjs'), 'workplace.mjs'], [path.join(runtimeDir, 'tools', 'jaco-shell-mcp.mjs'), 'jaco-shell.mjs']]) {
    await esbuild.build({ entryPoints: [source], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: path.join(stage, 'dist', target), logLevel: 'error' });
  }
}
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|HASH|BEARER|PRIVATE/i;

// A package may be declared by the runtime's package.json or, as undici is, by the repository root's.
export function liteDependencies(pkg, names = LITE_DEPENDENCIES, fallback = null) {
  const out = {};
  for (const name of names) {
    const range = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? fallback?.dependencies?.[name] ?? fallback?.devDependencies?.[name];
    if (!range) throw new Error(`LITE_DEPENDENCY_UNKNOWN:${name}`);
    out[name] = range;
  }
  return out;
}

// Files below root (never symbolic links), sorted, with "/" in names.
export function collectFiles(root, skip = () => false) {
  const out = [];
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || skip(next, entry.isDirectory())) continue;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), next);
      else if (entry.isFile()) out.push({ rel: next, abs: path.join(dir, entry.name) });
    }
  };
  walk(root, '');
  return out;
}

// Secret values (long enough to mean something) from an env file's text.
export function secretValues(envText) {
  const out = new Set();
  for (const line of String(envText).split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || !SECRET_NAME.test(m[1])) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (value.length >= 12 && !/^(true|false|none|null)$/i.test(value)) out.add(value);
  }
  return [...out];
}

// The relative paths of staged files that contain one of the secrets. node_modules is third-party code.
export function findSecrets(files, secrets) {
  if (!secrets.length) return [];
  const hits = [];
  for (const file of files) {
    if (file.rel.startsWith('node_modules/')) continue;
    const text = fs.readFileSync(file.abs, 'latin1');
    if (secrets.some(secret => text.includes(secret))) hits.push(file.rel);
  }
  return hits;
}

// npm is run through node itself (npm-cli.js next to the node binary) so no shell is involved on Windows,
// where npm is a .cmd file that cannot be started without one.
export function npmCommand(execPath = process.execPath) {
  const cli = path.join(path.dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return fs.existsSync(cli) ? { cmd: execPath, prefix: [cli] } : { cmd: 'npm', prefix: [] };
}

function defaultInstall(stage) {
  const npm = npmCommand();
  const result = spawnSync(npm.cmd, [...npm.prefix, 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: stage, encoding: 'utf8', env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: '1' },
  });
  if (result.status !== 0) throw new Error(`LITE_INSTALL_FAILED: ${String(result.stderr || result.stdout).slice(-600)}`);
}

// The Nova agent as one ESM file (about 280 KB); its packages stay external and come from node_modules.
async function defaultBundleNova(outfile, { repoRoot, runtimeDir }) {
  const esbuild = createRequire(path.join(runtimeDir, 'package.json'))('esbuild');
  await esbuild.build({ entryPoints: [path.join(repoRoot, 'agents', 'hands-off-agent.mjs')], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile, logLevel: 'error' });
}

export async function buildLite({ repoRoot, runtimeDir, outDir, install = defaultInstall, bundleNova = defaultBundleNova, bundleSetup = bundleConnections, envFile = null, sourceCommit = null, date = new Date(), log = () => {} } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(runtimeDir, 'package.json'), 'utf8'));
  const name = `jaco-lite-${pkg.version}`;
  const dist = path.join(runtimeDir, 'dist');
  for (const rel of ['server.cjs', 'index.html']) if (!fs.existsSync(path.join(dist, rel))) throw new Error(`LITE_DIST_MISSING:${rel} (run the runtime build first)`);
  const rootPackage = path.join(repoRoot, 'package.json');
  const dependencies = liteDependencies(pkg, LITE_DEPENDENCIES, fs.existsSync(rootPackage) ? JSON.parse(fs.readFileSync(rootPackage, 'utf8')) : null);
  // A failed build must not leave an older zip (or its receipt) behind that could be verified as if new.
  for (const old of [`${name}.zip`, `${name}.zip.sha256`, `${name}.zip.receipt.json`, 'latest.json']) fs.rmSync(path.join(outDir, old), { force: true });
  fs.rmSync(path.join(outDir, 'platforms'), { recursive: true, force: true });
  const workspace = workspaceBuild(dist);
  if (sourceCommit !== null && !/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('LITE_SOURCE_COMMIT_INVALID');

  const stage = path.join(outDir, 'stage', name);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  log('staging dist');
  for (const file of collectFiles(dist, rel => rel.endsWith('.map'))) {
    const target = path.join(stage, 'dist', file.rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file.abs, target);
  }
  log('bundling the Nova agent');
  await bundleNova(path.join(stage, 'dist', 'nova.mjs'), { repoRoot, runtimeDir });
  await bundleSetup(stage, { repoRoot, runtimeDir });
  // External JacoEdit and the GUI must point at the exact same Gameboard API.
  if (!fs.readFileSync(path.join(stage, 'dist', 'jaco-editor.mjs')).includes(Buffer.from('gameboard_status')))
    throw new Error('LITE_GAMEBOARD_MCP_MISSING: bundled editor is stale');
  for (const file of CONNECTION_FILES) fs.copyFileSync(path.join(repoRoot, 'lite', file), path.join(stage, 'dist', file));
  for (const file of TEMPLATE_FILES) fs.copyFileSync(path.join(repoRoot, 'lite', file), path.join(stage, file));
  fs.copyFileSync(path.join(repoRoot, 'LICENSE'), path.join(stage, 'LICENSE'));
  fs.writeFileSync(path.join(stage, 'package.json'), `${JSON.stringify({
    name: 'jaco-lite', version: pkg.version, private: true, license: 'MIT',
    description: 'JACO IDE on your own computer, with your own AI models.',
    scripts: { start: 'node start.mjs' }, engines: { node: '>=22.5' }, dependencies,
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(stage, 'release.json'), JSON.stringify({ schema: 'jaco.lite-release/v1', version: pkg.version, sourceCommit, builtAt: date.toISOString(), ...workspace }, null, 2)+'\n');

  log('installing runtime packages');
  await install(stage);
  fs.rmSync(path.join(stage, 'node_modules', '.bin'), { recursive: true, force: true });
  for (const dir of LITE_PRUNE) fs.rmSync(path.join(stage, 'node_modules', dir), { recursive: true, force: true });

  const files = collectFiles(stage);
  const leaked = findSecrets(files, envFile && fs.existsSync(envFile) ? secretValues(fs.readFileSync(envFile, 'utf8')) : []);
  if (leaked.length) throw new Error(`LITE_SECRET_FOUND:${leaked.join(',')}`);

  log(`zipping ${files.length} files`);
  const entries = files.map(f => ({ name: `${name}/${f.rel}`, data: fs.readFileSync(f.abs), mode: EXECUTABLE_LAUNCHERS.includes(f.rel) ? 0o755 : 0o644 }));
  const zip = createZip(entries, { date });
  const readBack = readZip(zip);
  if (readBack.length !== entries.length) throw new Error('LITE_ZIP_SELFCHECK_FAILED');
  fs.mkdirSync(outDir, { recursive: true });
  const zipPath = path.join(outDir, `${name}.zip`);
  fs.writeFileSync(zipPath, zip);
  const sha256 = crypto.createHash('sha256').update(zip).digest('hex');
  fs.writeFileSync(`${zipPath}.sha256`, `${sha256}  ${name}.zip\n`);

  // The same staged files, one zip per platform with only its launchers (outDir/platforms, so the universal
  // zip stays the only jaco-lite-*.zip in outDir).
  const builtAt = date.toISOString();
  const published = { universal: { file: PUBLIC_NAMES.universal, bytes: zip.length, sha256 } };
  const platforms = {};
  for (const [platform, launchers] of Object.entries(PLATFORM_LAUNCHERS)) {
    const dirName = `jaco-lite-${platform}-${pkg.version}`;
    const own = files.filter(f => !TEMPLATE_FILES.includes(f.rel) || launchers.includes(f.rel));
    const platformEntries = own.map(f => ({
      name: `${dirName}/${f.rel}`,
      data: f.rel === 'release.json' ? Buffer.from(JSON.stringify({ ...JSON.parse(fs.readFileSync(f.abs, 'utf8')), platform }, null, 2) + '\n') : fs.readFileSync(f.abs),
      mode: EXECUTABLE_LAUNCHERS.includes(f.rel) ? 0o755 : 0o644,
    }));
    const platformZip = createZip(platformEntries, { date });
    if (readZip(platformZip).length !== platformEntries.length) throw new Error(`LITE_ZIP_SELFCHECK_FAILED:${platform}`);
    const platformPath = path.join(outDir, 'platforms', `${dirName}.zip`);
    fs.mkdirSync(path.dirname(platformPath), { recursive: true });
    fs.writeFileSync(platformPath, platformZip);
    const platformSha = crypto.createHash('sha256').update(platformZip).digest('hex');
    fs.writeFileSync(`${platformPath}.sha256`, `${platformSha}  ${PUBLIC_NAMES[platform]}\n`);
    platforms[platform] = { zipPath: platformPath, bytes: platformZip.length, sha256: platformSha, files: own.length };
    published[platform] = { file: PUBLIC_NAMES[platform], bytes: platformZip.length, sha256: platformSha };
  }
  // What the launcher and the website compare against: a newer builtAt or a different commit means an update.
  const latestPath = path.join(outDir, 'latest.json');
  fs.writeFileSync(latestPath, JSON.stringify({ schema: 'jaco.lite-latest/v1', version: pkg.version, sourceCommit, builtAt, files: published }, null, 2) + '\n');
  return { name, version: pkg.version, zipPath, bytes: zip.length, sha256, files: files.length, dependencies, sourceCommit, platforms, latestPath, ...workspace, secretScan: { checkedFiles: files.filter(f => !f.rel.startsWith('node_modules/')).length, leaked: 0 } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  const runtimeDir = path.join(repoRoot, 'runtime');
  const outIndex = args.indexOf('--out');
  const outDir = path.resolve(outIndex >= 0 ? args[outIndex + 1] : path.join(repoRoot, 'build', 'lite'));
  if (!args.includes('--no-build') || args.includes('--rebuild') || !fs.existsSync(path.join(runtimeDir, 'dist', 'server.cjs'))) {
    console.log('building the runtime (npm run build)');
    const npm = npmCommand();
    const built = spawnSync(npm.cmd, [...npm.prefix, 'run', 'build'], { cwd: runtimeDir, stdio: 'inherit' });
    if (built.status !== 0) { console.error('the runtime build failed'); process.exit(1); }
  }
  buildLite({ repoRoot, runtimeDir, outDir, sourceCommit: process.env.JACO_BUILD_SOURCE_COMMIT || null, envFile: path.join(repoRoot, '.env'), log: line => console.log(`lite: ${line}`) }).then(
    r => {
      console.log(`lite: wrote ${r.zipPath}`);
      console.log(`lite: ${(r.bytes / 1048576).toFixed(1)} MB, ${r.files} files, sha256 ${r.sha256}`);
      for (const [platform, p] of Object.entries(r.platforms)) console.log(`lite: ${platform}: ${p.zipPath} (${(p.bytes / 1048576).toFixed(1)} MB, ${p.files} files, sha256 ${p.sha256})`);
      console.log(`lite: wrote ${r.latestPath}`);
    },
    error => { console.error(`lite: ${error.message}`); process.exit(1); },
  );
}
