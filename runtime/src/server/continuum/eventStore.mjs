import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureDir, canonicalJson, sha256, nowIso, makeId, redactSensitive } from './util.mjs';

function readBootId() {
  try { return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() || null; } catch { return null; }
}

function readProcessStartTicks(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const end = stat.lastIndexOf(') ');
    if (end < 0) return null;
    // Fields after ") " start at proc stat field 3; field 22 (starttime) is index 19.
    return stat.slice(end + 2).trim().split(/\s+/)[19] || null;
  } catch { return null; }
}

const PROCESS_LOCK_OWNER = Object.freeze({
  pid: process.pid,
  host: os.hostname(),
  bootId: readBootId(),
  startTicks: readProcessStartTicks(process.pid),
  ownerId: makeId('ledger-writer'),
});

const heldLocks = new Map();
process.once('exit', () => {
  for (const [lockFile, ownerId] of heldLocks) {
    try {
      const holder = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      if (holder.ownerId === ownerId) fs.unlinkSync(lockFile);
    } catch {}
  }
});

// Windows has no /proc: a process's creation time is the identity that tells a live writer from a PID that was
// reused after a reboot. Only read on the rare path where a lock already exists.
function readWindowsProcessCreatedAtMs(pid) {
  if (process.platform !== 'win32' || !Number.isInteger(pid) || pid < 1) return null;
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CreationDate.ToUniversalTime().ToString('o')`],
    { encoding: 'utf8', windowsHide: true, timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const ms = Date.parse(out);
    return Number.isFinite(ms) ? ms : null;
  } catch { return null; }
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

function holderMatchesLiveProcess(holder) {
  if (!holder || holder.host !== os.hostname() || !pidAlive(Number(holder.pid))) return false;
  // Legacy locks lack a stable process identity. Fail closed for them while the
  // PID is alive; newly written locks can distinguish PID reuse safely.
  if (!holder.bootId || !holder.startTicks) {
    // The writer is older than its lock: a process created after the lock was taken cannot be the writer.
    const created = readWindowsProcessCreatedAtMs(Number(holder.pid));
    const lockedAt = Date.parse(holder.startedAt);
    return !(created !== null && Number.isFinite(lockedAt) && created > lockedAt + 2000);
  }
  const bootId = readBootId();
  const startTicks = readProcessStartTicks(Number(holder.pid));
  if (!bootId || !startTicks) return true;
  return holder.bootId === bootId && String(holder.startTicks) === String(startTicks);
}

function isCurrentProcessLock(holder) {
  return holder?.ownerId === PROCESS_LOCK_OWNER.ownerId
    && holder?.pid === PROCESS_LOCK_OWNER.pid
    && holder?.host === PROCESS_LOCK_OWNER.host;
}

/**
 * Append-only hash-chained event store. It deliberately has no native addon
 * dependency: Android/Termux must remain bootable even when better-sqlite3 is
 * unavailable. The connected runtime may use node:sqlite elsewhere; Continuum's
 * source of truth remains portable JSONL plus cryptographic chain verification.
 */
export class ContinuumEventStore {
  constructor(root) {
    this.root = ensureDir(root);
    this.file = path.join(this.root, 'events.jsonl');
    this.lockFile = path.join(this.root, 'events.lock');
    this.events = [];
    this.bytes = 0;
    this.integrity = { valid: true, error: null, count: 0, headHash: 'GENESIS' };
    this.#acquireWriterLock();
    this.#load();
  }

  // One writer per ledger. Two processes appending to the same chain fork it (duplicate sequence numbers),
  // after which no process can start. A second process now fails at startup instead of corrupting history.
  #acquireWriterLock() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const fd = fs.openSync(this.lockFile, 'wx', 0o600);
        fs.writeSync(fd, JSON.stringify({ ...PROCESS_LOCK_OWNER, startedAt: nowIso() }));
        fs.closeSync(fd);
        heldLocks.set(this.lockFile, PROCESS_LOCK_OWNER.ownerId);
        return;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        let holder = null;
        try { holder = JSON.parse(fs.readFileSync(this.lockFile, 'utf8')); } catch {}
        if (isCurrentProcessLock(holder)) {
          heldLocks.set(this.lockFile, PROCESS_LOCK_OWNER.ownerId);
          return; // same process reopening its ledger
        }
        const fresh = Date.now() - fs.statSync(this.lockFile).mtimeMs < 5000;
        if (!holder && fresh) throw new Error(`LEDGER_LOCKED: ${this.file} lock is being created by another process`);
        if (holder?.host && holder.host !== os.hostname()) {
          throw new Error(`LEDGER_LOCKED: ${this.file} is written by pid ${holder.pid} on ${holder.host} since ${holder.startedAt}`);
        }
        if (holder && holderMatchesLiveProcess(holder)) {
          throw new Error(`LEDGER_LOCKED: ${this.file} is written by pid ${holder.pid} on ${holder.host} since ${holder.startedAt}`);
        }
        fs.rmSync(this.lockFile, { force: true }); // dead holder or reused PID with mismatched process identity
      }
    }
    throw new Error(`LEDGER_LOCK_UNAVAILABLE: ${this.lockFile}`);
  }

  #load() {
    if (!fs.existsSync(this.file)) return;
    const text = fs.readFileSync(this.file, 'utf8');
    this.bytes = Buffer.byteLength(text);
    const lines = text.split('\n').filter(Boolean);
    let previous = 'GENESIS';
    let expectedSequence = 1;
    try {
      for (const line of lines) {
        const event = JSON.parse(line);
        if (event.sequence !== expectedSequence) throw new Error(`sequence gap at ${expectedSequence}`);
        if (event.prevHash !== previous) throw new Error(`prevHash mismatch at sequence ${event.sequence}`);
        const { hash, ...unsigned } = event;
        const expectedHash = sha256(`${event.prevHash}\n${canonicalJson(unsigned)}`);
        if (hash !== expectedHash) throw new Error(`hash mismatch at sequence ${event.sequence}`);
        this.events.push(event);
        previous = hash;
        expectedSequence += 1;
      }
      this.integrity = { valid: true, error: null, count: this.events.length, headHash: previous };
    } catch (error) {
      this.integrity = { valid: false, error: error instanceof Error ? error.message : String(error), count: this.events.length, headHash: previous };
    }
  }

  assertHealthy() {
    if (!this.integrity.valid) throw new Error(`continuum event store integrity failure: ${this.integrity.error}`);
  }

  append({ stream, type, entityId = null, actor = 'system', data = {}, correlationId = null }) {
    this.assertHealthy();
    const sequence = this.events.length + 1;
    const prevHash = this.events.at(-1)?.hash || 'GENESIS';
    const unsigned = {
      id: makeId('evt'), sequence, timestamp: nowIso(), stream, type,
      entityId, actor, correlationId, data: redactSensitive(data),
      prevHash,
    };
    const event = { ...unsigned, hash: sha256(`${prevHash}\n${canonicalJson(unsigned)}`) };
    // Defense in depth when the lock cannot help (e.g. a copy of the ledger written by an older build):
    // refuse to append to a file that changed since this process last wrote it.
    const onDisk = fs.existsSync(this.file) ? fs.statSync(this.file).size : 0;
    if (onDisk !== this.bytes) {
      this.integrity = { valid: false, error: `ledger modified outside this process (expected ${this.bytes} bytes, found ${onDisk})`, count: this.events.length, headHash: prevHash };
      throw new Error(`continuum event store integrity failure: ${this.integrity.error}`);
    }
    const line = `${JSON.stringify(event)}\n`;
    fs.appendFileSync(this.file, line, { encoding: 'utf8', mode: 0o600 });
    this.bytes += Buffer.byteLength(line);
    this.events.push(event);
    this.integrity = { valid: true, error: null, count: this.events.length, headHash: event.hash };
    return structuredClone(event);
  }

  list({ stream = null, entityId = null, type = null, afterSequence = 0, limit = 200 } = {}) {
    const bounded = Math.max(1, Math.min(Number(limit) || 200, 5000));
    return this.events
      .filter((event) => event.sequence > Number(afterSequence || 0))
      .filter((event) => !stream || event.stream === stream)
      .filter((event) => !entityId || event.entityId === entityId)
      .filter((event) => !type || event.type === type)
      .slice(-bounded)
      .map((event) => structuredClone(event));
  }

  close() {
    const ownerId = heldLocks.get(this.lockFile);
    if (!ownerId) return false;
    try {
      const holder = JSON.parse(fs.readFileSync(this.lockFile, 'utf8'));
      if (holder?.ownerId !== ownerId) return false;
      fs.unlinkSync(this.lockFile);
      heldLocks.delete(this.lockFile);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        heldLocks.delete(this.lockFile);
        return true;
      }
      throw error;
    }
  }

  verify() {
    let previous = 'GENESIS';
    let expectedSequence = 1;
    for (const event of this.events) {
      if (event.sequence !== expectedSequence) return { valid: false, error: `sequence gap at ${expectedSequence}` };
      if (event.prevHash !== previous) return { valid: false, error: `prevHash mismatch at ${event.sequence}` };
      const { hash, ...unsigned } = event;
      const expectedHash = sha256(`${event.prevHash}\n${canonicalJson(unsigned)}`);
      if (hash !== expectedHash) return { valid: false, error: `hash mismatch at ${event.sequence}` };
      previous = hash;
      expectedSequence += 1;
    }
    return { valid: true, count: this.events.length, headHash: previous };
  }
}
