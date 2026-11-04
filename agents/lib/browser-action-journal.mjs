// Durable at-most-once dispatch for identified browser writes. A lost response
// is not permission to execute the same action again.
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, openSync, writeSync, fsyncSync, closeSync, readFileSync, renameSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const ACTION_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{7,127}$/;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const blocked = (actionId, error, extra = {}) => ({ ok: false, verified: false, actionId, error, ...extra });

function syncDirectory(directory) {
  // POSIX directory fsync makes file creation/rename durable; if unsupported,
  // block the write rather than promise at-most-once after a power failure.
  const fd = openSync(directory, 'r');
  try { fsyncSync(fd); }
  finally { closeSync(fd); }
}

function ensureDurableDirectory(directory, syncDir) {
  // Always resync the entire ancestor chain. An earlier initialization may
  // have created directories but failed before their parent entries were
  // durable; checking existsSync alone is insufficient on a later retry.
  const chain = [];
  let cursor = resolve(directory);
  for (;;) {
    chain.push(cursor);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const candidate of chain.reverse()) syncDir(candidate);
}

export function createBrowserActionJournal(directory, { syncDir = syncDirectory } = {}) {
  if (!directory) throw new Error('ACTION_JOURNAL_DIRECTORY_REQUIRED');
  return {
    async execute({ actionId, kind, payload, perform }) {
      if (typeof actionId !== 'string' || !ACTION_ID.test(actionId)) return blocked(actionId, 'ACTION_ID_INVALID');
      if (!['navigate', 'click', 'type'].includes(kind) || typeof perform !== 'function') return blocked(actionId, 'ACTION_INVALID');
      const fingerprint = hash({ kind, payload });
      const file = join(directory, hash(actionId) + '.json');
      try { ensureDurableDirectory(directory, syncDir); }
      catch { return blocked(actionId, 'ACTION_JOURNAL_UNAVAILABLE'); }
      const entry = { actionId, fingerprint, status: 'PENDING', createdAt: new Date().toISOString() };
      let fd;
      try {
        // Exclusive creation serializes duplicate requests across processes.
        fd = openSync(file, 'wx', 0o600);
        try { writeSync(fd, JSON.stringify(entry)); fsyncSync(fd); }
        finally { closeSync(fd); }
        // The claim must be visible after a power loss BEFORE browser dispatch.
        syncDir(directory);
      } catch (error) {
        if (fd !== undefined) return blocked(actionId, 'ACTION_JOURNAL_UNAVAILABLE');
        if (error?.code !== 'EEXIST') return blocked(actionId, 'ACTION_JOURNAL_UNAVAILABLE');
        let prior;
        try { prior = JSON.parse(readFileSync(file, 'utf8')); }
        catch { return blocked(actionId, 'ACTION_JOURNAL_UNREADABLE', { outcomeUnknown: true }); }
        if (prior.actionId !== actionId || prior.fingerprint !== fingerprint) return blocked(actionId, 'ACTION_ID_CONFLICT');
        if (prior.status === 'VERIFIED') {
          try { syncDir(directory); }
          catch { return blocked(actionId, 'ACTION_JOURNAL_UNAVAILABLE', { outcomeUnknown: true }); }
          return { ok: true, verified: true, actionId, replayed: true, receiptId: prior.receiptId };
        }
        return blocked(actionId, 'ACTION_RECONCILIATION_REQUIRED', { outcomeUnknown: true });
      }
      try {
        const result = await perform();
        const verified = result?.ok === true && result?.verified === true && result?.outcomeUnknown !== true;
        const receiptId = randomUUID();
        const updated = { ...entry, status: verified ? 'VERIFIED' : 'UNKNOWN', receiptId, finishedAt: new Date().toISOString() };
        const tmp = file + '.' + randomUUID() + '.tmp';
        try {
          const receiptFd = openSync(tmp, 'wx', 0o600);
          try { writeSync(receiptFd, JSON.stringify(updated)); fsyncSync(receiptFd); }
          finally { closeSync(receiptFd); }
          renameSync(tmp, file);
          syncDir(directory);
        }
        catch { return blocked(actionId, 'ACTION_JOURNAL_UPDATE_FAILED', { outcomeUnknown: true }); }
        return { ...result, actionId, receiptId, ...(!verified ? { verified: false, outcomeUnknown: true } : {}) };
      } catch {
        // PENDING on disk is intentionally sticky even across restart.
        return blocked(actionId, 'ACTION_EXECUTION_UNCERTAIN', { outcomeUnknown: true });
      }
    },
  };
}
