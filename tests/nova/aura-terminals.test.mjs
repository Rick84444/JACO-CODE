import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAuraTerminals, terminalName, redactTerminal } from '../../runtime/src/server/mcp/auraTerminals.mjs';
import { TOOLS } from '../../runtime/tools/jaco-shell-mcp.mjs';

const reply = (data, isError = false) => ({ isError, content: [{ type: 'text', text: JSON.stringify(data) }] });

test('each terminal keeps its own folder and its own history', async () => {
  const terminals = createAuraTerminals(), sent = [];
  const call = async args => { sent.push(args); return reply({ ok: true, stdout: 'done ' + args.command }); };
  await terminals.run({ terminal: 'build', command: 'npm', args: ['test'], cwd: 'runtime' }, call);
  await terminals.run({ terminal: 'git', command: 'git status' }, call);
  await terminals.run({ terminal: 'build', command: 'ls' }, call);
  assert.deepEqual(sent.map(a => a.cwd), ['runtime', undefined, 'runtime']);
  assert.ok(sent.every(a => !('terminal' in a)), 'the shell never sees the window name');
  const list = terminals.list();
  assert.deepEqual(list.map(t => t.name), ['build', 'git']);
  assert.deepEqual(list[0].entries.map(e => e.command), ['npm test', 'ls']);
});

test('a refused or failed command is shown as failed, keeps the old folder and still reaches the caller', async () => {
  const terminals = createAuraTerminals();
  await terminals.run({ command: 'ls', cwd: 'runtime' }, async () => reply({ ok: true, stdout: 'a' }));
  const refused = reply({ ok: false, refused: true, reason: 'CWD_OUTSIDE_WORKSPACE_OR_PROTECTED' }, true);
  assert.equal(await terminals.run({ command: 'ls', cwd: '../..' }, async () => refused), refused);
  await assert.rejects(terminals.run({ command: 'ls' }, async () => { throw Error('TASK_TURNED_OFF_BY_OPERATOR:shell'); }), /TURNED_OFF/);
  const [main] = terminals.list();
  assert.equal(main.name, 'main');
  assert.equal(main.cwd, 'runtime');
  assert.deepEqual(main.entries.map(e => e.ok), [true, false, false]);
});

test('token shapes are not shown, names are bounded and old windows make room', async () => {
  const terminals = createAuraTerminals();
  const secret = 'ghp_' + 'a'.repeat(36);
  await terminals.run({ terminal: 'x', command: `echo ${secret}` }, async () => reply({ ok: true, stdout: `Authorization: Bearer ${secret}` }));
  assert.ok(!JSON.stringify(terminals.list()).includes(secret));
  assert.equal(terminalName('<img src=x>' + 'n'.repeat(80)).length, 24);
  assert.equal(terminalName(''), 'main');
  for (let i = 0; i < 9; i++) await terminals.run({ terminal: `t${i}`, command: 'ls' }, async () => reply({ ok: true }));
  assert.equal(terminals.list().length, 6);
  assert.ok(!terminals.list().some(t => t.name === 'x'));
});

test('file names and commit ids stay readable while key shapes are removed', () => {
  const keep = [' M packages/jaco-browser-mcp/ci/jaco-browser-mcp.workflow.yml', '?? openspec/changes/add-aura-multi-terminals/', '9ed0572c69f3531c561bfafe82267d783b2260c2'].join(' | ');
  assert.equal(redactTerminal(keep), keep);
  for (const secret of ['AIza' + 'B'.repeat(35), 'gsk_' + 'a1'.repeat(20), 'f'.repeat(64), 'Zm9vYmFyQmF6MTIzNDU2Nzg5MGFiY2RlZkdISUo', 'API_KEY=hunter2hunter2'])
    assert.ok(redactTerminal(`value ${secret} end`).includes('[secret]'), secret.slice(0, 12));
});

test('the shell tools offer the terminal name and the chat route goes through the terminals', () => {
  for (const name of ['shell_run', 'shell_read']) assert.ok(TOOLS.find(t => t.name === name).inputSchema.properties.terminal, name);
  const read = p => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
  assert.match(read('runtime/src/server/mcp/auraAgentMcpCall.mjs'), /auraTerminals\.run\(args, send\)/);
  const server = read('runtime/server.ts');
  for (const route of ["app.get('/api/aura/terminals', requireLocalUiSameOrigin", "app.get('/api/aura/browser/tabs', requireLocalUiSameOrigin", "app.post('/api/aura/browser/tabs/switch', requireLocalUiSameOrigin"])
    assert.ok(server.includes(route), route);
});
