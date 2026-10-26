#!/usr/bin/env node
// JACO Lite: one command to run the JACO IDE on your own computer.
//
//   node start.mjs [project-folder] [--port N] [--no-open] [--check] [--verbose] [--help]
//
// It starts the IDE server that ships in this folder (dist/server.cjs) for the project folder you give
// (default: the folder you run it from), waits until the server really answers, prints the address and
// opens your browser. Everything stays on this computer: the server listens on 127.0.0.1 only, and your
// model providers and their keys are set up inside the IDE.
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const MIN_NODE = '22.5';
export const DEFAULT_PORT = 3000;
const HOST = '127.0.0.1';

export const HELP = [
  'JACO Lite',
  '',
  'Usage: node start.mjs [project-folder] [options]',
  '',
  '  project-folder   the folder to open in the IDE (default: the folder you run this from)',
  '  --port N         use this port (default 3000, or the next free one)',
  '  --no-open        do not open the browser',
  '  --no-agent       start the IDE without the Nova agent',
  '  --check          check this installation and print what would start, then exit',
  '  --verbose        also print the server log',
  '  (set JACO_LITE_NO_UPDATE_CHECK=1 to stop it looking for a newer download on jacocode.com)',
  '  --whatsapp +NN…  let agents message you on WhatsApp: shows a QR code to scan with the agent\'s phone, then starts as usual',
  '  --whatsapp-check check that WhatsApp support and a voice engine are available, then exit',
  '  --help           print this text',
  '',
  `Needs Node.js ${MIN_NODE} or newer. Connect a model inside the IDE (Ollama and LM Studio are found`,
  'automatically; for a cloud provider paste its API key). The server listens on 127.0.0.1 only.',
].join('\n');

// node:sqlite, which the IDE server uses, arrived in Node 22.5.
export function nodeSupported(version = process.versions.node) {
  const [major, minor] = String(version).split('.').map(Number);
  if (!Number.isInteger(major)) return false;
  return major > 22 || (major === 22 && Number.isInteger(minor) && minor >= 5);
}

export function parseArgs(argv = []) {
  const out = { help: false, check: false, open: true, agent: true, verbose: false, whatsapp: null, whatsappCheck: false, port: null, project: null, errors: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i]);
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--check') out.check = true;
    else if (arg === '--no-open') out.open = false;
    else if (arg === '--no-agent') out.agent = false;
    else if (arg === '--verbose') out.verbose = true;
    else if (arg === '--whatsapp-check') out.whatsappCheck = true;
    else if (arg === '--whatsapp' || arg.startsWith('--whatsapp=')) {
      const value = arg === '--whatsapp' ? argv[++i] : arg.slice('--whatsapp='.length);
      if (!value || value.startsWith('-')) out.errors.push('--whatsapp needs your number in international form, for example --whatsapp +46701234567');
      else out.whatsapp = value;
    }
    else if (arg === '--port' || arg.startsWith('--port=')) {
      const value = arg === '--port' ? argv[++i] : arg.slice('--port='.length);
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) out.errors.push(`--port needs a number from 1 to 65535, got "${value ?? ''}"`);
      else out.port = port;
    } else if (arg.startsWith('-')) out.errors.push(`unknown option ${arg}`);
    else if (out.project === null) out.project = arg;
    else out.errors.push(`only one project folder can be given, got "${arg}" as well`);
  }
  return out;
}

export function isPortFree(port, host = HOST) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

// The first free port from `start`; with `strict` only `start` itself is acceptable.
export async function findFreePort(start = DEFAULT_PORT, { tries = 20, strict = false, check = isPortFree } = {}) {
  for (let p = start; p < start + (strict ? 1 : tries) && p <= 65535; p += 1) {
    if (await check(p)) return p;
  }
  throw new Error(strict ? `PORT_IN_USE:${start}` : `NO_FREE_PORT:${start}`);
}

// Which folder the IDE opens: the one asked for, else where you ran the command, else a "workspace"
// folder next to this installation (so running it from inside the unzipped folder never opens the
// installation itself).
export function resolveProject({ project, cwd, installDir }) {
  if (project) return path.resolve(cwd, project);
  const inside = path.relative(installDir, cwd);
  if (!inside || (!inside.startsWith('..') && !path.isAbsolute(inside))) return path.join(installDir, 'workspace');
  return path.resolve(cwd);
}

// The IDE keeps its state in <project>/.jaco. A "*" .gitignore inside keeps it out of the project's git.
export function ensureProject(dir, fsImpl = fs) {
  fsImpl.mkdirSync(path.join(dir, '.jaco'), { recursive: true });
  const ignore = path.join(dir, '.jaco', '.gitignore');
  if (!fsImpl.existsSync(ignore)) fsImpl.writeFileSync(ignore, '*\n');
}

// The budget guard's first-start policy: cloud models allowed and no cost caps. Caps are something the operator
// turns on in the IDE's budget panel, not something JACO decides. Written only when no policy exists yet, so a
// change the operator made is never overwritten. Outgoing purchases are not covered by this budget and still
// wait for the operator (spendGuard).
export function ensureEconomicPolicy(project, fsImpl = fs) {
  const file = path.join(project, '.jaco', 'continuum', 'economic-policy.json');
  if (fsImpl.existsSync(file)) return false;
  fsImpl.mkdirSync(path.dirname(file), { recursive: true });
  fsImpl.writeFileSync(file, `${JSON.stringify({ cloudEnabled: true, manualAuraCloudEnabled: true, novaOllamaCloudEnabled: true }, null, 2)}
`);
  return true;
}

export function checkInstall(installDir, fsImpl = fs) {
  const need = ['dist/server.cjs', 'dist/index.html', 'dist/workplace.mjs', 'dist/jaco-editor.mjs', 'dist/connect.html', 'node_modules/express/package.json'];
  return need.filter(rel => !fsImpl.existsSync(path.join(installDir, rel))).map(rel => `missing ${rel}`);
}

// Reject mixed/stale/partially extracted archives before starting any child process.
// SHA-256 here detects accidental corruption; public artifact authenticity is checked
// independently against the workflow's .sha256 sidecar.
export function checkReleaseIntegrity(installDir, fsImpl = fs) {
  const root = path.resolve(installDir);
  const manifestPath = path.join(root, 'release.json');
  if (!fsImpl.existsSync(manifestPath)) return ['missing release.json'];
  let release;
  try { release = JSON.parse(fsImpl.readFileSync(manifestPath, 'utf8')); }
  catch { return ['release.json is invalid JSON']; }
  if (release.schema !== 'jaco.lite-release/v1' || release.workspace !== 'cognitive-live/v1')
    return ['release.json has an unsupported schema or workspace'];
  if (typeof release.entry !== 'string' || !release.entry.startsWith('/assets/') || !/^[A-Za-z0-9._-]+[.]js$/.test(release.entry.slice('/assets/'.length)))
    return ['release.json has an invalid client entry'];
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const tracked = [
    ['dist/server.cjs', release.serverSha256],
    ['dist/index.html', release.indexSha256],
    ['dist' + release.entry, release.clientSha256],
  ];
  const errors = [];
  for (const [relative, expected] of tracked) {
    if (!/^[a-f0-9]{64}$/.test(String(expected || ''))) { errors.push('invalid digest for ' + relative); continue; }
    const file = path.join(root, relative);
    try {
      if (sha(fsImpl.readFileSync(file)) !== expected) errors.push('checksum mismatch for ' + relative);
    } catch { errors.push('missing or unreadable ' + relative); }
  }
  return errors;
}

// Node's child_process 'exit' callback reports code=null for signal termination.
 // A missing exit code is not a successful exit: 137 is the conventional
 // representation for SIGKILL, but this alone does NOT prove Android OOM.
export function liteExitCode(code, signal, signals = os.constants.signals) {
  if (Number.isInteger(code)) return code;
  const number = signal ? signals?.[signal] : null;
  return Number.isInteger(number) ? 128 + number : 1;
}

// Durable lightweight breadcrumbs separate from server stdout: SIGKILL often
// has no JS stack or chance to flush the child's stdout/stderr. If Android kills
// the launcher *as well*, even this callback cannot run; absence is inconclusive.
export function appendLiteLifecycle(project, event, fsImpl = fs) {
  try {
    const file = path.join(project, '.jaco', 'lite-lifecycle.jsonl');
    fsImpl.appendFileSync(file, JSON.stringify({
      schema: 'jaco.lite.lifecycle/v1',
      observedAt: new Date().toISOString(),
      ...event,
    }) + '\n', { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch { return false; } // observability must never bring the runtime down
}

export function serverCommand(installDir, execPath = process.execPath) {
  return { cmd: execPath, args: ['--experimental-sqlite', path.join(installDir, 'dist', 'server.cjs')] };
}

export function serverEnv({ env, installDir, project, port, token }) {
  return {
    ...env,
    NODE_ENV: 'production',
    PORT: String(port),
    JACO_RUNTIME_URL: `http://127.0.0.1:${port}`,
    JACO_WORKSPACE_ROOT: project,
    JACO_RELEASE_ROOT: installDir,
    JACO_LITE: '1',
    GATEWAY_TOKEN: token,
    JACO_GATEWAY_TOKEN: token,
    // The operator's own provider keys, the operator's own money: cloud calls are allowed, inside the
    // budget panel's default limits (5 USD a day, 1 USD a task) that the operator can change.
    JACO_CLOUD_ENABLED: env.JACO_CLOUD_ENABLED ?? 'true',
    JACO_AUTO_APPROVE_LEVEL: env.JACO_AUTO_APPROVE_LEVEL ?? '5',
    JACO_POLICY_EDIT_GRANT: env.JACO_POLICY_EDIT_GRANT ?? '1',
  };
}

// The Nova agent is one bundled file next to the server. It finds its missions in the runtime and runs them
// in git copies of the project; Workplace is launched locally, while SEER is not part of Lite.
export function agentCommand(installDir, execPath = process.execPath, fsImpl = fs) {
  const file = path.join(installDir, 'dist', 'nova.mjs');
  return fsImpl.existsSync(file) ? { cmd: execPath, args: [file] } : null;
}

export function agentEnv({ env, installDir, project, url, token }) {
  return {
    ...env,
    JACO_RUNTIME_URL: url,
    GATEWAY_TOKEN: token,
    JACO_GATEWAY_TOKEN: token,
    JACO_WORKSPACE_ROOT: project,
    JACO_RELEASE_ROOT: installDir,
    NOVA_STATE_DIR: path.join(project, '.jaco', 'nova-state'),
    NOVA_BRAIN_MODE: 'direct',
    JACO_WORKPLACE_REQUIRED: env.JACO_WORKPLACE_REQUIRED ?? '0',
    JACO_LITE: '1',
    // The agent plans with the models the operator connected in the IDE (any provider, asked from the runtime),
    // including paid ones: they are the operator's own keys, bounded by Nova's daily call ceiling.
    JACO_ALLOW_PAID_MODELS: env.JACO_ALLOW_PAID_MODELS ?? '1',
    // Work autonomously within the mission contract and operator boundaries. Hard payment,
    // uncertain-outcome and policy stops remain in approval-policy.mjs at every level.
    JACO_AUTO_APPROVE_LEVEL: env.JACO_AUTO_APPROVE_LEVEL ?? '5',
    JACO_POLICY_EDIT_GRANT: env.JACO_POLICY_EDIT_GRANT ?? '1',
  };
}

// A 200 OK is insufficient: the SPA catch-all also returns 200 + HTML for /health.
// Verify JSON product identity from the actual service. Workplace retains its own
// /health route; the IDE answers /api/runtime/identity.
export async function waitForHealth(url, { timeoutMs = 90_000, intervalMs = 400, fetchImpl = fetch, alive = () => true, expectedProduct = 'JACO Autonomus IDE' } = {}) {
  const healthPath = expectedProduct === 'JACO Workplace' ? '/health' : '/api/runtime/identity';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!alive()) return false;
    try {
      const res = await fetchImpl(`${url}${healthPath}`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const payload = await res.json();
        if (payload?.success === true && payload.product === expectedProduct) return true;
        if (expectedProduct === 'JACO Workplace' && payload?.product === expectedProduct) return true;
      }
    } catch { /* not ready, or HTML fallback instead of a service health receipt */ }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

export function openBrowser(url, platform = process.platform, spawnImpl = spawn) {
  const termux = platform === 'android' || Boolean(process.env.TERMUX_VERSION);
  const [cmd, args] = platform === 'win32' ? ['cmd.exe', ['/c', 'start', '', url]] : platform === 'darwin' ? ['open', [url]] : termux ? ['termux-open-url', [url]] : ['xdg-open', [url]];
  try {
    const child = spawnImpl(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on?.('error', () => {});
    child.unref?.();
    return true;
  } catch { return false; }
}

// A newer download on jacocode.com (operator 2026-10-13: "Lite needs updating"). The launcher only READS
// latest.json (no identifier is sent) and prints where the newer file is; it never downloads or runs anything.
// JACO_LITE_NO_UPDATE_CHECK=1 turns it off.
export const UPDATE_URL = 'https://jacocode.com/download/latest.json';
const PUBLIC_FILES = new Set(['jaco-lite.zip', 'jaco-lite-windows.zip', 'jaco-lite-android.zip']);
export function platformFor({ release = null, platform = process.platform, env = process.env } = {}) {
  if (release?.platform === 'windows' || release?.platform === 'android') return release.platform;
  if (platform === 'win32') return 'windows';
  if (env.TERMUX_VERSION || /com\.termux/.test(env.PREFIX || '')) return 'android';
  return 'universal';
}
// Newer means built later: a different commit with an older build time (a test build) is not an update.
export function isNewer(local, latest) {
  if (!latest || latest.schema !== 'jaco.lite-latest/v1') return false;
  const had = Date.parse(local?.builtAt), has = Date.parse(latest.builtAt);
  if (!Number.isFinite(had) || !Number.isFinite(has) || has <= had) return false;
  return !(local.sourceCommit && latest.sourceCommit && local.sourceCommit === latest.sourceCommit);
}
export async function checkForUpdate({ installDir, fetchImpl = fetch, env = process.env, platform = process.platform, url = UPDATE_URL, timeoutMs = 4000, fsImpl = fs } = {}) {
  try {
    const local = JSON.parse(fsImpl.readFileSync(path.join(installDir, 'release.json'), 'utf8'));
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
    if (!res.ok) return { state: 'UNKNOWN', reason: `HTTP_${res.status}` };
    const latest = await res.json();
    if (!isNewer(local, latest)) return { state: 'CURRENT' };
    const entry = latest.files?.[platformFor({ release: local, platform, env })] || latest.files?.universal;
    if (!entry || !PUBLIC_FILES.has(entry.file)) return { state: 'UNKNOWN', reason: 'NO_DOWNLOAD_LISTED' };
    return { state: 'UPDATE', file: entry.file, url: `https://jacocode.com/download/${entry.file}`, sha256: /^[a-f0-9]{64}$/.test(entry.sha256 || '') ? entry.sha256 : null, builtAt: latest.builtAt, installedBuiltAt: local.builtAt };
  } catch (error) { return { state: 'UNKNOWN', reason: String(error?.name === 'TimeoutError' ? 'TIMEOUT' : error?.message || error).slice(0, 80) }; }
}
export function updateNotice(result, env = process.env) {
  if (result?.state !== 'UPDATE') return [];
  const head = ['', `A newer JACO Lite is available (built ${result.builtAt}, yours ${result.installedBuiltAt}).`];
  // Installed with install.sh / install.ps1: one command does it, checks the download and keeps the old build for rollback.
  if (env.JACO_LITE_INSTALLER === '1') return [...head, '  Update with:  jaco-lite update     (back to this build with:  jaco-lite rollback)'];
  return [...head, `  ${result.url}${result.sha256 ? `   SHA-256 ${result.sha256}` : ''}`, '  Unzip it into a new folder; your projects stay where they are.'];
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const env = deps.env ?? process.env;
  const out = deps.out ?? (line => process.stdout.write(`${line}\n`));
  const err = deps.err ?? (line => process.stderr.write(`${line}\n`));
  const installDir = deps.installDir ?? path.dirname(fileURLToPath(import.meta.url));
  const fsImpl = deps.fs ?? fs;
  const args = parseArgs(argv);
  if (args.help) { out(HELP); return 0; }
  if (args.errors.length) { for (const e of args.errors) err(`jaco-lite: ${e}`); err('Try: node start.mjs --help'); return 2; }
  if (!nodeSupported(deps.nodeVersion)) {
    err(`jaco-lite: Node.js ${MIN_NODE} or newer is required, this is ${deps.nodeVersion ?? process.versions.node}.`);
    err('Install the current LTS from https://nodejs.org and run this again.');
    return 2;
  }
  const problems = checkInstall(installDir, fsImpl);
  if (problems.length) {
    err(`jaco-lite: this folder is not a complete installation (${problems.join(', ')}). Unzip the download again.`);
    return 3;
  }
  const integrityErrors = checkReleaseIntegrity(installDir, fsImpl);
  if (integrityErrors.length) {
    err('jaco-lite: installation verification failed: ' + integrityErrors.join(', ') + '. Extract a fresh verified ZIP.');
    return 3;
  }
  // The WhatsApp voice channel (see src/server/connected/voiceChannel.mjs in the runtime): link once from the terminal.
  if (args.whatsappCheck || args.whatsapp) {
    const linker = path.join(installDir, 'dist', 'voice-link.mjs');
    if (!fsImpl.existsSync(linker)) { err('jaco-lite: this download has no WhatsApp support (dist/voice-link.mjs is missing).'); return 3; }
    const run = (deps.spawnSync ?? spawnSync)(deps.execPath ?? process.execPath, [linker, args.whatsappCheck ? '--check' : args.whatsapp], { stdio: 'inherit', cwd: installDir, env });
    if (args.whatsappCheck || run.status !== 0) return run.status ?? 1;
  }
  const project = resolveProject({ project: args.project, cwd: deps.cwd ?? process.cwd(), installDir });
  let port;
  try { port = await (deps.findPort ?? findFreePort)(args.port ?? DEFAULT_PORT, { strict: args.port !== null }); }
  catch (error) {
    err(String(error.message).startsWith('PORT_IN_USE')
      ? `jaco-lite: port ${args.port} is in use. Pick another with --port, or leave it out to take the next free one.`
      : `jaco-lite: no free port found from ${args.port ?? DEFAULT_PORT}.`);
    return 4;
  }
  const command = serverCommand(installDir, deps.execPath);
  if (args.check) {
    out('JACO Lite: installation OK');
    out(`  node:     ${deps.nodeVersion ?? process.versions.node}`);
    out(`  install:  ${installDir}`);
    out(`  project:  ${project}`);
    out(`  port:     ${port}`);
    out(`  command:  ${path.basename(command.cmd)} ${command.args.map(a => path.relative(installDir, a) || a).join(' ')}`);
    return 0;
  }

  ensureProject(project, fsImpl);
  ensureEconomicPolicy(project, fsImpl);
  // Every Lite installation owns its loopback Workplace; never attach to an unrelated installation.
  const workplacePort = await (deps.findPort ?? findFreePort)(2995);
  const workplaceUrl = 'http://' + HOST + ':' + workplacePort;
  const workplaceEnv = { ...env, JACO_WORKPLACE_HOST: HOST, JACO_WORKPLACE_PORT: String(workplacePort),
    JACO_WORKSPACE_ROOT: project, JACO_WORKPLACE_SUPERVISE_MODEL: '0', JACO_WORKPLACE_SUPERVISE_NOVA: '0',
    JACO_WORKPLACE_SUPERVISE_SEER: '0', JACO_CHATGPT_WORKPLACE_TOKEN: '', JACO_GITHUB_CONTROL_TOKEN: '',
    GH_TOKEN: '', GITHUB_TOKEN: '', JACO_WORKPLACE_TOKEN: '', JACO_WORKPLACE_OPERATOR_TOKEN: '' };
  let shutdownRequested = false;
  const lifecycle = event => appendLiteLifecycle(project, { launcherPid: process.pid, ...event }, fsImpl);
  const processStopped = (component, proc, code, signal) => {
    const exitCode = liteExitCode(code, signal);
    lifecycle({ component, event: 'EXIT', pid: proc?.pid ?? null, exitCode, signal: signal || null, expected: shutdownRequested });
    if (!shutdownRequested) {
      err('jaco-lite: ' + component + ' stopped unexpectedly (exit ' + exitCode
        + (signal ? ', signal ' + signal : '') + '). See ' + path.join(project, '.jaco', 'lite-lifecycle.jsonl'));
      if (signal === 'SIGKILL') err('jaco-lite: SIGKILL may be Android memory pressure, a system policy, or an external kill; it is not proof of OOM.');
    }
    return exitCode;
  };
  const workplaceLog = fsImpl.createWriteStream?.(path.join(project, '.jaco', 'workplace.log'), { flags: 'a' });
  const workplace = (deps.spawnImpl ?? spawn)(deps.execPath ?? process.execPath,
    ['--experimental-sqlite', path.join(installDir, 'dist', 'workplace.mjs')],
    { cwd: project, env: workplaceEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let workplaceAlive = true;
  const stopStartingWorkplace = () => { shutdownRequested = true; try { workplace.kill(); } catch { /* already gone */ } };
  if (!deps.noSignals) { process.once('SIGINT', stopStartingWorkplace); process.once('SIGTERM', stopStartingWorkplace); }
  workplace.stdout?.on('data', c => workplaceLog?.write(c));
  workplace.stderr?.on('data', c => workplaceLog?.write(c));
  workplace.once('exit', (code, signal) => { workplaceAlive = false; processStopped('workplace', workplace, code, signal); workplaceLog?.end(); });
  workplace.once('error', e => { workplaceAlive = false; lifecycle({ component:'workplace', event:'SPAWN_ERROR', reason: e.code || 'UNKNOWN' }); err('Anslutningstjänsten kunde inte startas: ' + e.message); });
  if (!await waitForHealth(workplaceUrl, { alive: () => workplaceAlive, fetchImpl: deps.fetchImpl, timeoutMs: deps.healthTimeoutMs, expectedProduct: 'JACO Workplace' })) {
    shutdownRequested = true; workplace.kill(); err('JACO Workplace kunde inte startas. Se .jaco/workplace.log.'); return 5;
  }
  const connectedEnv = { ...env, JACO_WORKPLACE_URL: workplaceUrl, JACO_WORKPLACE_REQUIRED: '1',
    JACO_WORKPLACE_TOKEN: '', JACO_HUB_URL: '', JACO_DEVICE_KEY: '' };
  const logFile = path.join(project, '.jaco', 'lite.log');
  const log = fsImpl.createWriteStream ? fsImpl.createWriteStream(logFile, { flags: 'a' }) : null;
  // JACO_LITE_TOKEN lets a test follow the agent's missions; normally the token is random and never shown.
  const token = env.JACO_LITE_TOKEN || crypto.randomBytes(24).toString('hex');
  const child = (deps.spawnImpl ?? spawn)(command.cmd, command.args, {
    cwd: project,
    env: serverEnv({ env: connectedEnv, installDir, project, port, token }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let tail = '';
  let exited = null;
  let agent = null;
  const onData = chunk => {
    const text = String(chunk);
    log?.write(text);
    tail = (tail + text).slice(-4000);
    if (args.verbose) process.stdout.write(text);
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  const finished = new Promise(resolve => {
    child.once('exit', (code, signal) => { exited = processStopped('ide', child, code, signal); resolve(exited); });
    child.once('error', error => { exited = 1; tail += `\n${error.message}`; lifecycle({ component:'ide', event:'SPAWN_ERROR', reason: error.code || 'UNKNOWN' }); resolve(1); });
  });
  const stop = () => { shutdownRequested = true; for (const p of [agent, child, workplace]) { try { p?.kill(); } catch { /* already gone */ } } };
  if (!deps.noSignals) {
    process.removeListener('SIGINT', stopStartingWorkplace); process.removeListener('SIGTERM', stopStartingWorkplace);
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  }

  const url = `http://${HOST}:${port}`;
  const up = await waitForHealth(url, { alive: () => exited === null, fetchImpl: deps.fetchImpl, timeoutMs: deps.healthTimeoutMs });
  if (!up) {
    stop();
    err(exited !== null ? `jaco-lite: the server stopped right after starting (exit code ${exited}).` : 'jaco-lite: the server did not answer within 90 seconds.');
    if (tail.trim()) err(`--- last server output (full log: ${logFile}) ---\n${tail.trim()}`);
    return 5;
  }
  lifecycle({ component: 'ide', event: 'READY', pid: child.pid ?? null, port, agentEnabled: args.agent, workplacePid: workplace.pid ?? null });
  out('JACO Lite is running.');
  out(`  IDE:      ${url}`);
  out(`  Project:  ${project}`);
  const agentCmd = args.agent ? agentCommand(installDir, deps.execPath, fsImpl) : null;
  if (agentCmd) {
    fsImpl.mkdirSync(path.join(project, '.jaco', 'nova-state'), { recursive: true });
    const agentLog = fsImpl.createWriteStream ? fsImpl.createWriteStream(path.join(project, '.jaco', 'nova.log'), { flags: 'a' }) : null;
    agent = (deps.spawnImpl ?? spawn)(agentCmd.cmd, agentCmd.args, {
      cwd: path.join(project, '.jaco'),
      env: agentEnv({ env: connectedEnv, installDir, project, url, token }),
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    agent.stdout?.on('data', c => agentLog?.write(c));
    agent.stderr?.on('data', c => agentLog?.write(c));
    agent.once('exit', (code, signal) => {
      const exitCode = processStopped('agent', agent, code, signal);
      agentLog?.write(`\n[nova exited ${exitCode}${signal ? ' signal ' + signal : ''}]\n`);
      agentLog?.end();
    });
    agent.once('error', error => {
      lifecycle({ component:'agent', event:'SPAWN_ERROR', reason:error.code || 'UNKNOWN' });
      agentLog?.write(`\n[nova failed to start: ${error.message}]\n`);
    });
  }
  out(`  Agent:    ${agentCmd ? 'Nova is running: give it a goal in the chat (log: .jaco/nova.log)' : args.agent ? 'not part of this installation' : 'off (--no-agent)'}`);
  out('  Stop:     press Ctrl+C in this window');
  // Never blocks the start: a failed or slow check prints nothing. Tests that inject a fetch skip the real one.
  const updateFetch = deps.updateFetch ?? (deps.fetchImpl ? null : fetch);
  if (updateFetch && env.JACO_LITE_NO_UPDATE_CHECK !== '1') {
    void checkForUpdate({ installDir, fetchImpl: updateFetch, env, fsImpl }).then(r => { for (const line of updateNotice(r, env)) out(line); }, () => {});
  }
  out('');
  out('JACO discovers available local models, connects configured providers and starts its bundled tools.');
  out('Write your goal in the conversation. Chat settings and the connection guide are optional overrides.');
  out('  Anslutningar: ' + url + '/connect.html');
  if (args.open) (deps.open ?? openBrowser)(url);
  const code = await finished;
  const intentionalStop = shutdownRequested;
  shutdownRequested = true;
  try { agent?.kill(); } catch { /* already gone */ }
  try { workplace?.kill(); } catch { /* already gone */ }
  log?.end();
  // A clean '0' without a requested shutdown is still an IDE outage.
  return intentionalStop ? 0 : code === 0 ? 1 : code;
}

// Started through a symlink (the installer's  current  link, an npm bin) argv[1] is the link, import.meta.url the real file.
export function isEntryPoint(argv1 = process.argv[1], url = import.meta.url, real = fs.realpathSync) {
  if (!argv1) return false;
  const file = fileURLToPath(url);
  if (path.resolve(argv1) === file) return true;
  try { return real(argv1) === real(file); } catch { return false; }
}
if (isEntryPoint()) {
  main().then(code => { process.exitCode = code; }, error => { process.stderr.write(`${error?.stack || error}\n`); process.exitCode = 1; });
}
