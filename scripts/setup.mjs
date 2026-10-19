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

export function setup(root, env = process.env) {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or newer is required');
  for (const dir of ['', 'runtime', 'runtime/gateway']) {
    const cwd = path.join(root, dir);
    // npm omits the root package-lock.json from published packages. Nested runtime locks ship.
    const command = fs.existsSync(path.join(cwd, 'package-lock.json')) ? 'ci' : 'install';
    console.log(`Installing dependencies (${command}): ${dir || 'root'}`);
    // Lifecycle downloads (Electron/Chromium) are optional; install browsers explicitly when needed.
    const args = [command, '--ignore-scripts', '--no-audit', '--no-fund'];
    const result = process.env.npm_execpath
      ? spawnSync(process.execPath, [process.env.npm_execpath, ...args], { cwd, env, stdio: 'inherit' })
      : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Dependency installation failed: ${dir || 'root'}`);
  }
  ensureGatewayToken(root, env);
  console.log('Setup complete. Configure a model provider, then run npm run jaco:start.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { setup(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
