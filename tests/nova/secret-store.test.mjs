// JACO's encrypted secret store, the vault outside Windows, and the JACO Connect MCP server:
// values go in encrypted and no read path a client can reach returns them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { SecretStore, generateSecretValue, credential } from '../../agents/lib/secret-store.mjs';

const tmp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-secrets-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };

test('values are sealed on disk, readable in process, described without the value', t => {
  const dir = tmp(t);
  const store = new SecretStore({ env: {}, dir });
  const d = store.set('DEEPSEEK_API_KEY', 'sk-live-very-secret-1234', { purpose: 'deepseek' });
  assert.deepEqual([d.name, d.configured, d.length, d.purpose], ['DEEPSEEK_API_KEY', true, 24, 'deepseek']);
  const disk = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8');
  assert.equal(disk.includes('very-secret'), false, 'no plaintext on disk');
  assert.equal(JSON.stringify(store.list()).includes('very-secret'), false);
  assert.equal(store.get('DEEPSEEK_API_KEY'), 'sk-live-very-secret-1234');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'secret.key')).mode & 0o077, 0, 'master key is private');
});

test('a ciphertext moved to another name or a wrong master key does not decrypt', t => {
  const dir = tmp(t);
  const store = new SecretStore({ env: {}, dir });
  store.set('A_KEY', 'value-a');
  const file = path.join(dir, 'secrets.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.secrets.B_KEY = data.secrets.A_KEY;
  fs.writeFileSync(file, JSON.stringify(data));
  assert.throws(() => store.get('B_KEY'));
  const other = new SecretStore({ env: { JACO_SECRET_KEY: 'ab'.repeat(32) }, dir });
  assert.throws(() => other.get('A_KEY'));
});

test('names are validated and the environment wins over the store', t => {
  const dir = tmp(t);
  const store = new SecretStore({ env: {}, dir });
  assert.throws(() => store.set('lower', 'x'), /INVALID_SECRET_NAME/);
  assert.throws(() => store.set('OK_NAME', ''), /SECRET_VALUE_REQUIRED/);
  store.set('GROQ_API_KEY', 'from-store');
  assert.equal(credential('GROQ_API_KEY', { env: {}, store }), 'from-store');
  assert.equal(credential('GROQ_API_KEY', { env: { GROQ_API_KEY: 'from-env' }, store }), 'from-env');
  assert.equal(credential('MISSING_KEY', { env: {}, store }), '');
  assert.equal(store.delete('GROQ_API_KEY'), true);
  assert.equal(store.has('GROQ_API_KEY'), false);
});

test('generated passwords are strong and varied', () => {
  const a = generateSecretValue(24), b = generateSecretValue(24);
  assert.equal(a.length, 24); assert.notEqual(a, b);
  assert.ok(/[A-Z]/.test(a) && /[a-z]/.test(a) && /\d/.test(a) && /[-_.!@#%]/.test(a));
  assert.equal(generateSecretValue(3).length, 16);
});

const rpc = (dir, messages) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['runtime/tools/jaco-connect-mcp.mjs'], {
    env: { ...process.env, JACO_STATE_DIR: dir, JACO_RUNTIME_URL: 'http://127.0.0.1:9' }, stdio: ['pipe', 'pipe', 'inherit'],
  });
  let out = '';
  const replies = [];
  child.stdout.on('data', chunk => {
    out += chunk;
    for (let i; (i = out.indexOf('\n')) >= 0;) { replies.push(JSON.parse(out.slice(0, i))); out = out.slice(i + 1); }
    // Replies may arrive in any order (JSON-RPC); return them in request order by id.
    if (replies.length === messages.length) { child.kill(); resolve(messages.map(m => replies.find(r => r.id === m.id))); }
  });
  child.on('error', reject);
  setTimeout(() => { child.kill(); reject(new Error('MCP_TIMEOUT')); }, 15000).unref();
  for (const m of messages) child.stdin.write(JSON.stringify(m) + '\n');
});

test('JACO Connect over stdio: secrets go in, only names and lengths come out', async t => {
  const dir = tmp(t);
  const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  const [init, list, stored, generated, status, refused, offline] = await rpc(dir, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    call(3, 'store_secret', { name: 'MISTRAL_API_KEY', value: 'm-secret-value-123' }),
    call(4, 'generate_secret', { name: 'NOVA_GROQ_PASSWORD', length: 20 }),
    call(5, 'secret_status', {}),
    call(6, 'store_secret', { name: 'bad name', value: 'leak-me-not' }),
    call(7, 'connect_provider', { url: 'deepseek.com' }),
  ]);
  assert.equal(init.result.serverInfo.name, 'jaco-connect');
  const tools = list.result.tools.map(x => x.name);
  for (const name of ['connect_provider', 'list_connections', 'store_secret', 'generate_secret', 'secret_status', 'request_account']) assert.ok(tools.includes(name), name);
  assert.equal(list.result.tools.find(x => x.name === 'store_secret').annotations.readOnlyHint, false);
  const all = JSON.stringify([stored, generated, status, refused]);
  assert.equal(all.includes('m-secret-value-123'), false, 'stored value never returned');
  assert.equal(all.includes('leak-me-not'), false, 'a refused value is not echoed');
  assert.match(stored.result.content[0].text, /"length": 18/);
  assert.match(generated.result.content[0].text, /"created": true/);
  assert.deepEqual(JSON.parse(status.result.content[0].text).map(s => s.name), ['MISTRAL_API_KEY', 'NOVA_GROQ_PASSWORD']);
  assert.equal(refused.result.isError, true);
  assert.equal(offline.result.isError, true);
  assert.match(offline.result.content[0].text, /runtime unreachable/);
  assert.equal(new SecretStore({ env: {}, dir }).get('MISTRAL_API_KEY'), 'm-secret-value-123');
});
