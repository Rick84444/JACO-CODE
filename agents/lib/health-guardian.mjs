// JACO installed Windows health guardian. One process, no new agent/runtime/permission.
// Works independently of the browser and only reuses the canonical local-stack launcher.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROOT, configuration, inspectStatus, activate, processBirth, restartOwnedUnhealthyRuntime } from './local-stack.mjs';

const INTERVAL_MS = 30_000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
const critical = new Set(['runtime', 'workplace', 'nova-supervisor', 'nova-session']);
export function unhealthyServices(snapshot) {
  const services = Array.isArray(snapshot?.services) ? snapshot.services : [];
  const criticalObserved = services.filter(s => critical.has(s.id));
  return criticalObserved.length ? criticalObserved.filter(s => s.state !== 'READY').map(s => s.id) : ['NO_CRITICAL_OBSERVATIONS'];
}
export function guardianBackoffMs(failures) {
  return Math.min(10 * 60_000, INTERVAL_MS * 2 ** Math.min(Math.max(0, failures - 1), 5));
}

export async function guardianTick(c, state, {
  inspect = inspectStatus,
  activateStack = activate,
  restartCore = restartOwnedUnhealthyRuntime,
  now = Date.now(),
} = {}) {
  const observed = await inspect(c);
  const unhealthy = unhealthyServices(observed);
  if (!unhealthy.length) {
    state.unhealthySince = null;
    state.failures = 0;
    state.nextAttemptAt = 0;
    return { kind: 'HEALTHY', unhealthy };
  }
  state.unhealthySince ??= now;
  if (now < (state.nextAttemptAt || 0)) return { kind: 'COOLDOWN', unhealthy };
  // The owner is reverified in local-stack. Never terminate Workplace/Nova: it
  // could orphan an in-flight executor and create duplicate external effects.
  let recycling = null;
  if (unhealthy.includes('runtime') && now - state.unhealthySince >= 300_000) {
    recycling = await restartCore(c, { unhealthyForMs: now - state.unhealthySince });
  }
  state.failures = (state.failures || 0) + 1;
  state.nextAttemptAt = now + guardianBackoffMs(state.failures);
  try {
    const result = await activateStack(c, { open: false });
    return { kind: result.state === 'READY' ? 'STARTED' : 'DEGRADED', unhealthy, recycling };
  } catch (cause) {
    return { kind: 'RETRY_SCHEDULED', unhealthy, recycling, error: String(cause?.message || cause).slice(0, 240) };
  }
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e?.code !== 'ESRCH'; }
}

function acquire(root) {
  const file = path.join(root, 'logs', 'startup', 'health-guardian.json');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const record = { pid: process.pid, birth: processBirth(process.pid) };
  if (!record.birth) throw Error('GUARDIAN_BIRTH_UNVERIFIED');
  try { fs.writeFileSync(file, JSON.stringify(record), { flag: 'wx', mode: 0o600 }); return { file, record }; }
  catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    let previous;
    try { previous = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw Error('GUARDIAN_LOCK_INVALID'); }
    if (!Number.isInteger(previous.pid) || !previous.birth) throw Error('GUARDIAN_LOCK_INVALID');
    const live = alive(previous.pid);
    if (live) {
      const actualBirth = processBirth(previous.pid);
      if (!actualBirth) throw Error('GUARDIAN_LOCK_OWNER_UNVERIFIED');
      if (actualBirth === previous.birth) return null;
      // Windows reused the PID for another process: the prior guardian is gone.
      // Never kill that unrelated process; only reclaim our stale lock file.
    }
    fs.unlinkSync(file);
    try { fs.writeFileSync(file, JSON.stringify(record), { flag: 'wx', mode: 0o600 }); return { file, record }; }
    catch (again) { if (again?.code === 'EEXIST') return null; throw again; }
  }
}

export async function main() {
  if (process.platform !== 'win32' || process.env.JACO_INSTALLED !== '1') throw Error('INSTALLED_WINDOWS_ONLY');
  const c = configuration(ROOT, process.env);
  if (c.dataRoot === c.root) throw Error('GUARDIAN_DATA_ROOT_REQUIRED');
  const lock = acquire(c.dataRoot);
  if (!lock) return;
  const logPath = path.join(c.dataRoot, 'logs/startup/guardian.log');
  const log = event => {
    try { fs.appendFileSync(logPath, JSON.stringify({ at: nowIso(), ...event }) + '\n'); } catch {}
  };
  const state = { unhealthySince: null, failures: 0, nextAttemptAt: 0 };
  try {
    // The launcher already performed the first activation; do not race its lock.
    while (fs.existsSync(path.join(c.runtime, 'dist/server.cjs')) &&
           !fs.existsSync(path.join(c.dataRoot, '.jaco-emergency-stop.json'))) {
      await sleep(INTERVAL_MS);
      const result = await guardianTick(c, state).catch(error => ({ kind: 'ERROR', error: String(error?.message || error).slice(0, 240) }));
      if (result.kind !== 'HEALTHY' && result.kind !== 'COOLDOWN') log(result);
    }
  } finally {
    try {
      const owner = JSON.parse(fs.readFileSync(lock.file, 'utf8'));
      if (owner.pid === lock.record.pid && owner.birth === lock.record.birth) fs.rmSync(lock.file, { force: true });
    } catch {}
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error('JACO_GUARDIAN_FAILED:' + String(error?.message || error).slice(0, 200)); process.exitCode = 1; });
}
