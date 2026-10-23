#!/usr/bin/env node
// Copies a build of JACO Lite into one folder under the exact names latest.json
// declares, and refuses to do it unless every file matches the size and SHA-256
// recorded there.
//
//   node tools/stage-lite-release.mjs build/lite build/lite/publish
//
// Why this exists: build-lite.mjs writes versioned names
// (jaco-lite-0.22.0.zip), while latest.json names the download
// (jaco-lite.zip), because the download URL has to stay the same between
// versions. A release asset is served under its filename, so publishing the
// versioned files makes lite/install.sh resolve a URL that is not there. This
// step is the one place that reconciles the two, and it verifies rather than
// trusts: a mismatch here means the build and its manifest disagree, which
// would otherwise surface as a failed install on someone's phone.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [sourceDir, outDir] = process.argv.slice(2);
if (!sourceDir || !outDir) {
  console.error('usage: stage-lite-release.mjs <build/lite> <output-dir>');
  process.exit(2);
}

const manifestPath = path.join(sourceDir, 'latest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`stage-lite-release: no latest.json in ${sourceDir}. Run tools/build-lite.mjs first.`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Where build-lite.mjs puts each platform's zip, by the key latest.json uses.
const SOURCES = {
  universal: () => firstMatch(sourceDir, /^jaco-lite-\d[\w.+-]*\.zip$/),
  windows: () => firstMatch(path.join(sourceDir, 'platforms'), /^jaco-lite-windows-\d[\w.+-]*\.zip$/),
  android: () => firstMatch(path.join(sourceDir, 'platforms'), /^jaco-lite-android-\d[\w.+-]*\.zip$/),
};

function firstMatch(dir, pattern) {
  if (!fs.existsSync(dir)) return null;
  const hit = fs.readdirSync(dir).filter((name) => pattern.test(name)).sort()[0];
  return hit ? path.join(dir, hit) : null;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const problems = [];
const staged = [];

for (const [key, entry] of Object.entries(manifest.files || {})) {
  const locate = SOURCES[key];
  if (!locate) {
    problems.push(`latest.json declares the unknown platform "${key}"`);
    continue;
  }
  const source = locate();
  if (!source) {
    problems.push(`latest.json declares ${key} as "${entry.file}", but no built zip for it was found`);
    continue;
  }
  const bytes = fs.statSync(source).size;
  const digest = sha256(source);
  if (bytes !== entry.bytes) {
    problems.push(`${key}: ${path.basename(source)} is ${bytes} bytes, latest.json says ${entry.bytes}`);
    continue;
  }
  if (digest !== entry.sha256) {
    problems.push(`${key}: ${path.basename(source)} hashes to ${digest}, latest.json says ${entry.sha256}`);
    continue;
  }
  const target = path.join(outDir, entry.file);
  fs.copyFileSync(source, target);
  fs.writeFileSync(`${target}.sha256`, `${digest}  ${entry.file}\n`);
  staged.push(`${entry.file}  ${(bytes / 1024 / 1024).toFixed(1)} MB  ${digest.slice(0, 16)}...`);
}

if (problems.length) {
  console.error('stage-lite-release: the build and latest.json disagree, so nothing was staged:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
if (!staged.length) {
  console.error('stage-lite-release: latest.json declares no files.');
  process.exit(1);
}

fs.copyFileSync(manifestPath, path.join(outDir, 'latest.json'));
console.log(`stage-lite-release: staged into ${outDir}`);
for (const line of staged) console.log(`  ${line}`);
console.log('  latest.json');
