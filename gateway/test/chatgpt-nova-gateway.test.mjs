import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';

async function freePort() {
  return await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(err => err ? reject(err) : resolve(port));
    });
    s.on('error', reject);
  });
}

async function waitFor(url, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.status) return;
    } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error(`timeout waiting for ${url}`);
}

const port = await freePort();
const token = 'test-token-that-is-at-least-24-characters';
const child = spawn(process.execPath, ['gateway/src/chatgpt-nova-gateway.mjs'], {
  env: {
    ...process.env,
    JACO_GATEWAY_PORT: String(port),
    JACO_GATEWAY_HOST: '127.0.0.1',
    JACO_GATEWAY_TOKEN: token,
    JACO_GATEWAY_ALLOW_MUTATIONS: '0',
    JACO_NOVA_URL: 'http://127.0.0.1:9',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  await waitFor(`http://127.0.0.1:${port}/health`);

  const unauth = await fetch(`http://127.0.0.1:${port}/v1/nova/observe`);
  assert.equal(unauth.status, 401, 'observe must require bearer auth');

  const mutation = await fetch(`http://127.0.0.1:${port}/v1/nova/navigate`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ url: 'https://example.com' }),
  });
  assert.equal(mutation.status, 403, 'navigate must be denied when mutations are disabled');
  const body = await mutation.json();
  assert.equal(body.code, 'MUTATIONS_DISABLED');

  console.log('PASS chatgpt-nova-gateway auth + mutation policy');
} finally {
  child.kill('SIGTERM');
}
