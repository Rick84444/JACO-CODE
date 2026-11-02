import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  parseTerminalCommand, safeRuntimeUrl, enforceGitVerb, gitAdmission, gitContext,
  terminalGitCommand, joinPairedDevice,
} from '../../agents/lib/terminal-ide.mjs';

function project(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-terminal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true });
  git('init', '-b', 'main');
  git('config', 'user.name', 'JACO Test');
  git('config', 'user.email', 'jaco-test@example.invalid');
  fs.writeFileSync(path.join(dir, 'README.md'), 'initial\n');
  git('add', 'README.md');
  git('commit', '-m', 'Initial');
  return { dir, git };
}

test('a normal message is delegated to Aura; slash verbs never become arbitrary shell commands', () => {
  assert.deepEqual(parseTerminalCommand('fix the auth regression'), { kind: 'chat', text: 'fix the auth regression' });
  assert.deepEqual(parseTerminalCommand('/git status'), { kind: 'git', verb: 'status', args: [] });
  assert.deepEqual(parseTerminalCommand('/mcp install vscode'), { kind: 'mcp', verb: 'install', args: ['vscode'] });
  assert.deepEqual(parseTerminalCommand('/devices invite mobile'), { kind: 'devices', verb: 'invite', args: ['mobile'] });
  assert.deepEqual(parseTerminalCommand('/goal investigate CDP'), { kind: 'goal', text: 'investigate CDP' });
  assert.equal(parseTerminalCommand('/shell rm -rf /').kind, 'invalid');
  assert.throws(() => enforceGitVerb('push', ['--force']), /JACO_GIT_COMMAND_NOT_ALLOWED/);
  assert.throws(() => enforceGitVerb('reset', ['--hard']), /JACO_GIT_COMMAND_NOT_ALLOWED/);
  assert.throws(() => enforceGitVerb('status;', ['rm']), /JACO_GIT_COMMAND_NOT_ALLOWED/);
});

test('runtime URL is restricted to localhost HTTP or authenticated HTTPS origins', () => {
  assert.equal(safeRuntimeUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
  assert.equal(safeRuntimeUrl('https://ide.example.test:443'), 'https://ide.example.test');
  assert.throws(() => safeRuntimeUrl('http://10.0.0.1:3000'), /JACO_REMOTE_REQUIRES_HTTPS/);
  assert.throws(() => safeRuntimeUrl('https://person:password@ide.example.test'), /JACO_RUNTIME_URL_INVALID/);
  assert.throws(() => safeRuntimeUrl('https://ide.example.test/other'), /JACO_RUNTIME_URL_INVALID/);
});

test('real local Git status is read only, branch-aware and never creates a remote', async t => {
  const { dir, git } = project(t);
  const context = await gitContext(dir);
  assert.equal(context.branch, 'main');
  assert.equal(context.upstream, null);
  assert.equal(context.dirty, false);
  const messages = [];
  await terminalGitCommand({ project: dir, verb: 'status', confirm: () => { throw Error('NO_CONFIRM_FOR_READ'); }, write: s => messages.push(s) });
  assert.match(messages.join('\n'), /main/);
  assert.deepEqual(git('remote').trim(), '');
  fs.writeFileSync(path.join(dir, 'README.md'), 'changed\n');
  assert.equal((await gitContext(dir)).dirty, true);
});

test('Git push on main is blocked; pull refuses uncommitted work and a missing upstream', () => {
  assert.deepEqual(gitAdmission('push', { branch: 'main', dirty: false, upstream: 'origin/main' }), {
    allowed: false, reason: 'JACO_PROTECTED_BRANCH_PUSH_DENIED',
  });
  assert.deepEqual(gitAdmission('pull', { branch: 'feat/work', dirty: true, upstream: 'origin/feat/work' }), {
    allowed: false, reason: 'JACO_GIT_WORKTREE_DIRTY',
  });
  assert.deepEqual(gitAdmission('sync', { branch: 'feat/work', dirty: false, upstream: null }), {
    allowed: false, reason: 'JACO_GIT_UPSTREAM_MISSING',
  });
  assert.equal(gitAdmission('push', { branch: 'feat/work', dirty: false, upstream: 'origin/feat/work' }).allowed, true);
});

test('fetch refuses to run without the exact interactive branch confirmation', async t => {
  const { dir } = project(t);
  const executed = [];
  const runner = async (cmd, args) => {
    executed.push({cmd,args});
    if (args.includes('--show-toplevel')) return {stdout:dir + '\n'};
    if (args.includes('--show-current')) return {stdout:'main\n'};
    if (args.includes('--porcelain=v1')) return {stdout:''};
    if (args.includes('@{upstream}')) throw Error('missing');
    if (args.includes('fetch')) throw Error('GIT_FETCH_RAN');
    return {stdout:''};
  };
  const out = [];
  await terminalGitCommand({ project:dir, verb:'fetch', runner, confirm: async () => 'NO', write:s=>out.push(s) });
  assert.match(out.join('\n'), /Cancelled/);
  assert.ok(!executed.some(entry => entry.args.includes('fetch')));
  await assert.rejects(
    terminalGitCommand({ project:dir, verb:'fetch', runner, confirm:async () => 'FETCH main', write:s=>out.push(s) }),
    /GIT_FETCH_RAN/,
  );
});

test('pairing secret is sent via stdin, not argv, and pairing helper is bounded', async () => {
  let observed = null;
  function mockSpawn(exe, args, opts) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    child.stdin = { end(payload) { observed = { exe, args, opts, payload }; process.nextTick(() => {
      child.stdout.emit('data', 'Joined target.\n');
      child.emit('close', 0);
    }); } };
    return child;
  }
  const output = await joinPairedDevice({ root: process.cwd(), hub:'https://hub.example.test', code:'SECRETCODE1', spawnImpl:mockSpawn });
  assert.equal(output.trim(), 'Joined target.');
  assert.equal(observed.args.at(-1), '--code-stdin');
  assert.ok(!observed.args.some(a => a.includes('SECRETCODE1')));
  assert.equal(observed.payload, 'SECRETCODE1\n');
  assert.equal(observed.opts.shell, false);
});

test('terminal CLI entry is explicit and does not launch background work on --help', () => {
  const entry = new URL('../../agents/jaco-cli.mjs', import.meta.url);
  const r = spawnSync(process.execPath, [entry.pathname, 'ide', '--help'], {
    cwd: path.resolve(new URL('../..', import.meta.url).pathname), encoding:'utf8', timeout:10000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /jaco ide/);
});

test('VS Code MCP uses the canonical installer and existing device pairing tools', () => {
  const require = createRequire(import.meta.url);
  const root = path.resolve(new URL('../..', import.meta.url).pathname);
  const terminal = fs.readFileSync(path.join(root, 'agents/lib/terminal-ide.mjs'), 'utf8');
  const cli = fs.readFileSync(path.join(root, 'agents/jaco-cli.mjs'), 'utf8');
  const termux = fs.readFileSync(path.join(root, 'runtime/bin/jaco'), 'utf8');
  assert.match(terminal, /clientConfig, installClient/);
  assert.match(terminal, /tools', 'device.mjs/);
  assert.match(terminal, /tools', 'join-hub.mjs/);
  assert.match(terminal, /git', \['-C', project/);
  assert.match(cli, /runTerminalIDE/);
  assert.match(termux, /activate\|status\|ide/);
  assert.ok(require('../../package.json').files.includes('JACO-Terminal.cmd'));
});
