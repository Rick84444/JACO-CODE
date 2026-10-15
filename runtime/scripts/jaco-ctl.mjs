#!/usr/bin/env node
/**
 * JACO Continuum operations control (jaco-ctl).
 *
 * Ett enda kommando som äger start/stopp/status för Continuum-processerna,
 * så att ingen behöver köra råa node/curl-kommandon för hand. Håller reda
 * på PID:er i .jaco/run/*.pid och adopterar redan körande processer på
 * kända portar istället för att duplicera dem.
 *
 * Kommandon:
 *   node scripts/jaco-ctl.mjs up [--with-peer]
 *   node scripts/jaco-ctl.mjs down [--with-peer] [--all]
 *   node scripts/jaco-ctl.mjs status
 *   node scripts/jaco-ctl.mjs logs <service> [lines]
 *
 * "core"      = continuum (3020) + edge (PODAR-bryggan)
 * "with-peer" = lägger till peerB-continuum (3021) + två A2A-adaptrar
 *               (2998->3020, 2999->3021) för A2A-utveckling/test.
 *               Detta är en lokal stand-in-motpart, inte en extern peer.
 */

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_DIR = path.join(ROOT, '.jaco', 'run');
const LOG_DIR = path.join(ROOT, 'logs');
for (const d of [RUN_DIR, LOG_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

const isWin = process.platform === 'win32';

/**
 * Minimal .env-läsare. Ingen av de körda apparna (server.ts,
 * standalone-server.mjs) anropar faktiskt dotenv.config() själva - paketet
 * ligger bara i package.json oanvänt. Så jaco-ctl läser filen här och
 * skickar med som env till varje spawnad process, istället för att kräva
 * en kodändring i varje entry point.
 */
function loadDotEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}
const DOTENV = loadDotEnv();

function service(name, { cmd, args, port, healthPath = '/health', env = {}, cwd = ROOT, group, matchCmd = null, shell = false }) {
  return { name, cmd, args, port, healthPath, env, cwd, group, matchCmd, shell, pidFile: path.join(RUN_DIR, `${name}.pid`), logFile: path.join(LOG_DIR, `${name}.log`) };
}

const SERVICES = [
  service('continuum', {
    cmd: 'node', args: ['src/server/continuum/standalone-server.mjs'], port: 3020, group: 'core',
    // Local peers live on loopback, which outbound A2A blocks unless the exact origin is allowlisted.
    env: { JACO_CONTINUUM_PORT: '3020', JACO_A2A_ALLOWED_PRIVATE_ORIGINS: 'http://127.0.0.1:2999' },
  }),
  service('edge', {
    cmd: 'node', args: ['--experimental-strip-types', 'scripts/jaco-runtime-daemon.ts'], port: null, group: 'core',
    env: { JACO_CONTINUUM_URL: 'http://127.0.0.1:3020', JACO_INTERVAL_MS: '5000' },
    matchCmd: 'jaco-runtime-daemon.ts',
  }),
  service('peerB-continuum', {
    cmd: 'node', args: ['src/server/continuum/standalone-server.mjs'], port: 3021, group: 'peer',
    env: { JACO_CONTINUUM_PORT: '3021', JACO_CONTINUUM_WORKSPACE: path.join(ROOT, '.jaco-peer-b'), JACO_A2A_ALLOWED_PRIVATE_ORIGINS: 'http://127.0.0.1:2998' },
  }),
  service('a2a-peerA', {
    cmd: 'node', args: ['gateway/src/a2a-server.mjs'], port: 2998, group: 'peer',
    env: { JACO_A2A_PORT: '2998', JACO_BASE_URL: 'http://127.0.0.1:3020', JACO_A2A_PUBLIC_URL: process.env.JACO_A2A_PEERA_PUBLIC_URL || 'http://127.0.0.1:2998', JACO_A2A_BEARER: DOTENV.A2A_BEARER_TOKEN || '' },
  }),
  service('a2a-peerB', {
    cmd: 'node', args: ['gateway/src/a2a-server.mjs'], port: 2999, group: 'peer',
    env: { JACO_A2A_PORT: '2999', JACO_BASE_URL: 'http://127.0.0.1:3021', JACO_A2A_PUBLIC_URL: 'http://127.0.0.1:2999', JACO_A2A_BEARER: DOTENV.A2A_BEARER_TOKEN || '' },
  }),
  service('trader-A', {
    cmd: 'node', args: ['scripts/continuum/agent-trader.mjs', 'peerA'], port: null, group: 'trade',
    env: { SELF_NAME: 'peerA', SELF_CONTINUUM_URL: 'http://127.0.0.1:3020', PEER_A2A_URL: 'http://127.0.0.1:2999', PEER_CONTINUUM_URL: 'http://127.0.0.1:3021', TRADE_INTERVAL_MS: '90000', TRADE_OUTCOME_TIMEOUT_MS: '120000' },
    matchCmd: 'agent-trader.mjs peerA',
  }),
  service('substrate', {
    cmd: 'npx', args: ['tsx', 'server.ts'], port: 3000, group: 'browser', healthPath: '/api/runtime/identity', shell: isWin,
    // Without this, Vite's file watcher crawls the whole repo tree (including the
    // nested duplicate release dir and .jaco state) and can starve the HTTP
    // listener so it accepts connections but never responds. Same fix as the
    // root Vite dev server.
    env: { JACO_WORKSPACE_ROOT: path.join(ROOT, '.jaco-substrate'), DISABLE_HMR: 'true' },
    matchCmd: 'tsx server.ts',
  }),
  service('trader-B', {
    cmd: 'node', args: ['scripts/continuum/agent-trader.mjs', 'peerB'], port: null, group: 'trade',
    env: { SELF_NAME: 'peerB', SELF_CONTINUUM_URL: 'http://127.0.0.1:3021', PEER_A2A_URL: 'http://127.0.0.1:2998', PEER_CONTINUUM_URL: 'http://127.0.0.1:3020', TRADE_INTERVAL_MS: '90000', TRADE_OUTCOME_TIMEOUT_MS: '120000' },
    matchCmd: 'agent-trader.mjs peerB',
  }),
];

function log(msg) { console.log(msg); }

function readPidFile(svc) {
  if (!fs.existsSync(svc.pidFile)) return null;
  try { return JSON.parse(fs.readFileSync(svc.pidFile, 'utf8')); } catch { return null; }
}
function writePidFile(svc, data) { fs.writeFileSync(svc.pidFile, JSON.stringify(data, null, 2), 'utf8'); }
function removePidFile(svc) { if (fs.existsSync(svc.pidFile)) fs.unlinkSync(svc.pidFile); }

function isPidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Hitta PID som lyssnar på en port via netstat (Windows) / lsof-liknande på andra plattformar. */
function findPidByPort(port) {
  try {
    if (isWin) {
      const out = execSync(`netstat -ano`, { encoding: 'utf8' });
      const line = out.split('\n').find(l => l.includes(`:${port} `) && l.includes('LISTENING'));
      if (!line) return null;
      const parts = line.trim().split(/\s+/);
      const pid = Number(parts[parts.length - 1]);
      return Number.isInteger(pid) ? pid : null;
    } else {
      const out = execSync(`lsof -t -i:${port} -sTCP:LISTEN`, { encoding: 'utf8' });
      const pid = Number(out.trim().split('\n')[0]);
      return Number.isInteger(pid) ? pid : null;
    }
  } catch { return null; }
}

/** Hitta PID via kommandoradsmatchning - fallback för tjänster utan port (t.ex. edge-daemonen). */
function findPidByCmd(matchCmd) {
  try {
    if (isWin) {
      const out = execSync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${matchCmd}*' -and $_.Name -eq 'node.exe' } | Select-Object -First 1 -ExpandProperty ProcessId"`,
        { encoding: 'utf8' }
      );
      const pid = Number(out.trim());
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    } else {
      const out = execSync(`pgrep -f "${matchCmd}"`, { encoding: 'utf8' });
      const pid = Number(out.trim().split('\n')[0]);
      return Number.isInteger(pid) ? pid : null;
    }
  } catch { return null; }
}

function findExistingPid(svc) {
  if (svc.port) {
    const byPort = findPidByPort(svc.port);
    if (byPort) return byPort;
  }
  if (svc.matchCmd) return findPidByCmd(svc.matchCmd);
  return null;
}

async function checkHealth(svc) {
  if (!svc.port) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${svc.port}${svc.healthPath}`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { ok: false, code: res.status };
    const body = await res.json().catch(() => ({}));
    return { ok: true, body };
  } catch (e) { return { ok: false, error: e.message }; }
}

function killPid(pid) {
  if (isWin) {
    try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }); return true; } catch { return false; }
  }
  try { process.kill(pid, 'SIGTERM'); return true; } catch { return false; }
}

async function startService(svc) {
  const existingHealth = svc.port ? await checkHealth(svc) : null;
  const existingPid = findExistingPid(svc);

  if ((existingHealth && existingHealth.ok) || (existingPid && isPidAlive(existingPid))) {
    const pid = existingPid || readPidFile(svc)?.pid || null;
    writePidFile(svc, { pid, port: svc.port, adopted: true, startedAt: new Date().toISOString() });
    log(`[SKIP] ${svc.name} kör redan${pid ? ` (PID ${pid})` : ''}${svc.port ? ` på :${svc.port}` : ''} - adopterad.`);
    return;
  }

  const stored = readPidFile(svc);
  if (stored?.pid && isPidAlive(stored.pid)) {
    log(`[SKIP] ${svc.name} kör redan (PID ${stored.pid}, ingen port att verifiera mot).`);
    return;
  }

  const logFd = fs.openSync(svc.logFile, 'a');
  const child = spawn(svc.cmd, svc.args, {
    cwd: svc.cwd,
    env: { ...DOTENV, ...process.env, ...svc.env },
    detached: true,
    windowsHide: true, // annars flashar ett synligt konsolfönster på Windows för varje spawn
    shell: svc.shell, // .cmd-shims (npx) kraschar med EINVAL under windowsHide utan shell:true på Windows
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  writePidFile(svc, { pid: child.pid, port: svc.port, adopted: false, startedAt: new Date().toISOString() });
  log(`[START] ${svc.name} PID ${child.pid}${svc.port ? ` :${svc.port}` : ''} -> ${path.relative(ROOT, svc.logFile)}`);
}

async function stopService(svc) {
  const stored = readPidFile(svc);
  const pid = stored?.pid || findExistingPid(svc);
  if (!pid || !isPidAlive(pid)) {
    log(`[SKIP] ${svc.name} kör inte.`);
    removePidFile(svc);
    return;
  }
  const ok = killPid(pid);
  log(ok ? `[STOP] ${svc.name} (PID ${pid}) stoppad.` : `[FAIL] kunde inte stoppa ${svc.name} (PID ${pid}).`);
  removePidFile(svc);
}

async function waitForHealth(svc, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const h = await checkHealth(svc);
    if (h?.ok) return true;
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

async function statusAll(services) {
  for (const svc of services) {
    const stored = readPidFile(svc);
    const pid = stored?.pid || findExistingPid(svc);
    const alive = isPidAlive(pid);
    const health = svc.port ? await checkHealth(svc) : null;
    const version = health?.ok ? (health.body?.version || health.body?.releaseId || '') : '';
    const line = [
      alive ? 'UP  ' : 'DOWN',
      svc.name.padEnd(16),
      svc.port ? `:${svc.port}`.padEnd(6) : '      ',
      pid ? `PID ${pid}` : '',
      health ? (health.ok ? `health=OK ${version}` : `health=FAIL(${health.error || health.code})`) : '',
    ].join('  ');
    log(line);
  }
}

function tailLog(name, lines = 40) {
  const svc = SERVICES.find(s => s.name === name);
  if (!svc) { log(`Okänd tjänst: ${name}. Kända: ${SERVICES.map(s => s.name).join(', ')}`); return; }
  if (!fs.existsSync(svc.logFile)) { log(`Ingen logg än: ${svc.logFile}`); return; }
  const content = fs.readFileSync(svc.logFile, 'utf8').split('\n');
  console.log(content.slice(-lines).join('\n'));
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const withPeer = rest.includes('--with-peer');
  const withTrade = rest.includes('--with-trade');
  const withBrowser = rest.includes('--with-browser');
  const all = rest.includes('--all');
  const groups = all ? ['core', 'peer', 'trade', 'browser']
    : [...new Set(['core', ...(withPeer || withTrade ? ['peer'] : []), ...(withTrade ? ['trade'] : []), ...(withBrowser ? ['browser'] : [])])];
  const active = SERVICES.filter(s => groups.includes(s.group));

  if (cmd === 'up') {
    for (const svc of active) await startService(svc);
    for (const svc of active) if (svc.port) await waitForHealth(svc, 10_000);
    log('\n--- status ---');
    await statusAll(active);
  } else if (cmd === 'down') {
    const target = all ? SERVICES : active;
    for (const svc of [...target].reverse()) await stopService(svc);
  } else if (cmd === 'status') {
    await statusAll(SERVICES);
  } else if (cmd === 'logs') {
    const name = rest.find(a => !a.startsWith('--'));
    const linesArg = rest.find(a => /^\d+$/.test(a));
    tailLog(name, linesArg ? Number(linesArg) : 40);
  } else {
    console.log(`Användning:
  node scripts/jaco-ctl.mjs up [--with-peer|--with-trade]
  node scripts/jaco-ctl.mjs down [--with-peer|--with-trade|--all]
  node scripts/jaco-ctl.mjs status
  node scripts/jaco-ctl.mjs logs <service> [lines]

Tjänster: ${SERVICES.map(s => `${s.name} (${s.group})`).join(', ')}`);
    process.exit(1);
  }
}

main().catch(e => { console.error('[FAIL]', e.message); process.exit(1); });
