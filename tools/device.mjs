// Joined devices (runtime src/server/connected/deviceAccess.mjs), run on the hub:
//   node tools/device.mjs invite <name>   one-time pairing code (10 min) for a device; inviting again re-pairs
//   node tools/device.mjs list
//   node tools/device.mjs revoke <name>
// The same is available in the IDE under Devices. The device runs tools/join-hub.mjs with the code and
// receives its own key; the key is never shown on the hub.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)
  .map(line => line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/)).filter(Boolean).map(m => [m[1], m[2]]));
const runtime = process.env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000';
const token = env.JACO_GATEWAY_TOKEN || env.GATEWAY_TOKEN || '';
const hub = String(env.JACO_GATEWAY_PUBLIC_URL || '').replace(/\/+$/, '');

async function call(method, p, body) {
  const r = await fetch(`${runtime}/api/connected/devices${p}`, {
    method, headers: { 'content-type': 'application/json', 'x-gateway-token': token },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.success !== true) throw new Error(typeof data.error === 'string' ? data.error : `HTTP_${r.status}`);
  return data;
}

const [command, name] = process.argv.slice(2);
try {
  if (command === 'invite' && name) {
    const { invite } = await call('POST', '/invite', { name });
    console.log(`Pairing code for ${invite.executor}: ${invite.code} (one use, valid until ${new Date(invite.expiresAt).toLocaleTimeString('sv-SE')})`);
    console.log('\nOn the device, in its JACO checkout (after git pull):\n');
    console.log(`  node tools/join-hub.mjs ${hub || '<public gateway URL>'} ${invite.code}\n`);
    console.log(`Then start Nova there with npm start. Revoke later with: node tools/device.mjs revoke ${invite.name}`);
  } else if (command === 'list') {
    for (const d of (await call('GET', '')).devices) {
      const status = d.revokedAt ? `revoked ${d.revokedAt}` : d.online ? 'online' : 'active';
      console.log(`${d.name}\t${d.executor}\t${status}\tlast seen ${d.lastSeenAt || 'never'}`);
    }
  } else if (command === 'revoke' && name) {
    console.log(`Revoked ${(await call('DELETE', `/${encodeURIComponent(name)}`)).device.name}.`);
  } else {
    console.log('usage: node tools/device.mjs invite <name> | list | revoke <name>   (name: lowercase letters, digits, -)');
    process.exitCode = 1;
  }
} catch (e) {
  console.error(`Failed: ${e.message}`);
  process.exitCode = 1;
}
