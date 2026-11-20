// Explicit, local operator control for the existing Workplace communication relay.
// No credentials, Core auth changes, mission authority or separate Aura process.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const CHATGPT_RELAY_CONTROL_SCHEMA = 'jaco.chatgpt-relay-control/v1';

export function relayControlPath(root) {
  return path.join(path.resolve(root), '.jaco', 'workplace', 'chatgpt-relay-control.json');
}

export function readRelayControl(root) {
  const file = relayControlPath(root);
  let value;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return { configured: true, enabled: false, error: 'INVALID_CONTROL_FILE' };
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return { configured: false, enabled: false };
    return { configured: true, enabled: false, error: 'INVALID_CONTROL_FILE' };
  }
  if (value?.schema !== CHATGPT_RELAY_CONTROL_SCHEMA ||
      typeof value.enabled !== 'boolean' ||
      value.transport !== (value.enabled ? 'git-ref' : 'off')) {
    return { configured: true, enabled: false, error: 'INVALID_CONTROL_SCHEMA' };
  }
  return { configured: true, enabled: value.enabled };
}

export function relayEnvironment(root, env = process.env) {
  const control = readRelayControl(root);
  // Existing explicit environment settings remain valid until the operator
  // uses the local CLI. An invalid control file fails closed.
  if (!control.configured) return env;
  return { ...env, JACO_CHATGPT_WORKPLACE_TRANSPORT: control.enabled ? 'git-ref' : 'off' };
}

export function writeRelayControl(root, enabled) {
  if (typeof enabled !== 'boolean') throw Error('CHATGPT_RELAY_MODE_INVALID');
  const file = relayControlPath(root);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    if (fs.lstatSync(file).isSymbolicLink()) throw Error('CHATGPT_RELAY_CONTROL_SYMLINK_REFUSED');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const payload = {
    schema: CHATGPT_RELAY_CONTROL_SCHEMA,
    enabled,
    transport: enabled ? 'git-ref' : 'off',
  };
  const temp = file + '.' + process.pid + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(payload) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, file);
    try { fs.chmodSync(file, 0o600); } catch {}
  } finally {
    try { fs.unlinkSync(temp); } catch {}
  }
  return payload;
}
