// Where a local JACO service really listens, for processes the launcher did not start (the CLI, MCP
// bridges started by an external client). The launcher writes .jaco/state/resolved-ports.json when a
// foreign program held a default port; without reading it these consumers talked to that program.
// Dependency-free on purpose: MCP launchers import it before any package is installed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
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
