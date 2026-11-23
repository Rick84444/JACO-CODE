// One location for legacy Aura state. Installed binaries are immutable under Program Files;
// ledgers, memory, chat history and generated skills belong to the operator's workspace.
// The canonical Continuum store remains authoritative; this only preserves legacy files.
import path from 'node:path';

export function auraLegacyStateRoot(env = process.env, cwd = process.cwd()) {
  const configured = String(env.JACO_WORKSPACE_ROOT || env.JACO_DATA_DIR || '').trim();
  return path.resolve(configured || cwd);
}

export function auraLegacyStatePath(...segments) {
  return path.join(auraLegacyStateRoot(), '.jaco', ...segments);
}
