#!/usr/bin/env node
// jaco activate | jaco status | jaco home init|show|note
//   activate  start the stack if it is not running (the platform's own way), start every MCP tool server,
//             then print what works: tools, model providers that answer, and the planner the GUI chose.
//   status    the same report without starting anything.
//   --json    machine-readable report; exit code 0 only when everything needed works.
//   --no-tools  do not start tool servers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { activationReport, formatReport, runtimeUp } from './lib/activate.mjs';
import { homeCli } from './lib/home-cli.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isTermux = (env = process.env) => Boolean(env.TERMUX_VERSION) || /com\.termux/.test(env.PREFIX || '');

// How this platform starts the stack: Termux has its own supervisor, Linux/macOS the cloud stack script,
// Windows (and anything else) the portable starter.
export function startPlan({ platform = process.platform, env = process.env, root = ROOT, exists = fs.existsSync } = {}) {
  if (isTermux(env)) {
    const jacoctl = ['bin/jacoctl', ...fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => `${e.name}/bin/jacoctl`)].map(p => path.join(root, p)).find(exists);
    if (jacoctl) return { label: 'Termux-supervisorn (jacoctl activate)', cmd: 'bash', args: [jacoctl, 'activate', '--profile', 'full'] };
  }
  const cloud = path.join(root, 'scripts/cloud-stack.sh');
  if (platform !== 'win32' && exists(cloud)) return { label: 'scripts/cloud-stack.sh up', cmd: 'bash', args: [cloud, 'up'] };
  return { label: 'agents/lib/local-stack.mjs', cmd: process.execPath, args: [path.join(root, 'agents/lib/local-stack.mjs')] };
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

  // Anywhere but Termux the stack this CLI starts reads the launcher's env file (local-stack.mjs), so that is
  // the token it runs with. A leftover ~/.config/jaco/runtime.env from another install made activation report 401.
  if (!isTermux(env)) {
    for (const file of [env.JACO_ENV_FILE, path.join(env.JACO_STATE_DIR || path.join(os.homedir(), '.jaco'), '.env')].filter(Boolean)) {
      const t = tokenFromEnvFile(file);
      if (t) return t;
    }
  }

  // Termux Core reads ~/.config/jaco/runtime.env. Read that canonical file before the older
  // ~/.jaco/gateway.token so a stale cloud-stack token cannot make activation report 401.
  const runtimeEnv = env.JACO_RUNTIME_ENV || path.join(os.homedir(), '.config', 'jaco', 'runtime.env');
  const canonical = tokenFromEnvFile(runtimeEnv);
  if (canonical) return canonical;

  try {
    const stateToken = fs.readFileSync(path.join(env.JACO_STATE_DIR || path.join(os.homedir(), '.jaco'), 'gateway.token'), 'utf8').trim();
    if (stateToken) return stateToken;
  } catch { /* next */ }

  // The launcher's env file outside the checkout (JACO_ENV_FILE, else <state dir>/.env), as local-stack reads it.
  for (const file of [env.JACO_ENV_FILE, path.join(env.JACO_STATE_DIR || path.join(os.homedir(), '.jaco'), '.env')].filter(Boolean)) {
    const t = tokenFromEnvFile(file);
    if (t) return t;
  }

  // Portable/cloud starters may persist the token in a checkout .env.
  const dirs = [root, ...fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules').map(e => path.join(root, e.name))];
  for (const dir of dirs) {
    const t = tokenFromEnvFile(path.join(dir, '.env'));
    if (t) return t;
  }
  return '';
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv[0] === 'home') return homeCli(argv.slice(1), env);
  const command = argv.find(a => !a.startsWith('--')) || 'activate';
  const json = argv.includes('--json');
  if (!['activate', 'status'].includes(command) || argv.includes('--help')) {
    process.stdout.write('Usage: jaco activate [--json] [--no-tools]\n       jaco status [--json]\n');
    return command === 'activate' || argv.includes('--help') ? 0 : 2;
  }
  const baseUrl = String(env.JACO_RUNTIME_URL || `http://127.0.0.1:${env.PORT || 3000}`).replace(/\/+$/, '');
  const say = text => { if (!json) process.stderr.write(`${text}\n`); };

  if (command === 'activate' && !(await runtimeUp({ baseUrl }))) {
    const plan = startPlan({ env });
    say(`Startar stacken: ${plan.label}`);
    const started = spawnSync(plan.cmd, plan.args, { cwd: ROOT, stdio: json ? 'ignore' : ['ignore', process.stderr, process.stderr], env });
    if (started.status !== 0) say(`Startkommandot avslutades med kod ${started.status ?? 'okänd'}; kontrollerar ändå om runtimen svarar.`);
    for (let waited = 0; waited < 90_000 && !(await runtimeUp({ baseUrl })); waited += 2000) await sleep(2000);
  }

  const report = await activationReport({ baseUrl, token: gatewayToken(env), startTools: command === 'activate' && !argv.includes('--no-tools') });
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatReport(report)}\n`);
  return report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }, error => { process.stderr.write(`jaco: ${error?.message || error}\n`); process.exitCode = 2; });
}
