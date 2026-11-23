// The built-in filesystem tool server runs on JACO's bundled Node: offline, nothing downloaded on first use.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SERVER = path.join(ROOT, 'runtime', 'tools', 'jaco-filesystem-mcp.mjs');
const { loadServerConfig, StdioMcpHost } = await import('../../runtime/src/server/mcp/stdioMcpHost.mjs');

function server(t, root) {
  const proc = spawn(process.execPath, [SERVER, root], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  t.after(() => proc.kill());
  let buf = '', id = 0;
  const waiting = new Map();
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', chunk => {
    buf += chunk;
    for (let i; (i = buf.indexOf('\n')) >= 0;) { const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(msg.id)?.(msg); }
  });
  const rpc = (method, params = {}) => new Promise(resolve => { const n = ++id; waiting.set(n, resolve); proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
  const callTool = async (name, args) => { const r = (await rpc('tools/call', { name, arguments: args })).result; return { error: r.isError === true, text: r.content[0].text }; };
  return { rpc, callTool };
}
const workspace = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-fs-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return fs.realpathSync(dir); };

test('the built-in filesystem server needs no npx, npm or network', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-fs-cfg-'));
  const s = loadServerConfig({ configFile: path.join(dir, 'none.json'), repoRoot: dir, runtimeRoot: path.join(ROOT, 'runtime') });
  assert.equal(s.filesystem.command, process.execPath);
  assert.ok(s.filesystem.args[0].endsWith(path.join('tools', 'jaco-filesystem-mcp.mjs')));
  assert.equal(s.filesystem.args.at(-1), dir);
  assert.ok(fs.existsSync(s.filesystem.args[0]));
  for (const def of Object.values(s)) assert.notEqual(def.command, 'npx', 'no built-in server downloads a package on first use');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('tools keep the familiar names and declare which ones only read', async t => {
  const { rpc } = server(t, workspace(t));
  const init = await rpc('initialize', { protocolVersion: '2025-06-18' });
  assert.equal(init.result.serverInfo.name, 'jaco-filesystem');
  const tools = Object.fromEntries((await rpc('tools/list')).result.tools.map(x => [x.name, x.annotations.readOnlyHint]));
  for (const name of ['read_text_file', 'read_file', 'list_directory', 'directory_tree', 'search_files', 'get_file_info', 'list_allowed_directories']) assert.equal(tools[name], true, name);
  for (const name of ['write_file', 'edit_file', 'create_directory', 'move_file']) assert.equal(tools[name], false, name);
});

test('read, write, edit, list, search and move work inside the root', async t => {
  const root = workspace(t);
  const { callTool } = server(t, root);
  assert.equal((await callTool('write_file', { path: 'src/a.txt', content: 'one\ntwo\nthree' })).error, false);
  assert.equal((await callTool('read_text_file', { path: 'src/a.txt', head: 2 })).text, 'one\ntwo');
  assert.match((await callTool('edit_file', { path: 'src/a.txt', edits: [{ oldText: 'two', newText: 'TWO' }] })).text, /Edited src\/a\.txt/);
  assert.equal(fs.readFileSync(path.join(root, 'src/a.txt'), 'utf8'), 'one\nTWO\nthree');
  assert.match((await callTool('list_directory', { path: 'src' })).text, /\[FILE\] a\.txt/);
  assert.match((await callTool('search_files', { path: '.', pattern: 'a.t' })).text, /src\/a\.txt/);
  assert.match((await callTool('move_file', { source: 'src/a.txt', destination: 'b/a.txt' })).text, /Moved/);
  assert.ok(fs.existsSync(path.join(root, 'b/a.txt')));
});

test('an ambiguous or missing edit changes nothing', async t => {
  const root = workspace(t);
  fs.writeFileSync(path.join(root, 'x.txt'), 'same same');
  const { callTool } = server(t, root);
  assert.match((await callTool('edit_file', { path: 'x.txt', edits: [{ oldText: 'same', newText: 'y' }] })).text, /more than once/);
  assert.match((await callTool('edit_file', { path: 'x.txt', edits: [{ oldText: 'nope', newText: 'y' }] })).text, /not found/);
  assert.equal(fs.readFileSync(path.join(root, 'x.txt'), 'utf8'), 'same same');
});

test('paths outside the root, through links, and protected files are refused', async t => {
  const root = workspace(t);
  const outside = workspace(t);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'x');
  const { callTool } = server(t, root);
  for (const p of ['../x.txt', path.join(outside, 'secret.txt')]) {
    const r = await callTool('read_text_file', { path: p });
    assert.equal(r.error, true); assert.match(r.text, /outside/);
  }
  let linked = false;
  try { fs.symlinkSync(outside, path.join(root, 'link'), 'junction'); linked = true; } catch {}
  if (linked) {
    const r = await callTool('write_file', { path: 'link/new.txt', content: 'x' });
    assert.equal(r.error, true); assert.match(r.text, /outside/);
    assert.equal(fs.existsSync(path.join(outside, 'new.txt')), false);
  }
  for (const p of ['.env', '.git/config', 'node_modules/a.js']) {
    const r = await callTool('write_file', { path: p, content: 'x' });
    assert.equal(r.error, true, p); assert.match(r.text, /protected/);
  }
});

test('the MCP host starts it as a real server with tools', async t => {
  const root = workspace(t);
  const host = new StdioMcpHost({ configFile: path.join(root, 'none.json'), repoRoot: root, runtimeRoot: path.join(ROOT, 'runtime') });
  t.after(() => { for (const client of host.clients.values()) client.stop(); });
  const tools = await host.start('filesystem');
  assert.ok(tools.some(x => x.name === 'write_file'));
});
