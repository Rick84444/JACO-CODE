// Joined devices (operator 2026-10-04, choice B): a second PC or the phone runs its own Nova and reaches
// this hub through the public tunnel with a key of its own. A device key is not the gateway token: it
// only reads and runs missions routed to that device (executor 'nova@<name>'), and the operator can
// revoke it on its own. Only a SHA-256 hash of each key is stored.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DEVICE_NAME = /^[a-z0-9][a-z0-9-]{1,39}$/;
// Two kinds of key: 'nova' (a device's Nova runs missions routed to nova@<name>) and 'ide' (a signed-in
// browser on the remote IDE, src/server/connected/ideAccess.mjs). A key only works as its own kind.
export const DEVICE_KINDS = ['nova', 'ide'];
const kindOf = d => d?.kind || 'nova';
const checkKind = kind => { if (!DEVICE_KINDS.includes(kind)) throw new Error('INVALID_DEVICE_KIND'); return kind; };
const hash = key => crypto.createHash('sha256').update(String(key)).digest('hex');
// Pairing codes are typed or pasted by a person: no 0/O, 1/I/L. 10 characters of 31 is about 50 bits,
// single use, valid for 10 minutes, and pairing locks after repeated wrong codes.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_TTL_MS = 10 * 60_000;
const PAIR_FAILURE_LIMIT = 20;
const PAIR_LOCK_MS = 10 * 60_000;
const normalizeCode = code => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export class DeviceRegistry {
  constructor(file, { now = () => new Date().toISOString() } = {}) {
    this.file = file;
    this.now = now;
    this.pairFailures = [];
  }
  read() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { devices: Array.isArray(data?.devices) ? data.devices : [], invites: Array.isArray(data?.invites) ? data.invites : [] };
    } catch { return { devices: [], invites: [] }; }
  }
  load() { return this.read().devices; }
  save(devices, invites = this.read().invites) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    const at = Date.parse(this.now());
    const open = invites.filter(i => !i.usedAt && Date.parse(i.expiresAt) > at);
    fs.writeFileSync(tmp, JSON.stringify({ devices, invites: open }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  // A one-time pairing code for a device name, shown to the operator. The device exchanges it for its
  // own key (redeem); the key itself is never displayed. A new invite replaces an open one for the name.
  invite(name, kind = 'nova') {
    if (!DEVICE_NAME.test(String(name || ''))) throw new Error('INVALID_DEVICE_NAME');
    checkKind(kind);
    const raw = Array.from({ length: 10 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
    const expiresAt = new Date(Date.parse(this.now()) + CODE_TTL_MS).toISOString();
    const { devices, invites } = this.read();
    this.save(devices, [...invites.filter(i => !(i.name === name && kindOf(i) === kind)), { name, kind, codeHash: hash(raw), expiresAt, usedAt: null }]);
    return { name, kind, executor: kind === 'nova' ? `nova@${name}` : null, code: `${raw.slice(0, 5)}-${raw.slice(5)}`, expiresAt };
  }
  // kind: the kind the caller accepts; a code made for the other kind counts as a wrong code.
  redeem(code, kind = 'nova') {
    const at = Date.parse(this.now());
    this.pairFailures = this.pairFailures.filter(t => at - t < PAIR_LOCK_MS);
    if (this.pairFailures.length >= PAIR_FAILURE_LIMIT) throw new Error('PAIRING_LOCKED_TRY_LATER');
    const { devices, invites } = this.read();
    const presented = hash(normalizeCode(code));
    const invite = invites.find(i => !i.usedAt && Date.parse(i.expiresAt) > at && i.codeHash === presented && kindOf(i) === kind);
    if (!invite) { this.pairFailures.push(at); throw new Error('PAIRING_CODE_INVALID_OR_EXPIRED'); }
    invite.usedAt = this.now();
    this.save(devices, invites);
    return this.add(invite.name, kind);
  }
  // The key is returned once and never stored. Adding a name again replaces its key (re-pairing).
  add(name, kind = 'nova') {
    if (!DEVICE_NAME.test(String(name || ''))) throw new Error('INVALID_DEVICE_NAME');
    checkKind(kind);
    const key = `${kind === 'ide' ? 'jide' : 'jdev'}_${crypto.randomBytes(32).toString('base64url')}`;
    const devices = this.load().filter(d => !(d.name === name && kindOf(d) === kind));
    const device = { name, kind, executor: kind === 'nova' ? `nova@${name}` : null, keyHash: hash(key), createdAt: this.now(), revokedAt: null, lastSeenAt: null };
    this.save([...devices, device]);
    return { device: publicDevice(device), key };
  }
  revoke(name, kind = 'nova') {
    const devices = this.load();
    const device = devices.find(d => d.name === name && kindOf(d) === kind && !d.revokedAt);
    if (!device) throw new Error('DEVICE_NOT_FOUND');
    device.revokedAt = this.now();
    this.save(devices);
    return publicDevice(device);
  }
  setMemoryAccess(name, allowed) {
    if (typeof allowed !== 'boolean') throw Error('MEMORY_ACCESS_BOOLEAN_REQUIRED');
    const {devices, invites} = this.read();
    const device = devices.find(d => d.name === name && kindOf(d) === 'nova' && !d.revokedAt);
    if (!device) throw Error('DEVICE_NOT_FOUND');
    device.memoryAccess = allowed; this.save(devices, invites); return publicDevice(device);
  }
  // online: the device's Nova asked for work within the last 3 minutes (contact is recorded once a minute).
  list() {
    const at = Date.parse(this.now());
    return this.load().map(d => ({ ...publicDevice(d), online: !d.revokedAt && Boolean(d.lastSeenAt) && at - Date.parse(d.lastSeenAt) < 180_000 }));
  }
  // The device for a presented key, or null. Revoked keys never match.
  verify(key, kind = 'nova') {
    const prefix = kind === 'ide' ? 'jide_' : 'jdev_';
    if (typeof key !== 'string' || !key.startsWith(prefix) || key.length > 200) return null;
    const presented = Buffer.from(hash(key), 'hex');
    const devices = this.load();
    const device = devices.find(d => !d.revokedAt && kindOf(d) === kind && crypto.timingSafeEqual(Buffer.from(d.keyHash, 'hex'), presented));
    if (!device) return null;
    // Last contact, written at most once a minute.
    if (!device.lastSeenAt || Date.parse(this.now()) - Date.parse(device.lastSeenAt) > 60_000) {
      device.lastSeenAt = this.now();
      try { this.save(devices); } catch { /* contact time is informational */ }
    }
    return publicDevice(device);
  }
}

const publicDevice = d => ({ name: d.name, kind: kindOf(d), executor: d.executor ?? null, createdAt: d.createdAt, revokedAt: d.revokedAt || null, lastSeenAt: d.lastSeenAt || null, memoryAccess: d.memoryAccess === true });

// Operator routes (gateway token or the local IDE) manage devices; device routes take only a device key
// (Authorization: Bearer jdev_...) and mirror the mission paths a Nova uses, limited to the device's
// own executor. Missions are still created on the hub, never by a device.
export function mountDeviceRoutes(app, requireAuth, control, registry, onUpdate = () => {}) {
  const send = (res, fn) => {
    try { const data = fn(); onUpdate(); res.json({ success: true, ...data }); }
    catch (e) { res.status(409).json({ success: false, error: e.message }); }
  };
  app.get('/api/connected/devices', requireAuth, (_req, res) => send(res, () => ({ devices: registry.list() })));
  app.post('/api/connected/devices/invite', requireAuth, (req, res) => send(res, () => ({ invite: registry.invite(String(req.body?.name || ''), String(req.body?.kind || 'nova')) })));
  app.delete('/api/connected/devices/:name', requireAuth, (req, res) => send(res, () => ({ device: registry.revoke(req.params.name, String(req.query?.kind || 'nova')) })));

  const deviceAuth = (req, res, next) => {
    const header = String(req.headers.authorization || '');
    const device = registry.verify(header.startsWith('Bearer ') ? header.slice(7).trim() : '', 'nova');
    if (!device) return res.status(401).json({ success: false, error: 'DEVICE_KEY_INVALID' });
    req.device = device;
    next();
  };
  const own = (req) => {
    const mission = control.get(req.params.id);
    if ((mission.metadata?.executor || 'nova') !== req.device.executor) throw new Error('MISSION_EXECUTOR_MISMATCH');
    return mission;
  };
  const root = '/api/connected/device';
  // The one unauthenticated device call: a valid, unexpired pairing code becomes the device's key.
  app.post(`${root}/pair`, (req, res) => send(res, () => { const { device, key } = registry.redeem(req.body?.code, 'nova'); return { device, key }; }));
  app.get(`${root}/current`, deviceAuth, (req, res) => send(res, () => ({ mission: control.current(req.device.executor) })));
  app.get(`${root}/missions/:id`, deviceAuth, (req, res) => send(res, () => ({ mission: own(req) })));
  app.post(`${root}/missions/:id/claim`, deviceAuth, (req, res) => send(res, () => control.claim(req.params.id, String(req.body?.owner || ''), req.device.executor)));
  app.post(`${root}/missions/:id/preflight`, deviceAuth, (req,res)=>send(res,()=>{own(req);return control.preflight(req.params.id,req.body||{});}));
  app.post(`${root}/missions/:id/begin`, deviceAuth, (req, res) => send(res, () => { own(req); return { task: control.begin(req.params.id, req.body || {}) }; }));
  app.post(`${root}/missions/:id/finish`, deviceAuth, (req, res) => send(res, () => { own(req); return { mission: control.finish(req.params.id, req.body || {}) }; }));
  app.post(`${root}/missions/:id/release`, deviceAuth, (req, res) => send(res, () => { own(req); return { mission: control.release(req.params.id, req.body || {}) }; }));
}
