// Aura's self-repair of the local JACO stack. It reruns the canonical starter (agents/lib/local-stack.mjs), which
// probes every service and relaunches only what is down: the dedicated Chrome debug browser, the CDP bridge, the
// Nova bridge, the gateway and the other helpers. Services that answer READY are left alone, a foreign listener is
// never stopped, the emergency stop and the startup lock still apply. No mission state, file or remote is touched.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// The starter reads its configuration and secrets from the data root's .env itself, exactly as the Windows starter
// does. It gets only what the operating system needs to find programs and the data root, never this process's env.
const PASSED_ENV = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|SYSTEMDRIVE|USERPROFILE|HOMEDRIVE|HOMEPATH|HOME|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|TEMP|TMP|USERNAME|JACO_DATA_DIR|JACO_RUNTIME_DIR)$/i;
export const starterEnvironment = (env = process.env) => Object.fromEntries(Object.entries(env).filter(([key, value]) => PASSED_ENV.test(key) && typeof value === 'string'));

export const STACK_REPAIR_COOLDOWN_MS = 60_000;

export function createStackRepair({ env = process.env, run = execFile, now = Date.now, execPath = process.execPath, timeoutMs = 180_000 } = {}) {
  let inFlight = null, lastStartedAt = 0;
  return async function repairStack() {
    if (String(env.PREFIX || '').endsWith('/com.termux/files/usr')) return { repaired: false, reason: 'TERMUX_USES_RUNIT', detail: 'Termux services are supervised by runit; use termux_services.' };
    const root = env.JACO_INSTALL_ROOT ? path.resolve(env.JACO_INSTALL_ROOT) : null;
    const script = root && path.join(root, 'agents', 'lib', 'local-stack.mjs');
    if (!script || !fs.existsSync(script)) return { repaired: false, reason: 'STARTER_NOT_FOUND' };
    if (inFlight) return inFlight;
    if (now() - lastStartedAt < STACK_REPAIR_COOLDOWN_MS) return { repaired: false, reason: 'REPAIR_COOLDOWN', retryAfterMs: STACK_REPAIR_COOLDOWN_MS - (now() - lastStartedAt) };
    lastStartedAt = now();
    inFlight = new Promise(resolve => {
      run(execPath, [script], { cwd: root, env: starterEnvironment(env), timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        let result = null;
        // Progress lines ("STARTED cdp PID=…") come first; the starter prints its receipt last, as one JSON document.
        const text = String(stdout || '');
        const start = text.startsWith('{') ? 0 : text.lastIndexOf('\n{') + 1;
        try { if (start >= 0) result = JSON.parse(text.slice(start)); } catch {}
        if (!result) return resolve({ repaired: false, reason: 'STARTER_FAILED', detail: String(stderr || error?.message || '').trim().slice(-400) });
        resolve({
          repaired: result.state === 'READY', state: result.state, chrome: result.chrome || null, browserAttachment: result.browserAttachment || null,
          services: (result.services || []).map(s => ({ id: s.id, state: s.state })),
          warnings: (result.warnings || []).slice(0, 20), error: result.error || null,
        });
      });
    }).finally(() => { inFlight = null; });
    return inFlight;
  };
}
