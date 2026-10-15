// A workspace interface with per-workspace access, and an agent home with capped, redacted notes and memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalWorkspace, RemoteShellWorkspace } from '../../agents/lib/workspace.mjs';
import { agentHomeDir, ensureHome, loadHome, appendMemory, HOME_LIMITS } from '../../agents/lib/agent-home.mjs';
import { homeCli } from '../../agents/lib/home-cli.mjs';
import { introMessage } from '../../agents/lib/agent-loop.mjs';

const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-ws-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test('workspace: ro lists and reads, refuses to write; rw writes inside the root; none refuses everything', async t => {
  const root = tmp(t);
  fs.writeFileSync(path.join(root, 'a.txt'), 'hej');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1');
  const ro = new LocalWorkspace({ root, access: 'ro' });
  assert.deepEqual(ro.list().entries.map(e => e.name), ['a.txt'], 'a .env file is not even listed');
  assert.equal(ro.read('a.txt').content, 'hej');
  assert.equal(ro.read('.env').refused, true);
  assert.equal(ro.write('b.txt', 'x').reason, 'WORKSPACE_READ_ONLY');
  assert.equal((await ro.run({ command: 'cat', args: ['a.txt'] })).stdout, 'hej');
  assert.equal((await ro.run({ command: 'touch', args: ['b.txt'] })).refused, true, 'ro runs read-only commands only');
  const rw = new LocalWorkspace({ root, access: 'rw' });
  assert.equal(rw.write('sub/b.txt', 'ny').ok, true);
  assert.equal(fs.readFileSync(path.join(root, 'sub', 'b.txt'), 'utf8'), 'ny');
  assert.equal(rw.write('.git/config', 'x').refused, true);
  assert.equal(rw.write('../escape.txt', 'x').refused, true);
  const none = new LocalWorkspace({ root, access: 'none' });
  for (const r of [none.list(), none.read('a.txt'), none.write('c', 'x'), await none.run({ command: 'ls' })]) assert.equal(r.refused, true);
  assert.throws(() => new LocalWorkspace({ root, access: 'root' }), /ACCESS_INVALID/);
});

test('workspace: a symlink out of the root is not followed for reads or writes', async t => {
  const root = tmp(t), outside = tmp(t);
  fs.writeFileSync(path.join(outside, 'private.txt'), 'nej');
  try { fs.symlinkSync(outside, path.join(root, 'link')); } catch { return t.skip('no symlinks here'); }
  const rw = new LocalWorkspace({ root, access: 'rw' });
  assert.match(rw.read('link/private.txt').reason, /PATH_OUTSIDE_WORKSPACE/);
  assert.match(rw.write('link/new.txt', 'x').reason, /PATH_OUTSIDE_WORKSPACE/);
  assert.equal(fs.existsSync(path.join(outside, 'new.txt')), false);
});

test('remote shell workspace: the same calls go through the device\'s shell tools, access decides which', async () => {
  const calls = [];
  const callTool = async (name, args) => { calls.push([name, args]); return { content: [{ type: 'text', text: JSON.stringify({ ok: true, stdout: 'x' }) }] }; };
  const ro = new RemoteShellWorkspace({ callTool, access: 'ro' });
  await ro.read('a.txt'); await ro.run({ command: 'git', args: ['status'] });
  assert.deepEqual(calls.map(c => c[0]), ['shell_read', 'shell_read']);
  assert.equal((await ro.write('a', 'b')).refused, true);
  const rw = new RemoteShellWorkspace({ callTool, access: 'rw' });
  await rw.run({ command: 'npm', args: ['test'], timeoutSeconds: 60 });
  assert.deepEqual(calls.at(-1), ['shell_run', { command: 'npm', args: ['test'], timeoutSeconds: 60 }]);
  const none = new RemoteShellWorkspace({ callTool, access: 'none' });
  assert.equal((await none.run({ command: 'ls' })).refused, true);
  assert.equal(calls.length, 3, 'a refused call never reached the device');
  const broken = new RemoteShellWorkspace({ callTool: async () => ({ content: [{ type: 'text', text: 'not json' }] }) });
  assert.equal((await broken.read('x')).error, 'REMOTE_REPLY_INVALID');
});

test('home: templates are created once, today and yesterday are loaded, MEMORY.md only in the private session', t => {
  const dir = path.join(tmp(t), 'nova');
  const first = ensureHome(dir);
  assert.deepEqual(first.created.sort(), ['AGENTS.md', 'MEMORY.md', 'SOUL.md', 'USER.md']);
  assert.deepEqual(ensureHome(dir).created, [], 'nothing is overwritten');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'Kör npm test före varje commit.');
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), 'Operatören föredrar svenska.');
  const now = new Date('2026-10-13T12:00:00Z');
  appendMemory(dir, 'Fixade lint i agents/', { now });
  fs.writeFileSync(path.join(dir, 'memory', '2026-10-12.md'), '- igår: pushade #166');
  fs.writeFileSync(path.join(dir, 'memory', '2026-10-10.md'), '- för gammalt');
  const mine = loadHome(dir, { isPrivate: true, now });
  assert.match(mine.text, /Kör npm test/); assert.match(mine.text, /föredrar svenska/); assert.match(mine.text, /Fixade lint/); assert.match(mine.text, /igår: pushade/);
  assert.doesNotMatch(mine.text, /för gammalt/);
  const shared = loadHome(dir, { isPrivate: false, now });
  assert.doesNotMatch(shared.text, /föredrar svenska/, 'curated memory stays out of shared sessions');
});

test('home: files are capped (newest part kept), secrets become handles, symlinks are not read', t => {
  const dir = path.join(tmp(t), 'nova'); ensureHome(dir);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'GAMMALT '.repeat(5000) + 'NYTT SLUT');
  const key = 'sk-proj-AbCdEfGhIjKlMnOpQrStUvWx0123456789';
  fs.writeFileSync(path.join(dir, 'USER.md'), `Min nyckel är ${key}`);
  const h = loadHome(dir, { limits: { ...HOME_LIMITS, perFile: 1000 } });
  const agents = h.files.find(f => f.name === 'AGENTS.md');
  assert.equal(agents.truncated, true);
  assert.match(h.text, /NYTT SLUT/);
  assert.ok(!h.text.includes(key), 'the key never reaches the prompt');
  assert.throws(() => appendMemory(dir, ''), /EMPTY/);
  assert.throws(() => appendMemory(dir, 'x'.repeat(HOME_LIMITS.entry + 1)), /TOO_LONG/);
  assert.ok(!fs.readFileSync(path.join(dir, appendMemory(dir, `lade in ${key}`)), 'utf8').includes(key), 'a key is not written to the log either');
  const outside = path.join(tmp(t), 'o.txt'); fs.writeFileSync(outside, 'HEMLIGT');
  fs.rmSync(path.join(dir, 'SOUL.md')); try { fs.symlinkSync(outside, path.join(dir, 'SOUL.md')); } catch { return; }
  assert.doesNotMatch(loadHome(dir).text, /HEMLIGT/);
});

test('home: the agent name is checked, the folder follows JACO_AGENT_HOME, and the CLI works end to end', t => {
  assert.throws(() => agentHomeDir('../etc'), /AGENT_ID_INVALID/);
  const base = tmp(t), env = { JACO_AGENT_HOME: path.join(base, 'h') };
  assert.equal(agentHomeDir('nova', env), path.join(base, 'h'));
  let out = ''; const say = s => { out += s; };
  assert.equal(homeCli(['init'], env, say), 0);
  assert.equal(homeCli(['note', 'kom', 'ihåg', 'detta'], env, say), 0);
  assert.equal(homeCli(['show'], env, say), 0);
  assert.match(out, /kom ihåg detta/);
  assert.equal(homeCli(['note'], env, say), 2);
  assert.equal(homeCli(['init', '--agent', 'Bad Name'], env, say), 2);
});

test('the mission message carries the home text with more room than other extras', () => {
  const long = 'x'.repeat(30000);
  const msg = introMessage({ id: 'm1', goal: 'g', allowedTasks: [] }, { 'Your home (notes)': long, Other: long });
  const line = key => msg.split('\n').find(l => l.startsWith(`${key}:`));
  assert.ok(line('Your home (notes)').length > 15000 && line('Your home (notes)').length < 16200, 'cut at 16000');
  assert.ok(line('Other').length > 3900 && line('Other').length < 4200, 'cut at 4000');
});
