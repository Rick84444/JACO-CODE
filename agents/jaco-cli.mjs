#!/usr/bin/env node
// jaco activate | jaco status | jaco home init|show|note
//   activate  start the stack if it is not running (the platform's own way), start every MCP tool server,
//             then print what works: tools, model providers that answer, and the planner the GUI chose.
//   status    the same report without starting anything.
//   --json    machine-readable report; exit code 0 only when everything needed works.
//   --no-tools  do not start tool servers.
import { localServiceUrl } from './lib/resolved-endpoints.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { activationReport, formatReport, runtimeUp } from './lib/activate.mjs';
import { homeCli } from './lib/home-cli.mjs';
import { runTerminalIDE } from './lib/terminal-ide.mjs';
import { readStartupEvidence, reconcileStartupActivation } from './lib/startup-evidence.mjs';
import { readRelayControl, writeRelayControl } from '../gateway/src/workplace/chatgpt-relay-control.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isTermux = (env = process.env) => Boolean(env.TERMUX_VERSION) || /com\.termux/.test(env.PREFIX || '');

// How this platform starts the stack: Termux has its own supervisor, Linux/macOS the cloud stack script,
// Windows (and anything else) the portable starter.
export function startPlan({ platform = process.platform, env = process.env, root = ROOT, exists = fs.existsSync } = {}) {
  if (isTermux(env)) {
    const jacoctl = ['bin/jacoctl', ...fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => `${e.name}/bin/jacoctl`)].map(p => path.join(root, p)).find(exists);
    if (jacoctl) return { label: 'Termux supervisor (jacoctl activate)', cmd: 'bash', args: [jacoctl, 'activate', '--profile', 'full'] };
  }
  const cloud = path.join(root, 'scripts/cloud-stack.sh');
  if (platform !== 'win32' && exists(cloud)) return { label: 'scripts/cloud-stack.sh up', cmd: 'bash', args: [cloud, 'up'] };
  return { label: 'agents/lib/local-stack.mjs', cmd: process.execPath, args: [path.join(root, 'agents/lib/local-stack.mjs')] };
}


/**
 * Recover from a stale CLI token without changing or exposing credentials.
 * Core's local-only activation endpoint already calls activationReport with its
 * own credential; never delegate to a remote URL or a tunnel.
 * `status` stays read-only; `activate` can start only stopped tools.
 */
export async function localCoreActivationReport({ baseUrl, activate = false, fetchImpl = fetch } = {}) {
  let origin;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    origin = url.origin;
  } catch { return null; }
  try {
    const response = await fetchImpl(origin + (activate ? '/api/jaco/activate' : '/api/jaco/activation'), {
      method: activate ? 'POST' : 'GET',
      signal: AbortSignal.timeout(activate ? 120_000 : 20_000),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const report = payload?.report;
    if (payload?.success !== true || report?.schema !== 'jaco.activation/v2' ||
      report.runtime?.up !== true || !Array.isArray(report.tools?.servers) ||
      !Array.isArray(report.problems) || typeof report.ok !== 'boolean') return null;
    return report;
  } catch { return null; }
}

function tokenFromEnvFile(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const m = /^\s*(?:export\s+)?(?:JACO_)?GATEWAY_TOKEN\s*=\s*(.+?)\s*$/m.exec(text);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  } catch { return ''; }
}

export function gatewayToken(env = process.env, root = ROOT) {
  const direct = env.JACO_GATEWAY_TOKEN || env.GATEWAY_TOKEN;
  if (direct) return direct;

  // Termux Core reads ~/.config/jaco/runtime.env. Read that canonical file before the older
  // ~/.jaco/gateway.token so a stale cloud-stack token cannot make activation report 401.
  const runtimeEnv = env.JACO_RUNTIME_ENV || path.join(os.homedir(), '.config', 'jaco', 'runtime.env');
  const canonical = tokenFromEnvFile(runtimeEnv);
  if (canonical) return canonical;

  try {
    const stateToken = fs.readFileSync(path.join(env.JACO_STATE_DIR || path.join(os.homedir(), '.jaco'), 'gateway.token'), 'utf8').trim();
    if (stateToken) return stateToken;
  } catch { /* next */ }

  // Portable/cloud starters may persist the token in a checkout .env.
  const dirs = [root, ...fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules').map(e => path.join(root, e.name))];
  for (const dir of dirs) {
    const t = tokenFromEnvFile(path.join(dir, '.env'));
    if (t) return t;
  }
  return '';
}


/**
 * Explicit, tokenless local operator control for the communication relay.
 * Enabling it never authorizes mission creation or remote MCP access.
 */
export async function relayCli(argv = [], { root = ROOT, env = process.env, fetchImpl = fetch, out = process.stdout, err = process.stderr } = {}) {
  const action = argv[0] || 'status';
  if (argv.length > 1 || !['enable', 'disable', 'status'].includes(action)) {
    err.write('Usage: jaco relay enable|disable|status\n');
    return 2;
  }
  if (action === 'enable' || action === 'disable') {
    writeRelayControl(root, action === 'enable');
    out.write('JACO ChatGPT Git-ref relay ' + (action === 'enable' ? 'enabled' : 'disabled') +
      ' locally. Workplace applies the change without restarting the stack.\n' +
      'Verify: node agents/jaco-cli.mjs relay status\n');
    return 0;
  }

  const control = readRelayControl(root);
  const endpoint = String(env.JACO_WORKPLACE_URL || 'http://127.0.0.1:2995');
  let workplace = null;
  let observed = false;
  try {
    const u = new URL(endpoint);
    if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) ||
      u.username || u.password || u.pathname !== '/' || u.search || u.hash)
      throw Error('WORKPLACE_LOOPBACK_REQUIRED');
    const response = await fetchImpl(u.origin + '/health', { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Error('WORKPLACE_HTTP_' + response.status);
    const health = await response.json();
    if (health?.schema !== 'jaco.workplace/v1') throw Error('WORKPLACE_HEALTH_UNVERIFIED');
    const relay = health?.chatgptRelay;
    if (relay && typeof relay.state === 'string') {
      observed = true;
      workplace = {
        relayState: relay.state,
        transport: relay.transport,
        agentId: relay.agentId || null,
        lastInboundRef: relay.inboundRef || null,
        lastOutboundRef: relay.outboundRef || null,
        messageReceived: Number(relay.lastMirroredSeq || 0),
      };
    }
  } catch {
    workplace = null;
  }
  out.write(JSON.stringify({
    schema: 'jaco.chatgpt-relay-status/v1',
    configured: control.configured, requested: control.configured ? (control.enabled ? 'git-ref' : 'off') : 'environment',
    ...(control.error ? { configError: control.error } : {}),
    observed, workplace,
    connected: observed && workplace?.relayState === 'READY' && workplace?.transport === 'git-ref' &&
      typeof workplace.agentId === 'string' && workplace.agentId.length > 0,
  }, null, 2) + '\n');
  return observed ? 0 : 1;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv[0] === 'relay') return relayCli(argv.slice(1), { root: env.JACO_WORKSPACE_ROOT || ROOT, env });
  if (argv[0] === 'ide' || (argv.length === 0 && process.stdin.isTTY)) {
    const opts = argv[0] === 'ide' ? argv.slice(1) : argv;
    if (opts.includes('--help')) {
      process.stdout.write('Usage: jaco ide [--project PATH] [--no-start] [--help]\\nOpens the JACO Terminal IDE; does not create a second runtime.\n');
      return 0;
    }
    const index = opts.indexOf('--project');
    if (opts.some((arg, i) => arg !== '--no-start' && arg !== '--project' && (index < 0 || i !== index + 1))) {
      process.stderr.write('Usage: jaco ide [--project PATH] [--no-start]\\n');
      return 2;
    }
    if (index >= 0 && (!opts[index + 1] || opts[index + 1].startsWith('--'))) {
      process.stderr.write('Missing --project PATH\\n');
      return 2;
    }
    return runTerminalIDE({
      project: index >= 0 ? opts[index + 1] : process.cwd(),
      env, root: ROOT, resolveToken: () => gatewayToken(env),
      activate: opts.includes('--no-start') ? null : () => main(['activate', '--no-tools'], env),
    });
  }
  if (argv[0] === 'home') return homeCli(argv.slice(1), env);
  const command = argv.find(a => !a.startsWith('--')) || 'activate';
  const json = argv.includes('--json');
  if (!['activate', 'status'].includes(command) || argv.includes('--help')) {
    process.stdout.write('Usage: jaco activate [--json] [--no-tools]\n       jaco status [--json]\n');
    return command === 'activate' || argv.includes('--help') ? 0 : 2;
  }
  let baseUrl = localServiceUrl('runtime', env);
  const startupRoot = env.JACO_DATA_DIR ? path.resolve(env.JACO_DATA_DIR) : ROOT;
  const say = text => { if (!json) process.stderr.write(`${text}\n`); };

  if (command === 'activate' && (!(await runtimeUp({ baseUrl })) || (process.platform === 'win32' && !readStartupEvidence(startupRoot).ok))) {
    const plan = startPlan({ env });
    say(`Starting the stack: ${plan.label}`);
    const started = spawnSync(plan.cmd, plan.args, { cwd: ROOT, stdio: json ? 'ignore' : ['ignore', process.stderr, process.stderr], env });
    if (started.status !== 0) say(`The start command exited with code ${started.status ?? 'unknown'}; checking whether the runtime answers anyway.`);
    // A canonical launcher BLOCKED checkpoint must not cause 90 seconds of
    // misleading additional polling; partial starts are reported below.
    baseUrl = localServiceUrl('runtime', env);
    const startup = process.platform === 'win32' ? readStartupEvidence(startupRoot) : null;
    if (!startup || !['BLOCKED', 'DEGRADED'].includes(startup.state)) {
      for (let waited = 0; waited < 90_000 && !(await runtimeUp({ baseUrl })); waited += 2000) await sleep(2000);
    }
  }

  let observed = await activationReport({ baseUrl, token: gatewayToken(env), startTools: command === 'activate' && !argv.includes('--no-tools') });
  // The canonical Android Core may be supervised by Termux while this CLI runs
  // inside Debian/proot. Their home directories differ; do not treat an old
  // ~/.jaco/gateway.token as an operator task or demand a manual token.
  if (observed.runtime.up && observed.problems.some(p => p === 'Could not read the tools: HTTP_401')) {
    const delegated = await localCoreActivationReport({
      baseUrl,
      activate: command === 'activate' && !argv.includes('--no-tools'),
    });
    if (delegated?.runtime?.version === observed.runtime.version) observed = delegated;
  }
  const report = process.platform === 'win32'
    ? reconcileStartupActivation(observed, readStartupEvidence(startupRoot))
    : observed;
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatReport(report)}${report.startup ? '\nWindows startup: ' + report.startup.state + ' (browser=' + report.startup.browserAttachment + ')' : ''}\n`);
  return report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }, error => { process.stderr.write(`jaco: ${error?.message || error}\n`); process.exitCode = 2; });
}
