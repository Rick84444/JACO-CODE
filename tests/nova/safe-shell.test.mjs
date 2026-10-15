import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { classify, SafeShell, commandEnv, resolveProgram, LIMITS } from '../../agents/lib/safe-shell.mjs';

const posix = process.platform !== 'win32';
function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-shell-'));
  fs.mkdirSync(path.join(dir, 'src')); fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'console.log("hello from a")\n'); fs.writeFileSync(path.join(dir, 'README.md'), 'readme\n');
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1\n');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'node --test', hi: 'node src/a.js' } }));
  spawnSync('git', ['init', '-q'], { cwd: dir }); spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dir });
  return dir;
}
const c = (ws, command, args, extra = {}) => classify(command, args, { workspace: ws, cwd: ws, env: {}, ...extra });

test('only listed programs run, and a command is a program with arguments, never a line a shell would read', () => {
  const ws = workspace();
  for (const bad of ['sh', 'bash', 'env', 'sudo', 'su', 'ssh', 'curl', 'wget', 'pkg', 'apt', 'python', 'powershell', 'cmd', 'xargs', 'eval', 'nc'])
    assert.match(c(ws, bad, []).reason, /PROGRAM_NOT_ALLOWED/, bad);
  for (const bad of ['ls; rm -rf /', 'ls && id', '$(id)', '../../bin/ls', '/bin/ls', 'ls ', '', 'l s']) assert.match(c(ws, bad, []).reason, /COMMAND_NAME_INVALID/, JSON.stringify(bad));
  // metacharacters in arguments are just characters: nothing to inject into
  assert.equal(c(ws, 'ls', ['; rm -rf /', '$(id)', '`id`', '| cat', '> out']).ok, true, 'literal arguments are fine, they name files that do not exist');
  assert.equal(c(ws, 'ls', Array(100).fill('a')).reason, 'ARGUMENTS_INVALID');
  assert.equal(c(ws, 'ls', [1]).reason, 'ARGUMENTS_INVALID');
  assert.equal(c(ws, 'ls', ['a\0b']).reason, 'ARGUMENTS_INVALID');
});

test('paths stay inside the workspace, symlinks included, and secrets are never read', { skip: !posix }, () => {
  const ws = workspace(), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
  fs.writeFileSync(path.join(outside, 'x.txt'), 'outside');
  fs.symlinkSync(outside, path.join(ws, 'link'));
  assert.equal(c(ws, 'cat', ['src/a.js']).ok, true);
  for (const bad of ['/etc/passwd', '../x', '../../etc/passwd', '~/.ssh/id_rsa', 'link/x.txt', 'src/../../x'])
    assert.match(c(ws, 'cat', [bad]).reason, /PATH_OUTSIDE_WORKSPACE|HOME_PATH/, bad);
  for (const bad of ['.env', 'src/.env.local', 'my-secrets.txt', 'credentials.json']) assert.match(c(ws, 'cat', [bad]).reason, /PROTECTED_PATH/, bad);
  assert.match(c(ws, 'grep', ['-e', 'x', '/etc']).reason, /OUTSIDE/);
  assert.equal(c(ws, 'grep', ['-rn', 'a/b', 'src']).ok, true, 'a pattern with a slash is a pattern, not a path');
  assert.match(c(ws, 'grep', ['-f', '/etc/passwd', 'src']).reason, /GREP_PATTERN_FILE/);
  assert.match(c(ws, 'find', ['.', '-exec', 'rm', '{}', ';']).reason, /FIND_ACTION/);
  assert.match(c(ws, 'find', ['.', '-delete']).reason, /FIND_ACTION/);
  assert.match(c(ws, 'find', ['/', '-name', 'x']).reason, /OUTSIDE/);
  assert.match(c(ws, 'tail', ['-f', 'README.md']).reason, /FOLLOW/);
  // a file that does not exist yet is judged by where it would be
  assert.equal(c(ws, 'touch', ['new.txt']).ok, true);
  assert.match(c(ws, 'touch', ['link/new.txt']).reason, /OUTSIDE/);
  assert.match(c(ws, 'touch', ['.git/hooks/pre-commit']).reason, /PROTECTED/);
  assert.equal(c(ws, 'cat', ['.git/config'], { mode: 'read' }).ok, true, 'reading .git is not secret');
  assert.match(c(ws, 'touch', ['node_modules/x']).reason, /PROTECTED/);
});

test('git: read subcommands read, the rest write, and options that run programs or leave the repository are refused', () => {
  const ws = workspace();
  for (const sub of ['status', 'diff', 'log', 'show', 'blame', 'ls-files', 'rev-parse']) assert.equal(c(ws, 'git', [sub], { mode: 'read' }).ok, true, sub);
  assert.equal(c(ws, 'git', ['branch'], { mode: 'read' }).ok, true);
  assert.equal(c(ws, 'git', ['remote', '-v'], { mode: 'read' }).ok, true);
  for (const sub of ['add', 'commit', 'merge', 'fetch']) { assert.equal(c(ws, 'git', [sub, '-x']).mode, 'write', sub); assert.match(c(ws, 'git', [sub], { mode: 'read' }).reason, /WRITE_COMMAND_IN_READ_MODE/, sub); }
  for (const bad of [['-c', 'core.sshCommand=evil', 'status'], ['-C', '/', 'status'], ['--git-dir=/x', 'status']]) assert.match(c(ws, 'git', bad).reason, /GIT_OPTIONS_BEFORE_SUBCOMMAND/);
  for (const bad of [['diff', '--no-index', '/etc/passwd', '/etc/hosts'], ['diff', '--output=x'], ['log', '--output', 'x'], ['grep', '-O', 'sh', 'x'], ['show', '--ext-diff'], ['fetch', '--upload-pack=evil']])
    assert.match(c(ws, 'git', bad).reason, /GIT_OPTION_NOT_ALLOWED/, bad.join(' '));
  assert.match(c(ws, 'git', ['remote', 'add', 'x', 'url']).reason, /GIT_REMOTE_CHANGE/);
  assert.match(c(ws, 'git', ['daemon']).reason, /GIT_SUBCOMMAND_NOT_ALLOWED/);
});

test('destructive uses and push are the operator\'s to enable, never the agent\'s', () => {
  const ws = workspace();
  for (const [cmd, args] of [['git', ['reset', '--hard']], ['git', ['clean', '-fd']], ['git', ['checkout', '--', '.']], ['git', ['branch', '-D', 'x']], ['git', ['stash', 'drop']], ['git', ['restore', '.']], ['git', ['rebase', 'main']], ['git', ['pull']], ['rm', ['-rf', 'src']], ['rm', ['-r', 'src']], ['rm', ['-f', 'README.md']]])
    assert.match(c(ws, cmd, args).reason, /DESTRUCTIVE_NOT_ENABLED/, `${cmd} ${args.join(' ')}`);
  assert.match(c(ws, 'git', ['push']).reason, /GIT_PUSH_NOT_ENABLED/);
  assert.match(c(ws, 'git', ['push', '--force'], { env: { JACO_SHELL_ALLOW_DESTRUCTIVE: '1' } }).reason, /GIT_PUSH_NOT_ENABLED/, 'destructive does not enable push');
  assert.equal(c(ws, 'git', ['push'], { env: { JACO_SHELL_ALLOW_PUSH: '1' } }).ok, true);
  assert.equal(c(ws, 'git', ['reset', '--hard'], { env: { JACO_SHELL_ALLOW_DESTRUCTIVE: '1' } }).destructive, 'GIT_RESET');
  assert.equal(c(ws, 'rm', ['-r', 'src'], { env: { JACO_SHELL_ALLOW_DESTRUCTIVE: '1' } }).ok, true);
  // even enabled, the workspace itself and protected places are not removable
  assert.match(c(ws, 'rm', ['-r', '.'], { env: { JACO_SHELL_ALLOW_DESTRUCTIVE: '1' } }).reason, /RM_OF_WORKSPACE_ROOT/);
  assert.match(c(ws, 'rm', ['-r', '.git'], { env: { JACO_SHELL_ALLOW_DESTRUCTIVE: '1' } }).reason, /PROTECTED/);
  assert.match(c(ws, 'rm', []).reason, /RM_NEEDS_A_PATH/);
  // safe ones need nothing
  for (const [cmd, args] of [['git', ['checkout', '-b', 'topic']], ['git', ['restore', '--staged', 'src/a.js']], ['git', ['pull', '--ff-only']], ['rm', ['README.md']], ['git', ['stash']], ['git', ['switch', 'x']]]) assert.equal(c(ws, cmd, args).ok, true, `${cmd} ${args.join(' ')}`);
});

test('node and python run a script in the workspace, never inline code; npm runs project scripts, never installs packages', () => {
  const ws = workspace();
  assert.equal(c(ws, 'node', ['src/a.js']).ok, true);
  assert.equal(c(ws, 'node', ['--version'], { mode: 'read' }).ok, true);
  for (const bad of [['-e', 'process.exit()'], ['--eval=1'], ['-p', '1'], ['-r', 'x', 'src/a.js'], ['--require=x', 'src/a.js'], ['--import', 'x', 'src/a.js'], ['--env-file=.env', 'src/a.js'], ['--input-type=module', 'src/a.js'], ['-i']])
    assert.match(c(ws, 'node', bad).reason, /NODE_INLINE_CODE/, bad.join(' '));
  assert.match(c(ws, 'node', ['/tmp/evil.js']).reason, /OUTSIDE/);
  assert.match(c(ws, 'node', ['../evil.js']).reason, /OUTSIDE/);
  assert.match(c(ws, 'python3', ['-c', 'import os']).reason, /PYTHON_INLINE/);
  assert.match(c(ws, 'python3', ['-m', 'http.server']).reason, /PYTHON_INLINE/);
  for (const ok of [['test'], ['run', 'hi'], ['ci'], ['install'], ['ls']]) assert.equal(c(ws, 'npm', ok).ok, true, ok.join(' '));
  assert.equal(c(ws, 'npm', ['ls'], { mode: 'read' }).ok, true);
  assert.match(c(ws, 'npm', ['test'], { mode: 'read' }).reason, /WRITE_COMMAND_IN_READ_MODE/);
  assert.match(c(ws, 'npm', ['install', 'left-pad']).reason, /NPM_INSTALL_OF_PACKAGES/);
  assert.match(c(ws, 'npm', ['publish']).reason, /NPM_SUBCOMMAND_NOT_ALLOWED/);
  assert.match(c(ws, 'npm', ['exec', 'x']).reason, /NPM_SUBCOMMAND_NOT_ALLOWED/);
  assert.match(c(ws, 'npx', ['x']).reason, /PROGRAM_NOT_ALLOWED/);
});

test('read mode refuses everything that changes something', () => {
  const ws = workspace();
  for (const [cmd, args] of [['mkdir', ['x']], ['touch', ['x']], ['cp', ['a', 'b']], ['mv', ['a', 'b']], ['rm', ['x']], ['git', ['commit', '-m', 'x']], ['node', ['src/a.js']], ['npm', ['test']]])
    assert.match(c(ws, cmd, args, { mode: 'read' }).reason, /WRITE_COMMAND_IN_READ_MODE/, cmd);
  for (const [cmd, args] of [['ls', ['-la']], ['cat', ['README.md']], ['head', ['-n', '5', 'README.md']], ['wc', ['-l', 'README.md']], ['grep', ['-rn', 'hello', 'src']], ['find', ['.', '-name', '*.js']], ['pwd', []], ['git', ['status', '--short']]])
    assert.equal(c(ws, cmd, args, { mode: 'read' }).ok, true, cmd);
});

test('the command gets a minimal environment: no token, key or password of the server reaches it', () => {
  const env = commandEnv({ PATH: '/usr/bin', HOME: '/h', DEEPSEEK_API_KEY: 'sk-x', JACO_GATEWAY_TOKEN: 't', GITHUB_TOKEN: 'g', BLAND_API_KEY: 'b', JACO_DRIVE_CRED: 'd', LANG: 'sv_SE.UTF-8' });
  assert.deepEqual(Object.keys(env).sort(), ['CI', 'GIT_TERMINAL_PROMPT', 'HOME', 'LANG', 'NO_COLOR', 'PATH']);
  assert.deepEqual(resolveProgram('npm', 'win32', 'C:\\node\\node.exe', () => true).prefix.length, 1, 'npm.cmd is never started directly on Windows');
  assert.equal(resolveProgram('git', 'win32').cmd, 'git');
});

test('real runs in a real folder: output, exit codes, refusals, no interpretation of metacharacters', { skip: !posix }, async () => {
  const ws = workspace();
  const sh = new SafeShell({ workspace: ws, env: { PATH: process.env.PATH, HOME: ws, JACO_GATEWAY_TOKEN: 'must-not-leak', DEEPSEEK_API_KEY: 'sk-must-not-leak-0123456789' } });
  const ls = await sh.run({ command: 'ls', args: ['src'], mode: 'read' });
  assert.deepEqual([ls.ok, ls.exitCode, ls.stdout.trim()], [true, 0, 'a.js']);
  const cat = await sh.run({ command: 'cat', args: ['src/a.js'], mode: 'read' });
  assert.match(cat.stdout, /hello from a/);
  // a "command line" in an argument is a file name that does not exist, not something that runs
  const inj = await sh.run({ command: 'cat', args: ['README.md; echo INJECTED && id'], mode: 'read' });
  assert.equal(inj.ok, false); assert.doesNotMatch(inj.stdout, /INJECTED|uid=/); assert.match(inj.stderr, /No such file/);
  assert.equal(fs.existsSync(path.join(ws, 'INJECTED')), false);
  const status = await sh.run({ command: 'git', args: ['status', '--short'], mode: 'read' });
  assert.equal(status.ok, true);
  const node = await sh.run({ command: 'node', args: ['src/a.js'] });
  assert.deepEqual([node.ok, node.stdout.trim()], [true, 'hello from a']);
  // a script cannot see the server's secrets
  fs.writeFileSync(path.join(ws, 'env.js'), 'console.log(JSON.stringify(Object.keys(process.env)))');
  const keys = JSON.parse((await sh.run({ command: 'node', args: ['env.js'] })).stdout);
  assert.ok(!keys.some(k => /TOKEN|KEY|SECRET|PASSWORD/.test(k)), keys.join(','));
  const mk = await sh.run({ command: 'mkdir', args: ['made'] });
  assert.equal(mk.ok, true); assert.ok(fs.statSync(path.join(ws, 'made')).isDirectory());
  // refusals are answers
  const refused = await sh.run({ command: 'rm', args: ['-rf', 'src'] });
  assert.deepEqual([refused.ok, refused.refused], [false, true]); assert.match(refused.reason, /DESTRUCTIVE_NOT_ENABLED/); assert.ok(fs.existsSync(path.join(ws, 'src')));
  assert.equal((await sh.run({ command: 'cat', args: ['/etc/passwd'], mode: 'read' })).refused, true);
  assert.equal((await sh.run({ command: 'ls', args: ['.'], cwd: '../..', mode: 'read' })).reason, 'CWD_OUTSIDE_WORKSPACE_OR_PROTECTED');
  assert.equal((await sh.run({ command: 'nonexistent-program-xyz', args: [] })).reason, 'PROGRAM_NOT_ALLOWED:nonexistent-program-xyz');
  // a nonzero exit is reported, not thrown
  const fail = await sh.run({ command: 'cat', args: ['missing.txt'], mode: 'read' });
  assert.deepEqual([fail.ok, fail.exitCode], [false, 1]);
});

test('timeouts kill the whole process group; output and concurrency are capped', { skip: !posix, timeout: 40000 }, async () => {
  const ws = workspace();
  fs.writeFileSync(path.join(ws, 'slow.js'), 'setTimeout(() => {}, 60000)');
  fs.writeFileSync(path.join(ws, 'loud.js'), `process.stdout.write("x".repeat(${LIMITS.outputBytes * 3}))`);
  const sh = new SafeShell({ workspace: ws, env: { PATH: process.env.PATH } });
  const slow = await sh.run({ command: 'node', args: ['slow.js'], timeoutSeconds: 1 });
  assert.deepEqual([slow.ok, slow.timedOut], [false, true]);
  assert.ok(slow.durationMs < 5000, `${slow.durationMs} ms`);
  const loud = await sh.run({ command: 'node', args: ['loud.js'] });
  assert.equal(loud.truncated, true); assert.ok(loud.stdout.length <= LIMITS.outputBytes);
  const many = await Promise.all(Array.from({ length: LIMITS.concurrent + 3 }, () => sh.run({ command: 'node', args: ['slow.js'], timeoutSeconds: 2 })));
  assert.ok(many.some(r => r.reason === 'TOO_MANY_COMMANDS_RUNNING'), 'the extra ones are refused, not queued without limit');
});

test('every command and refusal is audited, without secrets', { skip: !posix }, async () => {
  const ws = workspace();
  const sh = new SafeShell({ workspace: ws, env: { PATH: process.env.PATH } });
  await sh.run({ command: 'ls', args: ['.'], mode: 'read' });
  await sh.run({ command: 'rm', args: ['-rf', 'src'] });
  await sh.run({ command: 'cat', args: ['sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD'], mode: 'read' });
  const lines = fs.readFileSync(path.join(ws, '.jaco', 'shell-audit.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines.map(l => l.outcome), ['ok', 'refused', 'failed']);
  assert.match(lines[1].reason, /DESTRUCTIVE_NOT_ENABLED/);
  assert.ok(!JSON.stringify(lines).includes('sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD'), 'a token-shaped argument is redacted');
  assert.equal(fs.statSync(path.join(ws, '.jaco', 'shell-audit.jsonl')).mode & 0o777, 0o600);
});

test('the MCP server: tools with the right read-only hints, refusals as errors the agent can read, real runs over stdio', { skip: !posix, timeout: 30000 }, async () => {
  const ws = workspace();
  const child = spawn(process.execPath, [path.resolve('runtime/tools/jaco-shell-mcp.mjs')], { env: { PATH: process.env.PATH, HOME: ws, JACO_SHELL_WORKSPACE: ws }, stdio: ['pipe', 'pipe', 'inherit'] });
  const waiters = new Map(); let buffer = '';
  child.stdout.on('data', chunk => { buffer += chunk; let i; while ((i = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); try { const m = JSON.parse(line); waiters.get(m.id)?.(m); } catch { /* not JSON */ } } });
  let n = 0; const rpc = (method, params) => new Promise(resolve => { const id = ++n; waiters.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  try {
    assert.equal((await rpc('initialize', {})).result.serverInfo.name, 'jaco-shell');
    const tools = (await rpc('tools/list')).result.tools;
    assert.deepEqual(Object.fromEntries(tools.map(t => [t.name, t.annotations.readOnlyHint])), { shell_info: true, shell_read: true, shell_run: false });
    const info = JSON.parse((await rpc('tools/call', { name: 'shell_info', arguments: {} })).result.content[0].text);
    assert.equal(info.workspace, fs.realpathSync(ws) === ws ? ws : info.workspace); assert.ok(info.programs.includes('git') && !info.programs.includes('sh'));
    const read = await rpc('tools/call', { name: 'shell_read', arguments: { command: 'cat', args: ['README.md'] } });
    assert.equal(JSON.parse(read.result.content[0].text).stdout, 'readme\n');
    const write = await rpc('tools/call', { name: 'shell_read', arguments: { command: 'mkdir', args: ['x'] } });
    assert.equal(write.result.isError, true); assert.match(write.result.content[0].text, /WRITE_COMMAND_IN_READ_MODE/);
    assert.equal(fs.existsSync(path.join(ws, 'x')), false);
    const run = await rpc('tools/call', { name: 'shell_run', arguments: { command: 'node', args: ['src/a.js'] } });
    assert.match(JSON.parse(run.result.content[0].text).stdout, /hello from a/);
    assert.equal((await rpc('nonsense')).error.code, -32601);
  } finally { child.kill(); }
});
