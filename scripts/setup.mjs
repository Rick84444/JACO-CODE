import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
export function setup(root, env = process.env, { spawn = spawnSync, logger = console } = {}) {
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

  // The canonical startup auto-selects dist/ if it exists. Build both artifacts
  // so clean installations start the same verified product in production mode.
  const runtime = path.join(root, 'runtime');
  logger.log('Building production client and server: runtime');
  runNpm(runtime, ['run', 'build:client'], 'Production client build failed');
  runNpm(runtime, ['run', 'build:server'], 'Production server build failed');

  ensureGatewayToken(root, env);
  logger.log('Setup complete. Configure a model provider, then run npm run jaco:start.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { setup(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
