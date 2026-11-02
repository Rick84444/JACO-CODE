// JACO terminal IDE: a thin operator surface over the existing JACO runtime, Git, MCP and device owners.
// It is NOT a new agent loop, shell evaluator or alternative authorization service.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { JacoClient } from '../../runtime/src/sdk/jaco-client.mjs';

const execFile = promisify(execFileCallback);
const MUTATING_GIT = new Set(['fetch', 'pull', 'sync', 'push']);
const GIT_VERBS = new Set(['status', 'log', 'diff', 'branch', 'fetch', 'pull', 'sync', 'push', 'pr']);
const DEVICE_VERBS = new Set(['list', 'invite', 'join']);
const CLIENTS = new Set(['vscode', 'claude', 'codex']);
const HELP = [
  'JACO Terminal IDE — operator commands (not an unrestricted shell)',
  '  <your message>            Chat with Aura through the existing runtime',
  '  /goal <objective>         Create a durable JACO mission (explicit)',
  '  /missions                 List recorded missions',
  '  /status                   Inspect the connected runtime',
  '  /open                     Open the existing JACO IDE in a browser',
  '  /code                     Open this project in VS Code',
  '  /project                  Show the local Git project (runtime may use another)',
  '  /git status|log|diff|branch|pr',
  '  /git fetch|pull|sync|push   Explicit Git actions; no force, reset or rebase',
  '  /mcp doctor               Check local MCP configuration (not live tool proof)',
  '  /mcp install vscode|claude|codex   Configure canonical JACO editor MCP',
  '  /devices list|invite <name>   Use existing authenticated device registry',
  '  /devices join <hub-url>     Use existing one-time-code pairing, code entered privately',
  '  /help, /exit              Help and quit',
].join('\n');

const short = value => String(value?.message || value).split('\n')[0].slice(0, 300);
const clean = value => String(value).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, 30000);
const existingDir = candidate => {
  const absolute = path.resolve(candidate);
  if (!fs.statSync(absolute).isDirectory()) throw new Error('JACO_PROJECT_NOT_DIRECTORY');
  return absolute;
};
export function safeRuntimeUrl(url) {
  const u = new URL(url);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('JACO_RUNTIME_URL_INVALID');
  if (u.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(u.hostname)) throw new Error('JACO_REMOTE_REQUIRES_HTTPS');
  return u.origin;
}
export function parseTerminalCommand(line) {
  const text = String(line || '').trim();
  if (!text) return { kind: 'none' };
  const cleaned = text.replace(/^\//, '');
  const [prefix, ...parts] = cleaned.split(/\s+/);
  if (prefix === 'exit' || prefix === 'quit') return { kind: 'exit' };
  if (prefix === 'help' || prefix === '?') return { kind: 'help' };
  if (['status', 'open', 'code', 'project', 'missions'].includes(prefix) && parts.length === 0) return { kind: prefix };
  if (prefix === 'goal') return { kind: 'goal', text: cleaned.slice(5).trim() };
  if (prefix === 'git') return { kind: 'git', verb: parts[0] || 'status', args: parts.slice(1) };
  if (prefix === 'mcp') return { kind: 'mcp', verb: parts[0] || 'doctor', args: parts.slice(1) };
  if (prefix === 'devices') return { kind: 'devices', verb: parts[0] || 'list', args: parts.slice(1) };
  if (text.startsWith('/')) return { kind: 'invalid', command: prefix };
  return { kind: 'chat', text };
}
export function enforceGitVerb(verb, args = []) {
  if (!GIT_VERBS.has(verb) || args.length) throw new Error('JACO_GIT_COMMAND_NOT_ALLOWED');
  return verb;
}
async function execGit(project, args, runner = execFile) {
  const result = await runner('git', ['-C', project, ...args], { timeout: 30000, maxBuffer: 384 * 1024, windowsHide: true });
  return clean(result.stdout || '');
}
export async function gitContext(project, runner = execFile) {
  const root = (await execGit(project, ['rev-parse', '--show-toplevel'], runner)).trim();
  const branch = (await execGit(project, ['branch', '--show-current'], runner)).trim();
  if (!branch) throw new Error('JACO_GIT_DETACHED_HEAD');
  const status = (await execGit(project, ['status', '--porcelain=v1'], runner)).trim();
  let upstream = null, remote = null, remoteRef = null;
  try {
    upstream = (await execGit(project, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], runner)).trim();
    const configuredRemote = (await execGit(project, ['config', '--get', 'branch.' + branch + '.remote'], runner)).trim();
    const configuredRef = (await execGit(project, ['config', '--get', 'branch.' + branch + '.merge'], runner)).trim();
    const remotes = (await execGit(project, ['remote'], runner)).split(/\r?\n/).map(x => x.trim());
    if (remotes.includes(configuredRemote) && /^[a-z0-9][a-z0-9._/-]*$/i.test(configuredRemote) &&
        configuredRef.startsWith('refs/heads/') && configuredRef.length < 250 &&
        !configuredRef.includes('..') && !configuredRef.includes('@{') &&
        !configuredRef.endsWith('/') && !configuredRef.includes('//')) {
      remote = configuredRemote;
      remoteRef = configuredRef;
    }
  } catch { /* A tracking branch is not proof of a valid explicit push target. */ }
  return { root, branch, dirty: Boolean(status), upstream, remote, remoteRef };
}
export function gitAdmission(verb, context) {
  if (!MUTATING_GIT.has(verb)) return { allowed: true };
  if (!context.branch) return { allowed: false, reason: 'JACO_GIT_DETACHED_HEAD' };
  if (verb === 'push' && /^(main|master|production|release)$/i.test(context.branch)) return { allowed: false, reason: 'JACO_PROTECTED_BRANCH_PUSH_DENIED' };
  if (verb === 'push' && (!context.remote || !context.remoteRef)) return { allowed: false, reason: 'JACO_GIT_PUSH_TARGET_UNVERIFIED' };
  if (verb === 'push' && /\/((main|master|production|release))$/i.test(context.remoteRef)) return { allowed: false, reason: 'JACO_PROTECTED_REMOTE_BRANCH_PUSH_DENIED' };
  if (['pull','sync','push'].includes(verb) && !context.upstream) return { allowed: false, reason: 'JACO_GIT_UPSTREAM_MISSING' };
  if (['pull','sync'].includes(verb) && context.dirty) return { allowed: false, reason: 'JACO_GIT_WORKTREE_DIRTY' };
  return { allowed: true };
}
async function gitAction({ project, verb, runner = execFile, confirm, write }) {
  enforceGitVerb(verb);
  if (verb === 'pr') {
    const result = await runner('gh', ['pr', 'status'], { cwd: project, windowsHide: true, timeout: 20000, maxBuffer: 128 * 1024 });
    write(clean(result.stdout));
    return;
  }
  if (verb === 'status') { write(await execGit(project, ['status', '--short', '--branch'], runner)); return; }
  if (verb === 'branch') { write(await execGit(project, ['branch', '--show-current'], runner)); return; }
  if (verb === 'log') { write(await execGit(project, ['log', '-n', '8', '--oneline'], runner)); return; }
  if (verb === 'diff') { write(await execGit(project, ['diff', '--stat'], runner)); return; }
  const context = await gitContext(project, runner);
  const decision = gitAdmission(verb, context);
  if (!decision.allowed) throw new Error(decision.reason);
  const gate = verb.toUpperCase() + ' ' + context.branch +
    (verb === 'push' ? ' TO ' + context.remote + '/' + context.remoteRef.slice('refs/heads/'.length) : '');
  if (await confirm(gate) !== gate) { write('Cancelled; Git state unchanged by JACO.'); return; }
  if (verb === 'fetch') { write(await execGit(project, ['fetch', '--prune'], runner) || 'Fetch completed.'); return; }
  if (verb === 'pull') { write(await execGit(project, ['pull', '--ff-only'], runner) || 'Fast-forward complete.'); return; }
  if (verb === 'sync') {
    write(await execGit(project, ['fetch', '--prune'], runner) || 'Fetched.');
    // Never attempt a second mutation after a failed fetch; merge only the named upstream, ff-only.
    write(await execGit(project, ['merge', '--ff-only', '@{upstream}'], runner) || 'Fast-forward complete.');
    return;
  }
  if (verb === 'push') {
    // Explicitly bind exactly one destination to the confirmation; push.default=matching is unsafe.
    write(await execGit(project, ['push', '--porcelain', '--', context.remote, 'HEAD:' + context.remoteRef], runner) || 'Push completed.');
    return;
  }
}
export async function terminalGitCommand(options) { return gitAction(options); }

function launchDetached(cmd, args, options = {}) {
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: false, shell: false, ...options });
  child.on('error', err => { process.stderr.write('Launch failed: ' + short(err) + '\n'); });
  child.unref();
}
export async function joinPairedDevice({ root, hub, code, spawnImpl = spawn }) {
  const script = path.join(root, 'tools', 'join-hub.mjs');
  return new Promise((resolve, reject) => {
    const child = spawnImpl(process.execPath, [script, hub, '--code-stdin'], {
      cwd: root, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '', finished = false;
    const timer = setTimeout(() => { child.kill(); finish(new Error('PAIRING_TIMEOUT')); }, 45000);
    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(clean(stdout));
    }
    child.stdout?.on('data', data => {
      stdout += String(data);
      if (stdout.length > 128 * 1024) { child.kill(); finish(new Error('PAIRING_OUTPUT_TOO_LARGE')); }
    });
    child.stderr?.on('data', data => {
      stderr += String(data);
      if (stderr.length > 128 * 1024) { child.kill(); finish(new Error('PAIRING_OUTPUT_TOO_LARGE')); }
    });
    child.on('error', error => finish(error));
    child.on('close', status => finish(status === 0 ? null : new Error(clean(stderr).slice(0, 250) || 'PAIRING_FAILED')));
    child.stdin?.end(code + '\n');
  });
}

function isValidDeviceName(name) { return /^[a-z][a-z0-9-]{1,39}$/.test(name); }
export async function deviceRequest(client, verb, name) {
  // The terminal's SDK client owns the active gateway identity. Do not invoke a helper
  // that only reads a stale root .env (cloud-stack/Termux use different credential files).
  if (verb === 'list') return client.request('/api/connected/devices');
  if (verb === 'invite' && isValidDeviceName(name)) {
    return client.request('/api/connected/devices/invite', { method: 'POST', body: { name } });
  }
  throw new Error('JACO_DEVICE_COMMAND_INVALID');
}
function printableResult(result) {
  if (typeof result?.response === 'string' && result.response.trim()) return result.response;
  return JSON.stringify(result, null, 2);
}
export async function runTerminalIDE({
  project = process.cwd(), env = process.env, input = process.stdin, output = process.stdout,
  root = path.resolve(import.meta.dirname, '../..'), activate, runner = execFile,
  resolveToken = () => env.JACO_GATEWAY_TOKEN || env.GATEWAY_TOKEN || '', clientFactory = config => new JacoClient(config),
} = {}) {
  const cwd = existingDir(project);
  const endpoint = safeRuntimeUrl(env.JACO_RUNTIME_URL || 'http://127.0.0.1:' + (env.PORT || 3000));
  const workplaceUrl = safeRuntimeUrl(env.JACO_WORKPLACE_URL || 'http://127.0.0.1:2995');
  let client;
  const write = line => output.write(String(line) + '\n');
  write('\nJACO  |  Terminal Cognitive IDE');
  write('Project: ' + cwd);
  write('Runtime: ' + endpoint + ' (reachability not yet established)');
  write('No unrestricted shell or automatically privileged agent tools.');
  if (activate) {
    try {
      const code = await activate();
      write(code === 0 ? 'Activation: runtime report completed.' : 'Activation: DEGRADED or BLOCKED; /status for details.');
    } catch (error) { write('Activation: FAILED — ' + short(error)); }
  }
  // Startup may generate a new gateway token. Never capture credentials before activation.
  client = clientFactory({ endpoint, token: resolveToken(), timeoutMs: 25000, retries: 0 });
  write(HELP);
  const rl = createInterface({ input, output, terminal: Boolean(input.isTTY), historySize: 0 });
  // Disable readline history: device pairing codes and user prompts are not retained.
  try {
    while (true) {
      let line;
      try { line = await rl.question('\njaco> '); }
      catch { break; }
      const command = parseTerminalCommand(line);
      if (command.kind === 'exit') break;
      if (command.kind === 'none') continue;
      const ask = gate => rl.question('Type ' + gate + ' to confirm: ');
      try {
        switch (command.kind) {
          case 'help': write(HELP); break;
          case 'invalid': write('Unknown /command. Use /help.'); break;
          case 'project': write(cwd + '\nGit directory and runtime IDE project may differ. Check the GUI before editing.'); break;
          case 'status': write(printableResult(await client.workbench.status())); break;
          case 'missions': write(printableResult(await client.missions.list())); break;
          case 'goal': {
            if (!command.text) throw new Error('JACO_GOAL_EMPTY');
            if (await ask('GOAL') !== 'GOAL') { write('Cancelled.'); break; }
            write(printableResult(await client.missions.startGoal(command.text)));
            break;
          }
          case 'chat': write(printableResult(await client.chat.send(command.text))); break;
          case 'git': {
            if (enforceGitVerb(command.verb, command.args)) await gitAction({ project: cwd, verb: command.verb, runner, confirm: ask, write });
            break;
          }
          case 'mcp': {
            if (command.verb === 'doctor' && command.args.length === 0) {
              const entry = path.join(root, 'runtime', 'tools', 'jaco-editor-mcp.mjs');
              const file = path.join(cwd, '.vscode', 'mcp.json');
              write('JACO Editor MCP: ' + (fs.existsSync(entry) ? 'installed' : 'missing from checkout'));
              write('VS Code workspace configuration: ' + (fs.existsSync(file) ? 'present' : 'missing'));
              write('This does not prove a live VS Code tool call. Use the IDE setup check to verify.');
            } else if (command.verb === 'install' && command.args.length === 1 && CLIENTS.has(command.args[0])) {
              const choice = command.args[0];
              if (await ask('INSTALL ' + choice) !== 'INSTALL ' + choice) { write('Cancelled.'); break; }
              const { clientConfig, installClient } = await import('../../runtime/src/server/connected/connectionSetup.mjs');
              const built = path.join(root, 'runtime', 'dist', 'jaco-editor.mjs');
              const source = path.join(root, 'runtime', 'tools', 'jaco-editor-mcp.mjs');
              const entry = fs.existsSync(built) ? built : source;
              if (!fs.existsSync(entry)) throw new Error('JACO_EDITOR_MCP_NOT_INSTALLED');
              const config = clientConfig(choice, { project: cwd, home: os.homedir(), command: process.execPath, entry, runtimeUrl: endpoint, workplaceUrl });
              write(printableResult(installClient(config)));
            } else write('Usage: /mcp doctor | /mcp install vscode|claude|codex');
            break;
          }
          case 'devices': {
            if (!DEVICE_VERBS.has(command.verb)) throw new Error('JACO_DEVICE_COMMAND_INVALID');
            if (command.verb === 'join') {
              if (command.args.length !== 1) throw new Error('Usage: /devices join <hub-url>');
              const hub = safeRuntimeUrl(command.args[0]);
              if (await ask('JOIN') !== 'JOIN') { write('Cancelled.'); break; }
              const code = (await rl.question('One-time pairing code (not saved in history): ')).trim();
              if (!/^[a-z0-9-]{4,160}$/i.test(code)) throw new Error('JACO_PAIRING_CODE_INVALID');
              // The established helper receives the OTP over stdin, not a visible process argument.
              write(await joinPairedDevice({ root, hub, code }));
            } else {
              if (command.verb === 'invite' && (command.args.length !== 1 || !isValidDeviceName(command.args[0]))) throw new Error('Usage: /devices invite <lowercase-name>');
              if (command.verb === 'list' && command.args.length) throw new Error('Usage: /devices list');
              if (command.verb === 'invite' && await ask('INVITE ' + command.args[0]) !== 'INVITE ' + command.args[0]) { write('Cancelled.'); break; }
              const data = await deviceRequest(client, command.verb, command.args[0]);
              if (command.verb === 'list') {
                const devices = Array.isArray(data.devices) ? data.devices : [];
                if (!devices.length) write('No paired devices observed.');
                for (const device of devices) write([device.name, device.executor, device.revokedAt ? 'revoked' : device.online ? 'online' : 'paired', device.lastSeenAt || 'never'].join('  |  '));
              } else {
                const invite = data.invite;
                if (!invite?.code || !invite?.executor) throw new Error('DEVICE_PAIRING_RECEIPT_MISSING');
                write('One-time pairing code for ' + invite.executor + ': ' + invite.code);
                write('Expires at ' + invite.expiresAt + '. Enter it on the other device with /devices join <hub-url>.');
              }
            }
            break;
          }
          case 'code': {
            const program = env.JACO_VSCODE_CLI || (process.platform === 'win32' ? 'code.exe' : 'code');
            launchDetached(program, ['--reuse-window', cwd]);
            write('Requested VS Code to open the local project. Launch is not proof of connection.');
            break;
          }
          case 'open': {
            const program = process.platform === 'win32' ? 'powershell.exe'
              : process.platform === 'darwin' ? 'open'
              : env.TERMUX_VERSION ? 'termux-open-url' : 'xdg-open';
            const args = process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath ' + JSON.stringify(endpoint)]
              : [endpoint];
            launchDetached(program, args);
            write('Requested browser to open ' + endpoint + '. Localhost reachability is not assumed.');
            break;
          }
          default: write('Unknown command; use /help.');
        }
      } catch (error) { write('JACO: ' + short(error)); }
    }
  } finally {
    rl.close();
    write('JACO terminal closed; background services are unchanged.');
  }
  return 0;
}
