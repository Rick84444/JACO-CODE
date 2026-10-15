// Joins this computer or phone to a JACO hub (runtime src/server/connected/deviceAccess.mjs).
//   node tools/join-hub.mjs <hub-url> <pairing-code>
// The pairing code comes from the hub's IDE (Devices, "Lägg till enhet") or `node tools/device.mjs
// invite <name>` on the hub. It works once and for 10 minutes. This command exchanges it for the
// device's own key and writes JACO_HUB_URL, JACO_DEVICE_KEY and JACO_NOVA_EXECUTOR into this checkout's
// .env; the key is never printed. Then start Nova here with npm start.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');

// Replace or append KEY=value lines, keeping every other line (and its order) as it was.
export function updateEnv(text, values) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text ? text.split(/\r?\n/) : [];
  if (lines.length && lines.at(-1) === '') lines.pop();
  const pending = new Map(Object.entries(values));
  const out = lines.map(line => {
    const key = line.match(/^\s*([A-Z0-9_]+)\s*=/)?.[1];
    if (!key || !pending.has(key)) return line;
    const value = pending.get(key);
    pending.delete(key);
    return `${key}=${value}`;
  });
  for (const [key, value] of pending) out.push(`${key}=${value}`);
  return out.join(nl) + nl;
}

async function main() {
  const [hubArg, code] = process.argv.slice(2);
  if (!hubArg || !code) {
    console.log('usage: node tools/join-hub.mjs <hub-url> <pairing-code>');
    process.exitCode = 1;
    return;
  }
  const hub = new URL(hubArg);
  if (hub.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(hub.hostname)) throw new Error('The hub URL must use https.');
  const base = hub.origin;
  const r = await fetch(`${base}/v1/device/pair`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(20000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.success !== true || !data.key || !data.device?.executor) {
    const reason = typeof data.error === 'string' ? data.error : `HTTP_${r.status}`;
    const hint = reason === 'PAIRING_CODE_INVALID_OR_EXPIRED' ? ' Create a new code on the hub.' : '';
    throw new Error(`${reason}.${hint}`);
  }
  const before = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
  const tmp = `${envFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, updateEnv(before, { JACO_HUB_URL: base, JACO_DEVICE_KEY: data.key, JACO_NOVA_EXECUTOR: data.device.executor }), { mode: 0o600 });
  fs.renameSync(tmp, envFile);

  // The key works: the hub answers this device's queue.
  const check = await fetch(`${base}/v1/device/current`, { headers: { authorization: `Bearer ${data.key}` }, signal: AbortSignal.timeout(20000) });
  const queue = await check.json().catch(() => ({}));
  if (!check.ok || queue.success !== true) throw new Error(`Paired, but the hub did not accept the key (${queue.error || check.status}).`);
  console.log(`Joined ${base} as ${data.device.executor}.`);
  console.log(`Wrote JACO_HUB_URL, JACO_DEVICE_KEY and JACO_NOVA_EXECUTOR to ${envFile}.`);
  console.log(queue.mission ? `A mission is already waiting: ${queue.mission.id}.` : 'No mission is waiting for this device yet.');
  console.log('Start Nova here with: npm start');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(`Not joined: ${e.message}`); process.exitCode = 1; });
}
