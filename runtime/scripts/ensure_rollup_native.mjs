#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

export function selectRollupNativePackage(platform, arch, { musl = false } = {}) {
  const table = {
    'win32:x64': '@rollup/rollup-win32-x64-msvc',
    'win32:arm64': '@rollup/rollup-win32-arm64-msvc',
    'win32:ia32': '@rollup/rollup-win32-ia32-msvc',
    'android:arm64': '@rollup/rollup-android-arm64',
    'android:arm': '@rollup/rollup-android-arm-eabi',
    'darwin:x64': '@rollup/rollup-darwin-x64',
    'darwin:arm64': '@rollup/rollup-darwin-arm64',
  };
  if (platform === 'linux') {
    if (arch === 'x64') return `@rollup/rollup-linux-x64-${musl ? 'musl' : 'gnu'}`;
    if (arch === 'arm64') return `@rollup/rollup-linux-arm64-${musl ? 'musl' : 'gnu'}`;
  }
  return table[`${platform}:${arch}`] || null;
}

function runtimeUsesMusl() {
  if (process.platform !== 'linux') return false;
  try {
    const header = process.report?.getReport?.().header || {};
    return !header.glibcVersionRuntime;
  } catch {
    return false;
  }
}

function packageExists(name) {
  try {
    require.resolve(`${name}/package.json`, { paths: [process.cwd()] });
    return true;
  } catch {
    try {
      require.resolve(name, { paths: [process.cwd()] });
      return true;
    } catch {
      return false;
    }
  }
}

function readRollupVersion(root) {
  const p = path.join(root, 'node_modules', 'rollup', 'package.json');
  if (!fs.existsSync(p)) throw new Error('Rollup is not installed. Install root dependencies first.');
  const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!pkg.version) throw new Error('Unable to determine installed Rollup version.');
  return pkg.version;
}

export function repairRollupNative({
  platform = process.env.JACO_ROLLUP_PLATFORM_OVERRIDE || process.platform,
  arch = process.env.JACO_ROLLUP_ARCH_OVERRIDE || process.arch,
  dryRun = process.env.JACO_ROLLUP_DRY_RUN === '1',
  cwd = process.cwd(),
} = {}) {
  const nativePackage = selectRollupNativePackage(platform, arch, { musl: runtimeUsesMusl() });
  if (!nativePackage) {
    console.log(`[JACO] Rollup native repair: no explicit mapping for ${platform}/${arch}; leaving npm resolution unchanged.`);
    return { status: 'UNMAPPED', platform, arch };
  }

  const version = readRollupVersion(cwd);
  if (packageExists(nativePackage)) {
    console.log(`[JACO] Rollup native repair: ${nativePackage}@${version} already installed.`);
    return { status: 'PRESENT', package: nativePackage, version };
  }

  if (dryRun) {
    console.log(`[JACO] Rollup native repair dry-run: would install ${nativePackage}@${version}.`);
    return { status: 'WOULD_INSTALL', package: nativePackage, version };
  }

  console.log(`[JACO] Rollup native package missing for ${platform}/${arch}. Installing ${nativePackage}@${version}...`);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, [
    'install', '--no-save', '--package-lock=false', '--ignore-scripts', '--no-audit', '--no-fund', `${nativePackage}@${version}`
  ], { cwd, stdio: 'inherit', shell: false });

  if (result.status !== 0 || !packageExists(nativePackage)) {
    throw new Error(`Failed to install required Rollup native package ${nativePackage}@${version}.`);
  }

  console.log(`[JACO] Rollup native repair: ${nativePackage}@${version} installed and resolved.`);
  return { status: 'INSTALLED', package: nativePackage, version };
}

const invokedAsMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsMain) {
  try {
    repairRollupNative();
  } catch (error) {
    console.error(`[JACO] Rollup native repair failed: ${error?.message || error}`);
    process.exit(1);
  }
}
