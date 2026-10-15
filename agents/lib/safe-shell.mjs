// A bounded shell for agents (operator 2026-10-13: "let agents code on the phone, like on Windows, maybe with a
// shell of its own"). It runs on the device that owns the workspace (a phone in Termux, a computer) and is
// reached through the MCP host, so a cloud agent that has a paired device works through Nova there.
//
// What makes it bounded, in order of importance:
//   * No shell is ever started. A command is a program and an argument list, run directly: ; | && $( ) and
//     redirects are plain characters, so there is nothing to inject into. sh, bash, env, sudo, ssh, curl and
//     package installers are not on the list.
//   * Only listed programs, and only listed uses of them (git subcommands, npm scripts, a node or python script
//     that lives in the workspace; never node -e, git -c, npm install <package>).
//   * Every path argument must resolve (symlinks included) inside the workspace; .env, secret and credential
//     paths are refused for reading too, .git and node_modules for writing.
//   * Two modes: "read" (look, never change) and "write" (build, test, edit, commit). Destructive uses (recursive
//     rm, git reset, git clean, git push, deleting a branch) are refused unless the operator enabled them in the
//     server's environment (JACO_SHELL_ALLOW_DESTRUCTIVE=1, JACO_SHELL_ALLOW_PUSH=1); an agent cannot.
//   * A minimal environment (no tokens or keys reach the command), a timeout, a cap on output, a cap on
//     concurrent commands, and an append-only audit log with every command and refusal.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const LIMITS = { timeoutMs: 30_000, maxTimeoutMs: 300_000, outputBytes: 64 * 1024, concurrent: 4, argCount: 64, argLength: 4096 };
export const PROTECTED_READ = /(^|[\\/])\.env(\.[^\\/]*)?([\\/]|$)|secret|credential/i;
export const PROTECTED_WRITE = /(^|[\\/])(\.git|node_modules)([\\/]|$)|(^|[\\/])\.env(\.[^\\/]*)?([\\/]|$)|secret|credential/i;

const flags = args => args.filter(a => a.startsWith('-'));
const positional = args => args.filter(a => !a.startsWith('-'));
const has = (args, ...names) => args.some(a => names.some(n => a === n || (n.length > 2 && a.startsWith(`${n}=`))));
const shortHas = (args, letters) => args.some(a => /^-[A-Za-z]+$/.test(a) && [...letters].some(l => a.slice(1).includes(l)));

// program -> how it may be used. `paths(args)` says which arguments are paths; `check(args)` returns a refusal or null.
const READ_GIT = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'blame', 'describe', 'shortlog', 'cat-file', 'ls-tree', 'grep', 'rev-list']);
// Options that run another program, read outside the repository or write a file: never, in any subcommand.
const GIT_BLOCKED_OPTION = /^(--output|--ext-diff|--textconv|--exec|--upload-pack|--receive-pack|--git-dir|--work-tree|--config|-c|-C|--run|--paginate|--no-index|-O|--open-files-in-pager|--exec-path)(=|$)/;
function gitClass(args) {
  const sub = args[0];
  if (!sub || sub.startsWith('-')) return { refuse: 'GIT_OPTIONS_BEFORE_SUBCOMMAND_NOT_ALLOWED' };
  const rest = args.slice(1);
  if (rest.some(a => GIT_BLOCKED_OPTION.test(a))) return { refuse: 'GIT_OPTION_NOT_ALLOWED' };
  if (READ_GIT.has(sub)) return { mode: 'read' };
  switch (sub) {
    case 'branch': {
      if (rest.every(a => /^(-a|--all|-r|--remotes|-v|-vv|--list|--show-current)$/.test(a))) return { mode: 'read' };
      return has(rest, '-d', '-D', '--delete', '-m', '-M', '--move', '-f', '--force') ? { mode: 'write', destructive: 'GIT_BRANCH_DELETE_OR_MOVE' } : { mode: 'write' };
    }
    case 'tag': {
      if (rest.every(a => /^(-l|--list|-n)$/.test(a))) return { mode: 'read' };
      return has(rest, '-d', '--delete', '-f', '--force') ? { mode: 'write', destructive: 'GIT_TAG_DELETE_OR_FORCE' } : { mode: 'write' };
    }
    case 'remote': return rest.length === 0 || (rest.length === 1 && rest[0] === '-v') || (['show', 'get-url'].includes(rest[0]) && rest.length === 2) ? { mode: 'read' } : { refuse: 'GIT_REMOTE_CHANGE_NOT_ALLOWED' };
    case 'push': return { mode: 'write', destructive: 'GIT_PUSH', push: true };
    case 'reset': case 'clean': case 'rebase': return { mode: 'write', destructive: `GIT_${sub.toUpperCase()}` };
    case 'checkout': return has(rest, '-b', '-B') ? { mode: 'write' } : { mode: 'write', destructive: 'GIT_CHECKOUT_MAY_DISCARD_CHANGES' };
    case 'restore': return has(rest, '--staged') && !has(rest, '--worktree', '-W') ? { mode: 'write' } : { mode: 'write', destructive: 'GIT_RESTORE_DISCARDS_CHANGES' };
    case 'stash': return ['drop', 'clear'].includes(rest[0]) ? { mode: 'write', destructive: 'GIT_STASH_DROP' } : { mode: 'write' };
    case 'pull': return has(rest, '--ff-only') ? { mode: 'write' } : { mode: 'write', destructive: 'GIT_PULL_MAY_MERGE' };
    case 'add': case 'commit': case 'switch': case 'merge': case 'fetch': case 'mv': case 'rm': case 'init': case 'apply': case 'cherry-pick': case 'revert': return { mode: 'write' };
    default: return { refuse: `GIT_SUBCOMMAND_NOT_ALLOWED:${sub}` };
  }
}

const FIND_BLOCKED = new Set(['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprint0', '-fprintf', '-fls']);
export const PROGRAMS = {
  ls: { mode: 'read', paths: a => positional(a) },
  cat: { mode: 'read', paths: a => positional(a) },
  head: { mode: 'read', paths: a => positional(a) },
  tail: { mode: 'read', paths: a => positional(a), check: a => (shortHas(a, 'f') || has(a, '--follow') ? 'FOLLOW_NOT_ALLOWED' : null) },
  wc: { mode: 'read', paths: a => positional(a) },
  stat: { mode: 'read', paths: a => positional(a) },
  du: { mode: 'read', paths: a => positional(a) },
  file: { mode: 'read', paths: a => positional(a) },
  pwd: { mode: 'read', paths: () => [] },
  uname: { mode: 'read', paths: () => [] },
  df: { mode: 'read', paths: () => [] },
  find: { mode: 'read', paths: a => { const stop = a.findIndex(x => x.startsWith('-') || x === '(' || x === '!'); return (stop < 0 ? a : a.slice(0, stop)); }, check: a => (a.find(x => FIND_BLOCKED.has(x)) ? 'FIND_ACTION_NOT_ALLOWED' : null) },
  grep: { mode: 'read', check: a => (has(a, '-f', '--file') || shortHas(a, 'f') ? 'GREP_PATTERN_FILE_NOT_ALLOWED' : null),
    paths: a => { const rest = []; let pattern = has(a, '-e', '--regexp'); for (let i = 0; i < a.length; i++) { if (a[i] === '-e' || a[i] === '--regexp') { i++; continue; } if (a[i].startsWith('-')) continue; if (!pattern) { pattern = true; continue; } rest.push(a[i]); } return rest; } },
  git: { dynamic: gitClass, paths: a => { const i = a.indexOf('--'); return i >= 0 ? a.slice(i + 1) : []; } },
  node: { mode: 'write', script: true, check: a => (a[0] === '--version' || a[0] === '-v' ? null : (a.find(x => /^(-e|-p|--eval|--print|-r|--require|--import|--input-type|--inspect|--inspect-brk|-i|--interactive|--loader|--experimental-loader|--env-file|--env-file-if-exists)(=|$)/.test(x)) ? 'NODE_INLINE_CODE_NOT_ALLOWED' : null)) },
  python3: { mode: 'write', script: true, check: a => (a[0] === '--version' ? null : (a.find(x => /^(-c|-m|-i)$/.test(x)) ? 'PYTHON_INLINE_CODE_NOT_ALLOWED' : null)) },
  npm: { mode: 'write', check: a => {
    if (a[0] === '--version' || a[0] === '-v') return null;
    if (['test', 't', 'run', 'run-script', 'ci', 'ls', 'list', 'outdated', 'view'].includes(a[0])) return null;
    if (a[0] === 'install' || a[0] === 'i') return positional(a.slice(1)).length ? 'NPM_INSTALL_OF_PACKAGES_NOT_ALLOWED' : null;
    return 'NPM_SUBCOMMAND_NOT_ALLOWED';
  }, readSub: ['ls', 'list', 'outdated', 'view'], paths: () => [] },
  mkdir: { mode: 'write', paths: a => positional(a) },
  touch: { mode: 'write', paths: a => positional(a) },
  cp: { mode: 'write', paths: a => positional(a) },
  mv: { mode: 'write', paths: a => positional(a) },
  rm: { mode: 'write', paths: a => positional(a), destructiveIf: a => (shortHas(a, 'rRf') || has(a, '--recursive', '--force') ? 'RM_RECURSIVE_OR_FORCE' : null) },
};

// Why this command may not run, or its mode. Pure: no process is started here.
export function classify(command, args, { workspace, cwd = workspace, env = process.env, mode: requested = 'write' } = {}) {
  const refuse = reason => ({ ok: false, reason });
  if (typeof command !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]{0,30}$/.test(command)) return refuse('COMMAND_NAME_INVALID');
  if (!Array.isArray(args) || args.length > LIMITS.argCount || args.some(a => typeof a !== 'string' || a.length > LIMITS.argLength || a.includes('\0'))) return refuse('ARGUMENTS_INVALID');
  const spec = PROGRAMS[command];
  if (!spec) return refuse(`PROGRAM_NOT_ALLOWED:${command}`);
  let mode = spec.mode, destructive = null, push = false;
  if (spec.dynamic) { const c = spec.dynamic(args); if (c.refuse) return refuse(c.refuse); mode = c.mode; destructive = c.destructive || null; push = Boolean(c.push); }
  if (command === 'npm' && spec.readSub.includes(args[0])) mode = 'read';
  if (command === 'node' || command === 'python3') { if (args[0] === '--version' || args[0] === '-v') mode = 'read'; }
  const problem = spec.check?.(args); if (problem) return refuse(problem);
  destructive = destructive || spec.destructiveIf?.(args) || null;
  if (requested === 'read' && mode !== 'read') return refuse('WRITE_COMMAND_IN_READ_MODE');
  if (push && env.JACO_SHELL_ALLOW_PUSH !== '1') return refuse('GIT_PUSH_NOT_ENABLED (the operator enables it with JACO_SHELL_ALLOW_PUSH=1)');
  if (destructive && !push && env.JACO_SHELL_ALLOW_DESTRUCTIVE !== '1') return refuse(`DESTRUCTIVE_NOT_ENABLED:${destructive} (the operator enables it with JACO_SHELL_ALLOW_DESTRUCTIVE=1)`);
  // A script argument for node/python must exist inside the workspace.
  const pathArgs = [...(spec.paths ? spec.paths(args) : []), ...(spec.script && mode === 'write' ? positional(args).slice(0, 1) : [])];
  const confinement = confine(pathArgs, { workspace, cwd, write: mode === 'write' || Boolean(destructive) });
  if (confinement) return refuse(confinement);
  if (command === 'rm' && positional(args).some(p => path.resolve(cwd, p) === path.resolve(workspace))) return refuse('RM_OF_WORKSPACE_ROOT_NOT_ALLOWED');
  if (command === 'rm' && !positional(args).length) return refuse('RM_NEEDS_A_PATH');
  return { ok: true, mode, destructive, args: [...args] };
}

// The real path of the deepest existing part of p (so a symlink out of the workspace is seen even for a file not yet created).
export function realPrefix(p) {
  let current = path.resolve(p); const tail = [];
  for (;;) {
    try { return path.join(fs.realpathSync(current), ...tail.reverse()); }
    catch { const parent = path.dirname(current); if (parent === current) return path.resolve(p); tail.push(path.basename(current)); current = parent; }
  }
}
export const inside = (root, target) => { const rel = path.relative(root, target); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
function confine(paths, { workspace, cwd, write }) {
  const root = realPrefix(workspace);
  for (const raw of paths) {
    if (raw === '-') continue;
    if (/^~/.test(raw)) return 'HOME_PATH_NOT_ALLOWED';
    if (PROTECTED_READ.test(raw) || (write && PROTECTED_WRITE.test(raw))) return `PROTECTED_PATH:${raw}`;
    const target = realPrefix(path.resolve(cwd, raw));
    if (!inside(root, target)) return `PATH_OUTSIDE_WORKSPACE:${raw}`;
    if (PROTECTED_READ.test(path.relative(root, target)) || (write && PROTECTED_WRITE.test(path.relative(root, target)))) return `PROTECTED_PATH:${raw}`;
  }
  return null;
}
export function resolveCwd(workspace, cwd = '.') {
  const root = realPrefix(workspace), target = realPrefix(path.resolve(workspace, String(cwd || '.')));
  return inside(root, target) && !PROTECTED_READ.test(path.relative(root, target)) ? target : null;
}

const redact = text => String(text).replace(/\b(?:sk|gsk|hf|ghp|gho|ghs|xox[abp]|org|jdt)[_-][A-Za-z0-9_-]{16,}\b|\b[A-Za-z0-9+/_-]{40,}\b/g, '[redacted]').slice(0, 300);
// Only what a build or a test needs. No token, key or password from the server's environment reaches the command.
export function commandEnv(env = process.env) {
  const keep = ['PATH', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec', 'PREFIX', 'TERMUX_VERSION', 'ANDROID_ROOT', 'ANDROID_DATA'];
  return { ...Object.fromEntries(keep.filter(k => env[k] !== undefined).map(k => [k, env[k]])), GIT_TERMINAL_PROMPT: '0', CI: '1', NO_COLOR: '1' };
}
// npm is a .cmd file on Windows and cannot be started without a shell: run its own script through node instead.
export function resolveProgram(command, platform = process.platform, execPath = process.execPath, exists = fs.existsSync) {
  if (command === 'npm' && platform === 'win32') {
    const cli = path.join(path.dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (exists(cli)) return { cmd: execPath, prefix: [cli] };
  }
  if (command === 'node') return { cmd: execPath, prefix: [] };
  if (command === 'python3' && platform === 'win32') return { cmd: 'python', prefix: [] };
  return { cmd: command, prefix: [] };
}

let running = 0;
export class SafeShell {
  constructor({ workspace, env = process.env, auditFile = null, spawnImpl = spawn, platform = process.platform } = {}) {
    if (!workspace) throw new Error('WORKSPACE_REQUIRED');
    this.workspace = path.resolve(workspace); this.env = env; this.spawn = spawnImpl; this.platform = platform;
    this.auditFile = auditFile === null ? path.join(this.workspace, '.jaco', 'shell-audit.jsonl') : auditFile;
  }
  #audit(entry) {
    if (!this.auditFile) return;
    try { fs.mkdirSync(path.dirname(this.auditFile), { recursive: true }); fs.appendFileSync(this.auditFile, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 }); } catch { /* the command result is still returned */ }
  }
  info() {
    return { workspace: this.workspace, platform: this.platform, shell: 'none (argv only, no interpretation)', programs: Object.keys(PROGRAMS), limits: { ...LIMITS },
      destructiveEnabled: this.env.JACO_SHELL_ALLOW_DESTRUCTIVE === '1', pushEnabled: this.env.JACO_SHELL_ALLOW_PUSH === '1',
      note: 'git: read subcommands in read mode; add/commit/switch/merge/fetch and the like in write mode. node and python3 run a script inside the workspace, never inline code. npm: test, run, ci, ls, install without packages.' };
  }
  async run({ command, args = [], cwd = '.', timeoutSeconds, mode = 'write' } = {}) {
    const started = Date.now();
    const refused = reason => { this.#audit({ mode, command: String(command).slice(0, 40), args: (Array.isArray(args) ? args : []).slice(0, 16).map(redact), outcome: 'refused', reason }); return { ok: false, refused: true, reason }; };
    const where = resolveCwd(this.workspace, cwd);
    if (!where) return refused('CWD_OUTSIDE_WORKSPACE_OR_PROTECTED');
    const verdict = classify(command, args, { workspace: this.workspace, cwd: where, env: this.env, mode });
    if (!verdict.ok) return refused(verdict.reason);
    if (running >= LIMITS.concurrent) return refused('TOO_MANY_COMMANDS_RUNNING');
    const timeoutMs = Math.min(LIMITS.maxTimeoutMs, Math.max(1000, (Number(timeoutSeconds) || LIMITS.timeoutMs / 1000) * 1000));
    const program = resolveProgram(command, this.platform);
    running++;
    try {
      return await new Promise(resolve => {
        let out = '', err = '', outCut = false, errCut = false, timedOut = false, settled = false;
        const child = this.spawn(program.cmd, [...program.prefix, ...verdict.args], { cwd: where, env: commandEnv(this.env), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: this.platform !== 'win32' });
        const stop = () => { try { if (this.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } } };
        const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
        const take = (which, chunk) => {
          const text = chunk.toString('utf8');
          if (which === 'out') { if (out.length + text.length > LIMITS.outputBytes) { outCut = true; out += text.slice(0, Math.max(0, LIMITS.outputBytes - out.length)); } else out += text; }
          else if (err.length + text.length > LIMITS.outputBytes) { errCut = true; err += text.slice(0, Math.max(0, LIMITS.outputBytes - err.length)); } else err += text;
        };
        child.stdout?.on('data', c => take('out', c)); child.stderr?.on('data', c => take('err', c));
        const finish = (code, signal, spawnError) => {
          if (settled) return; settled = true; clearTimeout(timer);
          const missing = spawnError?.code === 'ENOENT';
          const result = { ok: !spawnError && code === 0 && !timedOut, exitCode: Number.isInteger(code) ? code : null, signal: signal || null, timedOut, stdout: out, stderr: err, truncated: outCut || errCut,
            durationMs: Date.now() - started, mode: verdict.mode, ...(missing ? { reason: `COMMAND_NOT_FOUND:${command} (not installed on this device)` } : spawnError ? { reason: `SPAWN_FAILED:${spawnError.code || 'unknown'}` } : {}),
            outputSha256: createHash('sha256').update(out + err).digest('hex') };
          this.#audit({ mode: verdict.mode, command, args: verdict.args.slice(0, 16).map(redact), cwd: path.relative(this.workspace, where) || '.', outcome: timedOut ? 'timeout' : result.ok ? 'ok' : 'failed', exitCode: result.exitCode, ms: result.durationMs, truncated: result.truncated, ...(verdict.destructive ? { destructive: verdict.destructive } : {}) });
          resolve(result);
        };
        child.once('error', error => finish(null, null, error));
        child.once('close', (code, signal) => finish(code, signal, null));
      });
    } finally { running--; }
  }
}
