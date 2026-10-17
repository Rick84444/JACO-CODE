// A runtime is a directory whose server.ts serves the identity readiness probes. The repository root
// also has a legacy server.ts without it; picking that one left startup waiting on a route that never exists.
// This module stays free of third-party imports so setup can resolve the runtime before any install has run.
import fs from 'node:fs';
import path from 'node:path';

export const isRuntime = dir => fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'server.ts'))
  && fs.readFileSync(path.join(dir, 'server.ts'), 'utf8').includes('/api/runtime/identity');

export function runtimeDirectory(root, configured) {
  if (configured) return path.resolve(root, configured);
  if (isRuntime(root)) return root;
  const candidates = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory())
    .map(e => path.join(root, e.name)).filter(isRuntime);
  if (candidates.length !== 1) throw new Error(candidates.length ? 'RUNTIME_DIR_AMBIGUOUS:set JACO_RUNTIME_DIR' : 'RUNTIME_DIR_MISSING:set JACO_RUNTIME_DIR');
  return candidates[0];
}
