// Where a local JACO service really listens, for processes the launcher did not start (the CLI, MCP
// bridges started by an external client). The launcher writes .jaco/state/resolved-ports.json when a
// foreign program held a default port; without reading it these consumers talked to that program.
// Dependency-free on purpose: MCP launchers import it before any package is installed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The production server bundles this module as CommonJS, where import.meta.url is empty.
const moduleFile = () => {
  if (typeof __filename === 'string') return __filename;
  try { return fileURLToPath(import.meta.url); } catch { return null; }
};
const ROOT = (() => { const file = moduleFile(); return file ? path.resolve(path.dirname(file), '../..') : process.cwd(); })();
const DEFAULTS = { runtime: ['PORT', 3000], workplace: ['JACO_WORKPLACE_PORT', 2995], seer: ['SEER_PORT', 2997], remote: ['JACO_REMOTE_BRIDGE_PORT', 2994] };

function dataRoots(env) {
  const roots = [env.JACO_DATA_DIR, ROOT];
  if (env.LOCALAPPDATA) roots.push(path.join(env.LOCALAPPDATA, 'JACO'));
  return [...new Set(roots.filter(Boolean).map(r => path.resolve(r)))];
}

export function resolvedLocalPort(service, env = process.env, { roots = dataRoots(env), read = file => fs.readFileSync(file, 'utf8') } = {}) {
  const [name, fallback] = DEFAULTS[service] || [];
  if (!name) throw new Error(`UNKNOWN_SERVICE:${service}`);
  const requested = Number(env[name] || fallback);
  for (const root of roots) {
    try {
      const data = JSON.parse(read(path.join(root, '.jaco', 'state', 'resolved-ports.json')));
      const entry = data?.schema === 'jaco.resolved-ports/v1' ? data.ports?.[service] : null;
      if (entry && entry.requested === requested && Number.isInteger(entry.port)) return entry.port;
    } catch {}
  }
  return requested;
}

// Explicit URLs win; otherwise the resolved port, otherwise the default.
export function localServiceUrl(service, env = process.env, options) {
  const explicit = { runtime: env.JACO_RUNTIME_URL || env.JACO_BASE_URL, workplace: env.JACO_WORKPLACE_URL, seer: env.SEER_URL, remote: env.JACO_REMOTE_BRIDGE_URL }[service];
  if (explicit && String(explicit).trim()) return String(explicit).trim().replace(/\/+$/, '');
  return `http://127.0.0.1:${resolvedLocalPort(service, env, options)}`;
}

function readEntry(service, env, { roots = dataRoots(env), read = file => fs.readFileSync(file, 'utf8') } = {}) {
  for (const root of roots) {
    try {
      const data = JSON.parse(read(path.join(root, '.jaco', 'state', 'resolved-ports.json')));
      const entry = data?.schema === 'jaco.resolved-ports/v1' ? data.ports?.[service] : null;
      if (entry && Number.isInteger(entry.requested) && Number.isInteger(entry.port)) return entry;
    } catch {}
  }
  return null;
}

// Long-running processes (Workplace, Aura's executor, bridges) receive the runtime URL once, at spawn.
// When the launcher later moves Core because another program took its port, they kept calling the old
// address and every mission tick failed with "fetch failed". This follower re-reads the resolution and
// updates the process environment in place; code that reads process.env per call follows immediately.
// Only a loopback URL that points at the requested or a previously resolved port is rewritten, so an
// address the operator pinned elsewhere is never touched.
export function followResolvedRuntime(env = process.env, { intervalMs = 5000, onChange = () => {}, ...io } = {}) {
  const seen = new Set();
  const check = () => {
    const entry = readEntry('runtime', env, io);
    if (!entry) return false;
    seen.add(entry.requested);
    let current;
    try { current = new URL(env.JACO_RUNTIME_URL || `http://127.0.0.1:${env.PORT || 3000}`); } catch { return false; }
    if (!['127.0.0.1', 'localhost'].includes(current.hostname)) return false;
    const port = Number(current.port || 80);
    if (port === entry.port) { seen.add(port); return false; }
    if (!seen.has(port)) return false;
    const url = `http://127.0.0.1:${entry.port}`;
    env.JACO_RUNTIME_URL = url;
    env.JACO_BASE_URL = url;
    env.PORT = String(entry.port);
    seen.add(entry.port);
    try { onChange(url); } catch {}
    return true;
  };
  check();
  const timer = intervalMs > 0 ? setInterval(check, intervalMs) : null;
  timer?.unref?.();
  return { check, stop: () => timer && clearInterval(timer) };
}
