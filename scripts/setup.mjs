import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pixelDebian, preparePixelBrowser, activatePixelInstallation } from './pixel-browser-setup.mjs';

export function ensureGatewayToken(root, env = process.env) {
  const file = path.join(root, '.env');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const configured = parseEnv(text);
  const token = env.JACO_GATEWAY_TOKEN || env.GATEWAY_TOKEN || configured.JACO_GATEWAY_TOKEN || configured.GATEWAY_TOKEN;
  if (token) {
    if (token.length < 24) throw new Error('GATEWAY_TOKEN_REQUIRED_MIN_24: update the configured token');
    return;
  }
  const generated = crypto.randomBytes(32).toString('hex');
  fs.appendFileSync(file, `${text && !text.endsWith('\n') ? '\n' : ''}JACO_GATEWAY_TOKEN=${generated}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

// The injected spawn/logger are for isolated setup-contract tests only.
export function setup(root, env = process.env, { spawn = spawnSync, logger = console, system, pixelBrowser = preparePixelBrowser, pixelActivate = activatePixelInstallation } = {}) {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or newer is required');

  const runNpm = (cwd, args, label) => {
    const npmScript = env.npm_execpath;
    const executable = npmScript ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const commandArgs = npmScript ? [npmScript, ...args] : args;
    const result = spawn(executable, commandArgs, { cwd, env, stdio: 'inherit' });
    if (result.error) throw new Error(`${label}: ${result.error.message}`, { cause: result.error });
    if (result.status !== 0) throw new Error(`${label} (exit ${result.status ?? 'unknown'})`);
  };

  for (const dir of ['', 'runtime', 'runtime/gateway']) {
    const cwd = path.join(root, dir);
    if (!fs.existsSync(path.join(cwd, 'package.json'))) throw new Error(`SETUP_MANIFEST_MISSING:${dir || 'root'}`);
    // npm omits the root lockfile from some published packages. Nested runtime locks ship.
    const command = fs.existsSync(path.join(cwd, 'package-lock.json')) ? 'ci' : 'install';
    logger.log(`Installing dependencies (${command}): ${dir || 'root'}`);
    // Lifecycle downloads (Electron/Chromium) are optional; install browsers explicitly when needed.
    runNpm(cwd, [command, '--ignore-scripts', '--no-audit', '--no-fund'], `Dependency installation failed: ${dir || 'root'}`);
  }

  const runtime = path.join(root, 'runtime');
  const isTermux = process.platform === 'android' || String(env.PREFIX || '').includes('com.termux');
  if (isTermux) {
    // Android uses the canonical Termux source runtime through tsx, not the
    // optional desktop server bundle. Prepare Rollup before the Aura UI build.
    logger.log('Preparing Android Rollup runtime: runtime');
    const rollup = spawn(process.execPath, ['scripts/ensure_rollup_native.mjs'], { cwd: runtime, env, stdio: 'inherit' });
    if (rollup.error) throw new Error('Android Rollup preparation failed: ' + rollup.error.message, { cause: rollup.error });
    if (rollup.status !== 0) throw new Error(`Android Rollup preparation failed (exit ${rollup.status ?? 'unknown'})`);
    logger.log('Building Aura frontend for Termux: runtime');
    runNpm(runtime, ['run', 'build:termux'], 'Termux Aura build failed');
  } else {
    // Desktop startup auto-selects dist/ when both files exist; build both
    // artifacts rather than silently starting a source-only fallback.
    logger.log('Building production client and server: runtime');
    runNpm(runtime, ['run', 'build:client'], 'Production client build failed');
    runNpm(runtime, ['run', 'build:server'], 'Production server build failed');
  }

  ensureGatewayToken(root, env);
  // Retain explicit .env preferences, including a CDP opt-out and custom executable.
  const configFile = path.join(env.JACO_DATA_DIR || root, '.env');
  const configured = { ...(fs.existsSync(configFile) ? parseEnv(fs.readFileSync(configFile, 'utf8')) : {}), ...env };
  if (pixelDebian(configured, system)) {
    const browser = pixelBrowser(root, configured, { spawn, logger });
    logger.log('Pixel Chromium: ' + browser.state + (browser.reason ? ' (' + browser.reason + ')' : ''));
    const activation = pixelActivate(root, configured, { spawn, logger });
    if (activation.state === 'BLOCKED') throw new Error('PIXEL_ACTIVATION_UNVERIFIED:' + activation.reason);
    logger.log('Setup complete. Pixel activation: ' + activation.state + '; CDP: ' + (activation.browser || 'NOT_VERIFIED'));
  } else logger.log('Setup complete. Configure a model provider, then run npm run jaco:start.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { setup(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
