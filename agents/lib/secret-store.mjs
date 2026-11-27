// JACO's encrypted secret store for every platform (operator 2026-10-08: agents create logins and API
// keys themselves, and the operator can hand JACO a key without a .env file). Windows keeps its DPAPI
// vault (vault-tools.mjs); elsewhere, and as its fallback, secrets live here.
//
// Each value is sealed with AES-256-GCM under a 32-byte master key: JACO_SECRET_KEY (64 hex chars) when
// set, otherwise <state>/secret.key, created once with mode 0600. The store (<state>/secrets.json, 0600)
// holds names, metadata and ciphertext only. Write-only by design: callers outside the process that
// uses a secret (the planner, the IDE, MCP clients) get names, lengths and timestamps, never values.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,127}$/;
const MAX_VALUE = 16 * 1024;

export function stateDir(env = process.env) {
  return path.resolve(env.JACO_STATE_DIR || path.join(os.homedir(), '.jaco'));
}

function masterKey(env, dir, { create = false } = {}) {
  const decode = raw => {
    const text = String(raw).trim();
    if (!/^[a-f0-9]{64}$/i.test(text)) throw Error('JACO_SECRET_KEY_MUST_BE_64_HEX');
    return Buffer.from(text, 'hex');
  };
  if (env.JACO_SECRET_KEY) return decode(env.JACO_SECRET_KEY);
  const file = path.join(dir, 'secret.key');
  try { return decode(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  if (!create) throw Error('JACO_SECRET_KEY_MISSING');
  // The caller owns the write transaction. Publish the complete key atomically;
  // a process killed before rename cannot leave an empty or truncated master key.
  const key = crypto.randomBytes(32);
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmp, key.toString('hex'), { mode: 0o600, flag: 'wx', flush: true });
    fs.renameSync(tmp, file);
  } finally { fs.rmSync(tmp, { force: true }); }
  return key;
}

export function validateSecretName(name) {
  const value = String(name || '').trim();
  if (!SECRET_NAME.test(value)) throw new Error('INVALID_SECRET_NAME');
  return value;
}

export class SecretStore {
  constructor({ env = process.env, dir = stateDir(env) } = {}) {
    this.env = env;
    this.dir = dir;
    this.file = path.join(dir, 'secrets.json');
  }
  #read() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch (error) { if (error?.code === 'ENOENT') return { schema: 'jaco.secrets/v1', secrets: {} }; throw error; }
  }
  #write(data) {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600, flush: true });
    fs.renameSync(tmp, this.file);
  }
  // SQLite is used only as an OS-backed interprocess mutex; it contains no credentials.
  // BEGIN IMMEDIATE holds a write lock until close/rollback, even across a process
  // crash. No PID guessing or stale lock-file deletion. The encrypted JSON stays canonical.
  #withWriteLock(fn) {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const DatabaseSync = process.getBuiltinModule?.('node:sqlite')?.DatabaseSync;
    if (!DatabaseSync) throw Error('VAULT_WRITE_REQUIRES_NODE_SQLITE');
    const file = this.file + '.mutex.sqlite';
    const db = new DatabaseSync(file);
    try {
      if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
      db.exec('PRAGMA busy_timeout = 1000');
      try { db.exec('BEGIN IMMEDIATE'); }
      catch (error) {
        if (error?.errcode === 5 || error?.errcode === 6 || /database is locked|database table is locked/i.test(error?.message || '')) throw Error('VAULT_WRITE_BUSY');
        throw error;
      }
      return fn();
    } finally {
      // Closing a connection rolls back any outstanding transaction and releases
      // the OS lock. No plaintext or ciphertext is ever written to this database.
      db.close();
    }
  }
  set(name, value, meta = {}) {
    return this.#withWriteLock(() => this.#setUnlocked(name, value, meta));
  }
  setIfAbsent(name, value, meta = {}) {
    const key = validateSecretName(name);
    return this.#withWriteLock(() => {
      if (this.has(key)) return false;
      this.#setUnlocked(key, value, meta);
      return true;
    });
  }
  // Compare under the same cross-process lock used by normal vault writes.
  replaceIfCurrent(name, expected, value, meta = {}) {
    const key = validateSecretName(name);
    return this.#withWriteLock(() => {
      if (this.get(key) !== expected) return false;
      this.#setUnlocked(key, value, meta);
      return true;
    });
  }
  #setUnlocked(name, value, meta) {
    const key = validateSecretName(name);
    const text = String(value ?? '');
    if (!text) throw new Error('SECRET_VALUE_REQUIRED');
    if (text.length > MAX_VALUE) throw new Error('SECRET_VALUE_TOO_LARGE');
    const iv = crypto.randomBytes(12);
    const data = this.#read();
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(this.env, this.dir, { create: Object.keys(data.secrets).length === 0 }), iv);
    // The name is authenticated data: a ciphertext moved to another name does not decrypt.
    cipher.setAAD(Buffer.from(key));
    const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const previous = data.secrets[key];
    data.secrets[key] = {
      iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64'),
      length: text.length, source: String(meta.source || 'operator').slice(0, 60), purpose: String(meta.purpose || previous?.purpose || '').slice(0, 200),
      createdAt: previous?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    this.#write(data);
    return this.describe(key);
  }
  // In-process use only (provider calls, typing vault:<key>); never return the result to a client.
  get(name) {
    const key = validateSecretName(name);
    const entry = this.#read().secrets[key];
    if (!entry) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(this.env, this.dir), Buffer.from(entry.iv, 'base64'));
    decipher.setAAD(Buffer.from(key));
    decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(entry.ct, 'base64')), decipher.final()]).toString('utf8');
  }
  has(name) { return Boolean(this.#read().secrets[validateSecretName(name)]); }
  describe(name) {
    const key = validateSecretName(name);
    const e = this.#read().secrets[key];
    return e ? { name: key, configured: true, length: e.length, source: e.source, purpose: e.purpose, createdAt: e.createdAt, updatedAt: e.updatedAt } : { name: key, configured: false };
  }
  list() { return Object.keys(this.#read().secrets).sort().map(name => this.describe(name)); }
  delete(name) {
    const key = validateSecretName(name);
    return this.#withWriteLock(() => {
      const data = this.#read();
      if (!data.secrets[key]) return false;
      delete data.secrets[key];
      this.#write(data);
      return true;
    });
  }
}

// A strong password for an account an agent creates (letters, digits and symbols every site accepts).
export function generateSecretValue(length = 32) {
  const size = Math.max(16, Math.min(64, Number(length) || 32));
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_.!@#%';
  const bytes = crypto.randomBytes(size);
  let out = '';
  for (let i = 0; i < size; i++) out += alphabet[bytes[i] % alphabet.length];
  // Sites that demand every class get one of each.
  return /[A-Z]/.test(out) && /[a-z]/.test(out) && /\d/.test(out) && /[-_.!@#%]/.test(out) ? out : `${out.slice(0, size - 4)}Aa7!`;
}

// The value of a credential by name: the environment wins, then the store. For in-process use only.
export function credential(name, { env = process.env, store = null } = {}) {
  if (!name || /^JACO_MCP_(?:GUIDED_|OAUTH_)/i.test(String(name).trim())) return '';
  if (env[name]) return String(env[name]);
  try { return (store || new SecretStore({ env })).get(name) || ''; } catch { return ''; }
}

// Provider keys the operator saved (IDE key field, JACO Connect) become ordinary environment variables
// in each JACO process at startup, so every component that reads process.env[<NAME>] sees them without
// being changed one by one. The environment still wins. Agent-made passwords (NOVA_*) are not exported:
// they are only ever typed through vault:<key>.
const EXPORTABLE = /^(?!NOVA_)(?:[A-Z][A-Z0-9_]*(_API_KEY|_TOKEN|_SECRET|_SECRET_KEY|_COMMERCE_KEY)|CDP_API_KEY_ID)$/;
export function hydrateEnvFromStore(env = process.env, store = null) {
  const loaded = [];
  try {
    const s = store || new SecretStore({ env });
    for (const { name } of s.list()) {
      if (!EXPORTABLE.test(name) || env[name]) continue;
      const value = s.get(name);
      if (value) { env[name] = value; loaded.push(name); }
    }
  } catch { /* an unreadable store leaves the environment as it was */ }
  return loaded;
}
export const isExportableSecret = name => EXPORTABLE.test(String(name || ''));
