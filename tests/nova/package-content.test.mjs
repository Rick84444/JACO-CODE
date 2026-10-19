import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Inspect the artifact npm would publish, rather than only its source allowlist.
test('npm distribution includes startup services and excludes local state and bytecode', () => {
  const args = ['pack', '--dry-run', '--json', '--ignore-scripts'];
  const result = process.env.npm_execpath
    ? spawnSync(process.execPath, [process.env.npm_execpath, ...args], { encoding: 'utf8' })
    : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const files = JSON.parse(result.stdout)[0].files.map(file => file.path);
  for (const required of [
    '.mcp.json', '.vscode/mcp.json', 'scripts/setup.mjs', 'scripts/cloud-stack.sh', 'agents/jaco-cli.mjs',
    'agents/lib/local-stack.mjs', 'agents/remote-bridge.mjs',
    'gateway/src/seer-start.mjs', 'gateway/src/workplace/workplace-server.mjs',
    'runtime/package.json', 'runtime/package-lock.json', 'runtime/server.ts',
    'runtime/index.html', 'runtime/src/main.tsx', 'runtime/vite.config.ts',
    'runtime/gateway/package.json', 'runtime/gateway/package-lock.json',
    'runtime/gateway/src/a2a-server.mjs', 'runtime/termux/boot/10-jaco-auto-activate',
  ]) assert.ok(files.includes(required), `missing package file: ${required}`);
  assert.deepEqual(files.filter(file => /(^|\/)(node_modules|__pycache__|logs)\/|\.pyc$|(^|\/)\.env$|\.sqlite(?:-wal|-shm)?$/.test(file)), []);
});
