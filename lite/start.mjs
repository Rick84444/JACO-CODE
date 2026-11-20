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
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MIN_NODE = '22.5';
export const DEFAULT_PORT = 3000;
const HOST = '127.0.0.1';

export const HELP = [
  'JACO Lite',
  '',
  'Usage: node start.mjs [project-folder] [options]',
  '',
  '  project-folder   the folder to open in the IDE (default: the folder you run this from)',
  '  --port N         use this exact port (default 3000; no silent fallback)',
  '  --recover        gracefully hand off a verified prior Linux Lite owner',
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
  const out = { help: false, check: false, open: true, agent: true, verbose: false, recover: false, whatsapp: null, whatsappCheck: false, port: null, project: null, errors: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i]);
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--check') out.check = true;
    else if (arg === '--no-open') out.open = false;
    else if (arg === '--no-agent') out.agent = false;
    else if (arg === '--verbose') out.verbose = true;
    else if (arg === '--recover') out.recover = true;
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

// The ledger owns stale-lock reclamation. The launcher only diagnoses or gracefully
// hands off a positively identified previous Lite owner; it never removes its lock.
function linuxProcess(pid, io = fs) {
  try {
    const base = '/proc/' + pid;
    const stat = io.readFileSync(base + '/stat', 'utf8');
    const fields = stat.slice(stat.lastIndexOf(') ') + 2).trim().split(/\s+/);
    return { pid, state: fields[0], parent: Number(fields[1]), startTicks: fields[19],
      uid: io.statSync(base).uid, cwd: io.realpathSync(base + '/cwd'),
      argv: io.readFileSync(base + '/cmdline', 'utf8').split('\0').filter(Boolean) };
  } catch { return null; }
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

export function inspectStartupWriter({ project, installDir, fsImpl = fs, platform = process.platform,
  hostname = os.hostname(), uid = process.getuid?.(), alive = processAlive,
  inspect = pid => linuxProcess(pid, fsImpl) }) {
  const file = path.join(project, '.jaco', 'continuum', 'ledger', 'events.lock');
  let holder;
  try { holder = JSON.parse(fsImpl.readFileSync(file, 'utf8')); }
  catch (error) { return { state: error.code === 'ENOENT' ? 'CLEAR' : 'UNKNOWN_LOCK' }; }
  const pid = holder?.pid;
  if (holder?.host !== hostname || !Number.isSafeInteger(pid) || pid <= 1) return { state: 'UNKNOWN_LOCK' };
  if (!alive(pid)) return { state: 'CLEAR' };
  if (platform !== 'linux') return { state: 'LIVE_UNVERIFIED', pid };
  let boot, root, install;
  try {
    boot = fsImpl.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    root = fsImpl.realpathSync(project);
    install = fsImpl.realpathSync(installDir);
  } catch { return { state: 'LIVE_UNVERIFIED', pid }; }
  const core = inspect(pid);
  if (holder.bootId && boot && holder.bootId !== boot) return { state: 'CLEAR' };
  if (core?.startTicks && holder.startTicks && String(holder.startTicks) !== core.startTicks) return { state: 'CLEAR' };
  if (!core || !holder.ownerId || !holder.bootId || !holder.startTicks || !boot ||
      typeof uid !== 'number' || core.uid !== uid || core.cwd !== root ||
      core.state === 'Z' || !core.startTicks || core.argv.length !== 3 ||
      core.argv[1] !== '--experimental-sqlite' || !path.isAbsolute(core.argv[2])) return { state: 'LIVE_UNVERIFIED', pid };
  let oldInstall;
  try {
    const server = fsImpl.realpathSync(core.argv[2]);
    oldInstall = path.dirname(path.dirname(server));
    const samePackageFamily = oldInstall === install ||
      (path.basename(path.dirname(install)) === 'versions' && path.dirname(oldInstall) === path.dirname(install));
    if (!samePackageFamily || server !== path.join(oldInstall, 'dist', 'server.cjs')) return { state: 'LIVE_UNVERIFIED', pid };
    const release = JSON.parse(fsImpl.readFileSync(path.join(oldInstall, 'release.json'), 'utf8'));
    if (release.schema !== 'jaco.lite-release/v1' || !release.indexSha256 || !release.clientSha256 || !release.entry) return { state: 'LIVE_UNVERIFIED', pid };
  } catch { return { state: 'LIVE_UNVERIFIED', pid }; }
  // A live launcher must own this actual core as its direct child. Do not signal a
  // shell, system supervisor, other workspace, or arbitrary PID from a lockfile.
  let target = core;
  if (core.parent !== 1) {
    const parent = inspect(core.parent);
    try {
      if (!parent || parent.pid <= 1 || parent.uid !== uid || parent.cwd !== root ||
          !parent.startTicks || parent.state === 'Z' || !parent.argv[1] ||
          ![path.join(oldInstall, 'start.mjs'), path.join(install, 'start.mjs')].includes(fsImpl.realpathSync(path.resolve(parent.cwd, parent.argv[1])))) {
        return { state: 'LIVE_UNVERIFIED', pid };
      }
    } catch { return { state: 'LIVE_UNVERIFIED', pid }; }
    target = parent;
  }
  if (target.pid === process.pid || core.pid === process.pid) return { state: 'LIVE_UNVERIFIED', pid };
  return { state: 'OWNED', pid, ownerId: holder.ownerId, core, target, oldInstall, sameRelease: oldInstall === install };
}

function ownsLoopbackListener(pid, port, io = fs) {
  try {
    const inodes = new Set(io.readdirSync('/proc/' + pid + '/fd').flatMap(fd => {
      try { return [io.readlinkSync('/proc/' + pid + '/fd/' + fd).match(/^socket:\[(\d+)\]$/)?.[1]]; } catch { return []; }
    }).filter(Boolean));
    const address = '0100007F:' + port.toString(16).toUpperCase().padStart(4, '0');
    return io.readFileSync('/proc/net/tcp', 'utf8').split('\n').some(line => {
      const f = line.trim().split(/\s+/);
      return f[1] === address && f[3] === '0A' && inodes.has(f[9]);
    });
  } catch { return false; }
}

function sameWriter(a, b) {
  return a.state === 'OWNED' && b.state === 'OWNED' && a.pid === b.pid &&
    a.ownerId === b.ownerId && a.core.startTicks === b.core.startTicks &&
    a.target.pid === b.target.pid && a.target.startTicks === b.target.startTicks;
}

export async function recoverLiteStartup({ project, installDir, port, release, recover = false,
  fsImpl = fs, platform = process.platform, fetchImpl = fetch,
  observe = () => inspectStartupWriter({ project, installDir, fsImpl, platform }),
  ownsPort = pid => ownsLoopbackListener(pid, port, fsImpl),
  signal = pid => process.kill(pid, 'SIGTERM'), alive = processAlive,
  inspect = pid => linuxProcess(pid, fsImpl), portFree = () => isPortFree(port),
  timeoutMs = 30_000, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const initial = observe();
  if (initial.state === 'CLEAR') return { action: 'START' };
  if (initial.state !== 'OWNED') return { action: 'BLOCKED', reason: initial.state, pid: initial.pid };
  const url = 'http://' + HOST + ':' + port;
  if (initial.sameRelease && ownsPort(initial.pid)) {
    const healthy = await waitForHealth(url, { fetchImpl, timeoutMs: 2500 });
    const ui = healthy ? await verifyLiteUi(url, release, { fetchImpl }) : { ok: false };
    if (ui.ok && sameWriter(initial, observe()) && ownsPort(initial.pid)) return { action: 'REUSE', pid: initial.pid, url };
  }
  if (!recover) return { action: 'BLOCKED', reason: 'OWNED_WRITER_RESTART_REQUIRES_RECOVER', pid: initial.pid };
  if (!ownsPort(initial.pid) && !await portFree()) return { action: 'BLOCKED', reason: 'PORT_OWNERSHIP_UNKNOWN', pid: initial.pid };
  if (!sameWriter(initial, observe())) return { action: 'BLOCKED', reason: 'OWNER_CHANGED', pid: initial.pid };
  try { signal(initial.target.pid); }
  catch { return { action: 'BLOCKED', reason: 'GRACEFUL_STOP_FAILED', pid: initial.pid }; }
  const gone = p => {
    if (!alive(p.pid)) return true;
    const live = inspect(p.pid);
    return Boolean(live?.startTicks && live.startTicks !== p.startTicks);
  };
  const deadline = Date.now() + timeoutMs;
  do {
    if (gone(initial.core) && gone(initial.target) && observe().state === 'CLEAR' && await portFree()) {
      return { action: 'RECOVERED', pid: initial.pid };
    }
    if (Date.now() >= deadline) break;
    await pause(250);
  } while (true);
  return { action: 'BLOCKED', reason: 'HANDOFF_NOT_VERIFIED', pid: initial.pid };
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

// In a packaged Lite build, Workplace's __dirname points inside dist, not to
// the operator's Git checkout. The public tokenless relay must read the actual
// open project repo; its Git transport independently validates the origin.
// Never manufacture a checkout, grant host permissions or expose credentials.
export function liteWorkplaceChildEnv({ childEnv, project, workplacePort }) {
  return { ...childEnv, JACO_WORKPLACE_HOST: HOST, JACO_WORKPLACE_PORT: String(workplacePort),
    JACO_WORKSPACE_ROOT: project,
    JACO_CHATGPT_GIT_REPO_ROOT: childEnv.JACO_CHATGPT_GIT_REPO_ROOT || childEnv.JACO_REPO_ROOT || project,
    JACO_WORKPLACE_SUPERVISE_MODEL: '0', JACO_WORKPLACE_SUPERVISE_NOVA: '0',
    JACO_WORKPLACE_SUPERVISE_SEER: '0', JACO_CHATGPT_WORKPLACE_TOKEN: '', JACO_GITHUB_CONTROL_TOKEN: '',
    GH_TOKEN: '', GITHUB_TOKEN: '', JACO_WORKPLACE_TOKEN: '', JACO_WORKPLACE_OPERATOR_TOKEN: '' };
}

// Only this isolated local launcher may default to unsynchronized operation.
// Paired Hub/device credentials are never inherited by its local executor.
export function liteWorkplaceRequired(env = {}) {
  return env.JACO_WORKPLACE_REQUIRED != null && env.JACO_WORKPLACE_REQUIRED !== '0';
}

export function liteLocalConnectionEnv({ childEnv, workplacePort, workplaceReady }) {
  return { ...childEnv, JACO_WORKPLACE_PORT: String(workplacePort),
    JACO_WORKPLACE_URL: workplaceReady ? 'http://' + HOST + ':' + workplacePort : '',
    JACO_WORKPLACE_REQUIRED: liteWorkplaceRequired(childEnv) ? '1' : '0',
    JACO_WORKPLACE_SCOPE: 'local', JACO_WORKPLACE_TOKEN: '', JACO_HUB_URL: '', JACO_DEVICE_KEY: '' };
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

// Where this installation is running, for the VS Code extension: a free port other than 3000 is otherwise
// invisible to it. One small file, removed when Lite stops; a stale one is recognised by its dead process id.
export const runtimeRecordFile = (home = os.homedir()) => path.join(home, '.jaco', 'lite-runtime.json');
export function writeRuntimeRecord({ home, url, port, project, installDir, sourceCommit }, fsImpl = fs) {
  try {
    const file = runtimeRecordFile(home);
    fsImpl.mkdirSync(path.dirname(file), { recursive: true });
    fsImpl.writeFileSync(file, JSON.stringify({ schema: 'jaco.runtime-record/v1', product: 'JACO Autonomus IDE', url, port, project, installDir, sourceCommit, launcherPid: process.pid, startedAt: new Date().toISOString() }, null, 2));
  } catch { /* observability must never stop the start */ }
}
export function removeRuntimeRecord({ home }, fsImpl = fs) {
  try {
    const file = runtimeRecordFile(home);
    if (JSON.parse(fsImpl.readFileSync(file, 'utf8')).launcherPid === process.pid) fsImpl.rmSync(file, { force: true });
  } catch { /* already gone */ }
}

export function serverCommand(installDir, execPath = process.execPath) {
  return { cmd: execPath, args: ['--experimental-sqlite', path.join(installDir, 'dist', 'server.cjs')] };
}

// The installer's private Node runs JACO by absolute path, but the agent starts
// npm and other tools by name. All Lite children must inherit that Node bin.
// Preserve the operator PATH and avoid a second differently-cased Windows Path.
export function liteChildEnv(env = process.env, execPath = process.execPath, platform = process.platform) {
  const windows = platform === 'win32';
  const paths = windows ? path.win32 : path.posix;
  const key = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
  const original = String(env[key] ?? '');
  if (typeof execPath !== 'string' || !paths.isAbsolute(execPath)) return { ...env };
  const bin = paths.dirname(execPath);
  const separator = windows ? ';' : ':';
  const parts = original.split(separator).filter(Boolean);
  const matches = part => windows ? part.toLowerCase() === bin.toLowerCase() : part === bin;
  if (!parts.some(matches)) parts.unshift(bin);
  return { ...env, [key]: parts.join(separator) };
}

// Android packages opt into lower idle overhead, not a particular model or provider.
export function liteMobileEnv(env, release = {}, platform = process.platform) {
  const mobile = release.platform === 'android' || platform === 'android' || Boolean(env.TERMUX_VERSION) || env.JACO_LITE_MOBILE === '1';
  if (!mobile) return { ...env };
  const lean = env.JACO_AURA_LEAN ?? '0';
  return { ...env, JACO_AURA_LEAN: lean, JACO_AUTO_START_TOOLS: env.JACO_AUTO_START_TOOLS ?? (lean === '1' ? '0' : '1') };
}

// Check the installed release's actual entry bytes, not merely the SPA fallback or API identity.
export async function verifyLiteUi(url, release, { fetchImpl = fetch } = {}) {
  try {
    const get = route => fetchImpl(url + route, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    const page = await get('/');
    if (!page.ok || !/text\/html/i.test(page.headers.get('content-type') || '')) return { ok:false, reason:'GUI_HTML_HTTP_' + page.status };
    const html = Buffer.from(await page.arrayBuffer());
    if (crypto.createHash('sha256').update(html).digest('hex') !== release.indexSha256) return { ok:false, reason:'GUI_HTML_DIGEST_MISMATCH' };
    if (!html.toString('utf8').includes(release.entry)) return { ok:false, reason:'GUI_ENTRY_MISSING' };
    const asset = await get(release.entry);
    if (!asset.ok || !/(?:java|ecma)script/i.test(asset.headers.get('content-type') || '')) return { ok:false, reason:'GUI_ENTRY_HTTP_' + asset.status };
    const hash = crypto.createHash('sha256');
    if (!asset.body) return { ok:false, reason:'GUI_ENTRY_EMPTY' };
    for await (const chunk of asset.body) hash.update(chunk);
    if (hash.digest('hex') !== release.clientSha256) return { ok:false, reason:'GUI_ENTRY_DIGEST_MISMATCH' };
    return { ok:true };
  } catch (e) { return { ok:false, reason:'GUI_FETCH_FAILED:' + (e.cause?.code || e.name || 'Error') }; }
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
    // The VS Code extension shows this same GUI. The framing exception is limited to direct loopback requests
    // and to VS Code's own origins (runtime/src/server/security/vscodeEmbed.mjs), so it is on by default here.
    JACO_VSCODE_EMBED: env.JACO_VSCODE_EMBED ?? '1',
    GATEWAY_TOKEN: token,
    JACO_GATEWAY_TOKEN: token,
    // The operator's own provider keys, the operator's own money: cloud calls are allowed, inside the
    // budget panel's default limits (5 USD a day, 1 USD a task) that the operator can change.
    JACO_CLOUD_ENABLED: env.JACO_CLOUD_ENABLED ?? 'true',
    JACO_AUTO_APPROVE_LEVEL: env.JACO_AUTO_APPROVE_LEVEL ?? '5',
    JACO_POLICY_EDIT_GRANT: env.JACO_POLICY_EDIT_GRANT ?? '0',
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
    JACO_POLICY_EDIT_GRANT: env.JACO_POLICY_EDIT_GRANT ?? '0',
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
        if (payload?.success === true && payload.product === expectedProduct) return alive();
        if (expectedProduct === 'JACO Workplace' && payload?.product === expectedProduct) return alive();
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
  if (env.JACO_LITE_INSTALLER === '1') return [...head, '  Stage update with:  jaco-lite update     (back to this build with:  jaco-lite rollback)'];
  return [...head, `  ${result.url}${result.sha256 ? `   SHA-256 ${result.sha256}` : ''}`, '  Unzip it into a new folder; your projects stay where they are.'];
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const env = deps.env ?? process.env;
  let childEnv = liteChildEnv(env, deps.execPath ?? process.execPath);
  const out = deps.out ?? (line => process.stdout.write(`${line}\n`));
  const err = deps.err ?? (line => process.stderr.write(`${line}\n`));
  // Pin the running launcher to the immutable version directory, never the movable current link.
  const installDir = deps.installDir ?? fs.realpathSync(path.dirname(fileURLToPath(import.meta.url)));
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
  const release = JSON.parse(fsImpl.readFileSync(path.join(installDir, 'release.json'), 'utf8'));
  childEnv = liteMobileEnv(childEnv, release, deps.platform ?? process.platform);
  // The WhatsApp voice channel (see src/server/connected/voiceChannel.mjs in the runtime): link once from the terminal.
  if (args.whatsappCheck || args.whatsapp) {
    const linker = path.join(installDir, 'dist', 'voice-link.mjs');
    if (!fsImpl.existsSync(linker)) { err('jaco-lite: this download has no WhatsApp support (dist/voice-link.mjs is missing).'); return 3; }
    const run = (deps.spawnSync ?? spawnSync)(deps.execPath ?? process.execPath, [linker, args.whatsappCheck ? '--check' : args.whatsapp], { stdio: 'inherit', cwd: installDir, env });
    if (args.whatsappCheck || run.status !== 0) return run.status ?? 1;
  }
  const project = resolveProject({ project: args.project, cwd: deps.cwd ?? process.cwd(), installDir });
  const requestedPort = args.port ?? DEFAULT_PORT;
  if (!args.check) {
    const result = await (deps.recoverStartup ?? recoverLiteStartup)({ project, installDir, port: requestedPort, release,
      recover: args.recover, fsImpl, platform: deps.platform ?? process.platform, fetchImpl: deps.fetchImpl ?? fetch });
    if (result.action !== 'START') {
      appendLiteLifecycle(project, { component: 'startup', event: result.action, pid: result.pid ?? null, reason: result.reason ?? null, port: requestedPort }, fsImpl);
      if (result.action === 'REUSE') {
        out('Existing JACO Lite verified: ' + result.url);
        if (args.open) (deps.openBrowser ?? openBrowser)(result.url, deps.platform ?? process.platform);
        return 0;
      }
      if (result.action === 'BLOCKED') {
        err('jaco-lite: ' + result.reason + (result.pid ? ' (ledger pid ' + result.pid + ')' : '') + '. No ledger data removed.');
        if (result.reason === 'OWNED_WRITER_RESTART_REQUIRES_RECOVER') err('Use --recover for a graceful same-workspace restart.');
        return 4;
      }
      out('Previous JACO Lite owner stopped; handoff verified.');
    }
  }
  let port;
  try { port = await (deps.findPort ?? findFreePort)(requestedPort, { strict: true }); }
  catch (error) {
    err(String(error.message).startsWith('PORT_IN_USE')
      ? `jaco-lite: port ${requestedPort} is in use by an unverified listener; no alternate port was selected.`
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
  // Core has not bound its port yet; reserve a distinct port for Workplace.
  const workplacePort = await (deps.findPort ?? findFreePort)(port === 2995 ? 2996 : 2995, { check: candidate => candidate !== port && isPortFree(candidate) });
  const workplaceUrl = 'http://' + HOST + ':' + workplacePort;
  const workplaceEnv = liteWorkplaceChildEnv({ childEnv, project, workplacePort });
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
  workplace.once('error', e => { workplaceAlive = false; lifecycle({ component:'workplace', event:'SPAWN_ERROR', reason: e.code || 'UNKNOWN' }); err('The connection service could not be started: ' + e.message); });
  const workplaceRequired = liteWorkplaceRequired(childEnv);
  const workplaceReady = await waitForHealth(workplaceUrl, { alive: () => workplaceAlive,
    fetchImpl: deps.fetchImpl, timeoutMs: deps.healthTimeoutMs ?? (workplaceRequired ? 90_000 : 10_000),
    expectedProduct: 'JACO Workplace' });
  if (shutdownRequested || (!workplaceReady && workplaceRequired)) {
    shutdownRequested = true;
    try { workplace.kill(); } catch { /* already gone */ }
    if (!deps.noSignals) {
      process.removeListener('SIGINT', stopStartingWorkplace); process.removeListener('SIGTERM', stopStartingWorkplace);
    }
    if (!workplaceReady) err('JACO Workplace could not be started. See .jaco/workplace.log.');
    return 5;
  }
  if (!workplaceReady) {
    // Never attach to an unverified listener or claim remote coordination.
    // Core/Nova retain their own local mission, tool and budget checks.
    try { workplace.kill(); } catch { /* already gone */ }
    lifecycle({ component: 'workplace', event: 'DEGRADED_UNSYNCED', reason: 'STARTUP_UNVERIFIED' });
    err('JACO Workplace unavailable; continuing local work without synchronized coordination. See .jaco/workplace.log.');
  }
  let connectedEnv = liteLocalConnectionEnv({ childEnv, workplacePort, workplaceReady });
  let browser=null;
  const browserModule=path.join(installDir,'dist','lite-browser-supervisor.mjs');
  if(fsImpl.existsSync(browserModule)){
    try{
      const {prepareLiteBrowser}=await import(pathToFileURL(browserModule).href);
      browser=await prepareLiteBrowser({env:connectedEnv,installDir,project,corePort:port,workplacePort,workplaceReady,findPort:deps.findPort??findFreePort,portFree:isPortFree,platform:deps.platform??process.platform,fsImpl});
      connectedEnv=browser.env;
      if(browser.reason)lifecycle({component:'browser',event:'UNAVAILABLE',reason:browser.reason});
    }catch{lifecycle({component:'browser',event:'UNAVAILABLE',reason:'BROWSER_STARTUP_CONFIGURATION_FAILED'});}
  }
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
  let agentRestartTimer = null;
  let agentRestartAttempts = 0;
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
  const stop = () => { shutdownRequested = true; browser?.stop(); clearTimeout(agentRestartTimer); for (const p of [agent, child, workplace]) { try { p?.kill(); } catch { /* already gone */ } } };
  if (!deps.noSignals) {
    process.removeListener('SIGINT', stopStartingWorkplace); process.removeListener('SIGTERM', stopStartingWorkplace);
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  }

  const url = `http://${HOST}:${port}`;
  const up = await waitForHealth(url, { alive: () => exited === null, fetchImpl: deps.fetchImpl, timeoutMs: deps.healthTimeoutMs });
  if (!up || exited !== null || shutdownRequested) {
    const exitBeforeStop = exited;
    const intentional = shutdownRequested;
    stop();
    err(exited !== null ? `jaco-lite: the server stopped right after starting (exit code ${exited}).` : 'jaco-lite: the server did not answer within 90 seconds.');
    if (tail.trim()) err(`--- last server output (full log: ${logFile}) ---\n${tail.trim()}`);
    log?.end();
    if (!deps.noSignals) { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
    return intentional ? 0 : exitBeforeStop === null || exitBeforeStop === 0 ? 5 : exitBeforeStop;
  }
  const ui = await verifyLiteUi(url, release, { fetchImpl: deps.fetchImpl });
  if (!ui.ok || exited !== null || shutdownRequested) {
    const intentional = shutdownRequested, failureCode = exited;
    lifecycle({ component:'ide', event:'GUI_UNAVAILABLE', reason:ui.reason || 'CORE_EXITED' });
    stop();
    log?.end();
    if (!deps.noSignals) { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
    err('jaco-lite: GUI delivery not verified: ' + (ui.reason || 'CORE_EXITED'));
    return intentional ? 0 : failureCode && failureCode !== 0 ? failureCode : 5;
  }
  out('GUI HTTP_READY (rendering on the device is not yet verified)');
  lifecycle({ component: 'ide', event: 'READY', pid: child.pid ?? null, port, agentEnabled: args.agent, workplacePid: workplace.pid ?? null });
  const home = deps.homedir ?? os.homedir();
  writeRuntimeRecord({ home, url, port, project, installDir, sourceCommit: release.sourceCommit }, fsImpl);
  out('JACO Lite is running.');
  out(`  IDE:      ${url}`);
  out(`  Project:  ${project}`);
  const agentCmd = args.agent ? agentCommand(installDir, deps.execPath, fsImpl) : null;
  const launchAgent = () => {
    if (!agentCmd || shutdownRequested || exited !== null || agent) return;
    const startedAt = Date.now();
    fsImpl.mkdirSync(path.join(project, '.jaco', 'nova-state'), { recursive: true });
    const agentLog = fsImpl.createWriteStream ? fsImpl.createWriteStream(path.join(project, '.jaco', 'nova.log'), { flags: 'a' }) : null;
    agent = (deps.spawnImpl ?? spawn)(agentCmd.cmd, agentCmd.args, {
      cwd: path.join(project, '.jaco'),
      env: agentEnv({ env: connectedEnv, installDir, project, url, token }),
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    const current = agent;
    const restart = () => {
      if (agent !== current) return;
      agent = null;
      if (shutdownRequested || exited !== null) return;
      if (Date.now() - startedAt >= 300_000) agentRestartAttempts = 0;
      if (agentRestartAttempts >= 3) {
        lifecycle({ component:'agent', event:'RESTART_EXHAUSTED' });
        return;
      }
      const delay = 1000 * 2 ** agentRestartAttempts++;
      lifecycle({ component:'agent', event:'RESTART_SCHEDULED', delayMs:delay, attempt:agentRestartAttempts });
      agentRestartTimer = setTimeout(() => { agentRestartTimer = null; launchAgent(); }, delay);
      agentRestartTimer.unref();
    };
    current.stdout?.on('data', c => agentLog?.write(c));
    current.stderr?.on('data', c => agentLog?.write(c));
    current.once('exit', (code, signal) => {
      const exitCode = processStopped('agent', current, code, signal);
      agentLog?.write(`\n[nova exited ${exitCode}${signal ? ' signal ' + signal : ''}]\n`);
      agentLog?.end();
      restart();
    });
    current.once('error', error => {
      lifecycle({ component:'agent', event:'SPAWN_ERROR', reason:error.code || 'UNKNOWN' });
      agentLog?.write(`\n[nova failed to start: ${error.message}]\n`);
      // Spawn failure has no child PID. Other process errors must wait for exit.
      if (!current.pid) { agentLog?.end(); restart(); }
    });
  };
  launchAgent();
  if(browser&&!browser.reason){
    out('  CDP:      starting independently of Core');
    void browser.start({token,execPath:deps.execPath??process.execPath,spawnImpl:deps.spawnImpl??spawn,fetchImpl:deps.fetchImpl??fetch,report:event=>{lifecycle(event);if(event.component==='browser')out('  CDP:      '+event.event+(event.reason?' '+event.reason:''));}}).catch(()=>lifecycle({component:'browser',event:'DEGRADED',reason:'BROWSER_START_FAILED'}));
  }else if(browser?.reason)out('  CDP:      '+browser.reason);
  out(`  Agent:    ${agentCmd ? 'Nova launch requested; waiting for executor observation (log: .jaco/nova.log)' : args.agent ? 'not part of this installation' : 'off (--no-agent)'}`);
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
  removeRuntimeRecord({ home }, fsImpl);
  const intentionalStop = shutdownRequested;
  shutdownRequested = true;
  browser?.stop();
  clearTimeout(agentRestartTimer);
  try { agent?.kill(); } catch { /* already gone */ }
  try { workplace?.kill(); } catch { /* already gone */ }
  log?.end();
  if (!deps.noSignals) { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
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
