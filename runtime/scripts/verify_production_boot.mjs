#!/usr/bin/env node
// Proves that the built JACO backend starts and serves the bundled IDE.
// No external model, Chrome, account credentials, or paid services are required.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-boot-smoke-'));
const diagnostics = { stdout: '', stderr: '' };
const retain = (type, data) => {
  diagnostics[type] = (diagnostics[type] + String(data)).slice(-12000);
};

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function verify() {
  assert.ok(fs.existsSync(path.join(root, 'dist/server.cjs')), 'Production server bundle is missing');
  assert.ok(fs.existsSync(path.join(root, 'dist/index.html')), 'Production IDE bundle is missing');

  const port = await availablePort();
  const env = {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    NODE_ENV: 'production',
    JACO_LITE: '1',
    JACO_STATE_DIR: path.join(temp, 'state'),
    JACO_WORKTREE_STATE_DIR: path.join(temp, 'worktrees'),
    JACO_RELEASE_ROOT: root,
    JACO_WORKSPACE_ROOT: root,
    JACO_GATEWAY_TOKEN: crypto.randomBytes(32).toString('hex'),
    JACO_AUTO_START_TOOLS: '0',
    JACO_ALLOW_PAID_MODELS: '0',
    JACO_CONTINUUM_AUTOSTART: '0',
    JACO_START_TUNNEL: '0',
  };
  const child = spawn(process.execPath, ['dist/server.cjs'], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', data => retain('stdout', data));
  child.stderr.on('data', data => retain('stderr', data));
  let stopped = null;
  const exited = new Promise(resolve => {
    child.once('exit', (code, signal) => {
      stopped = { code, signal };
      resolve(stopped);
    });
    child.once('error', error => {
      stopped = { error: error.message };
      resolve(stopped);
    });
  });

  try {
    let identity = null;
    let lastError = null;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !stopped) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/runtime/identity`, {
          signal: AbortSignal.timeout(1200),
        });
        if (!response.ok) throw Error(`Identity HTTP ${response.status}`);
        identity = await response.json();
        break;
      } catch (error) {
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    assert.ok(identity, `Production runtime did not start: ${stopped ? JSON.stringify(stopped) : String(lastError)}`);
    assert.equal(identity.success, true, 'Runtime identity must report success');
    assert.equal(identity.product, 'JACO Autonomus IDE', 'Unexpected runtime identity');
    assert.equal(identity.version, manifest.version, 'Runtime version mismatch');
    assert.equal(Number(identity.primaryPort), port, 'Runtime is not bound to the expected port');

    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200, 'The IDE home page did not return HTTP 200');
    const html = await response.text();
    assert.match(html, /<html\b/i, 'The IDE did not serve HTML');
    assert.match(html, /<title>[^<]+<\/title>/i, 'The IDE document title is missing');
    console.log(`PRODUCTION_BOOT_SMOKE: PASS (version=${manifest.version}, identity=HTTP_200, ide=HTTP_200)`);
  } catch (error) {
    console.error(`PRODUCTION_BOOT_SMOKE: FAIL (${error.message})`);
    console.error(`SERVER_STDERR:\n${diagnostics.stderr || '(empty)'}`);
    console.error(`SERVER_STDOUT:\n${diagnostics.stdout || '(empty)'}`);
    throw error;
  } finally {
    if (!stopped) child.kill('SIGTERM');
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
    if (!stopped) child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

await verify();
