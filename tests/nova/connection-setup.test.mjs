import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { clientConfig, installClient, mountConnectionSetup } from '../../runtime/src/server/connected/connectionSetup.mjs';

test('client setup preserves unrelated servers, backups and refuses overwriting JACO', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-connect-'));
  try {
    const options = { project: dir, home: dir, entry: 'C:/JACO with spaces/dist/jaco-editor.mjs', runtimeUrl: 'http://127.0.0.1:3100', workplaceUrl: 'http://127.0.0.1:3101' };
    const config = clientConfig('claude', options);
    const before = JSON.stringify({ mcpServers: { existing: { command: 'other' } }, custom: true });
    fs.writeFileSync(config.file, before);
    const result = installClient(config);
    const doc = JSON.parse(fs.readFileSync(config.file));
    assert.equal(doc.mcpServers.existing.command, 'other');
    assert.equal(doc.custom, true);
    assert.equal(doc.mcpServers['jaco-editor'].env.JACO_RUNTIME_URL, options.runtimeUrl);
    assert.equal(fs.readFileSync(result.backup, 'utf8'), before);
    assert.throws(() => installClient(config), /JACO_ALREADY_CONFIGURED/);
    const vs = clientConfig('vscode', options); installClient(vs);
    assert.equal(JSON.parse(fs.readFileSync(vs.file)).servers['jaco-editor'].type, 'stdio');
    const codex = clientConfig('codex', options);
    fs.mkdirSync(path.dirname(codex.file), { recursive: true }); fs.writeFileSync(codex.file, 'model = "existing"\n');
    installClient(codex);
    assert.ok(fs.readFileSync(codex.file, 'utf8').startsWith('model = "existing"'));
    assert.throws(() => installClient(codex), /JACO_ALREADY_CONFIGURED/);
    assert.throws(() => clientConfig('unknown', options), /UNKNOWN_CLIENT/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('malformed configuration is never overwritten', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-connect-'));
  try {
    const c = { file: path.join(dir, 'broken.json'), key: 'mcpServers', server: {} };
    fs.writeFileSync(c.file, '{broken');
    assert.throws(() => installClient(c), /CONFIG_NEEDS_REVIEW/);
    assert.equal(fs.readFileSync(c.file, 'utf8'), '{broken');
    fs.writeFileSync(c.file, '{"mcpServers":[]}');
    assert.throws(() => installClient(c), /CONFIG_NEEDS_REVIEW/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('setup routes all use the local same-origin guard and missing MCP cannot configure a client', async () => {
  const routes = []; const guard = () => {};
  const app = { get: (...args) => routes.push(args), post: (...args) => routes.push(args) };
  mountConnectionSetup(app, guard, { env: { JACO_RELEASE_ROOT: '/nonexistent-jaco' }, fetchImpl: async () => { throw Error('offline'); } });
  assert.equal(routes.length, 4); for (const r of routes) assert.equal(r[1], guard);
  let result; const res = { status: () => res, json: data => { result = data; } };
  await routes[0][2]({}, res);
  assert.equal(result.workplace, false); assert.equal(result.mcpIncluded, false); assert.equal(result.cloud.configured, false);
  routes[2][2]({ body: { client: 'codex' } }, res);
  assert.equal(result.error, 'MCP_NOT_INCLUDED');
});
