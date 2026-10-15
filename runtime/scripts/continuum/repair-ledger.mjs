#!/usr/bin/env node
// Continuum ledger repair: keep the longest valid hash-chained prefix of events.jsonl.
//
//   node scripts/continuum/repair-ledger.mjs [--workspace <root>] [--apply]
//
// Without --apply it only reports. With --apply it refuses while a live process holds the writer lock,
// copies the complete original next to the ledger, and atomically rewrites events.jsonl with the valid prefix.
// Nothing is re-signed: events after the first break are preserved only in the backup, never rewritten.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJson, sha256 } from '../../src/server/continuum/util.mjs';

export function scanLedger(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  let previous = 'GENESIS', expected = 1, validBytes = 0, error = null, firstInvalidLine = null, lastValid = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let event;
    try { event = JSON.parse(line); } catch { error = `unparseable JSON at line ${i + 1}`; firstInvalidLine = i + 1; break; }
    if (event.sequence !== expected) { error = `sequence gap at ${expected} (line ${i + 1} has ${event.sequence})`; firstInvalidLine = i + 1; break; }
    if (event.prevHash !== previous) { error = `prevHash mismatch at sequence ${event.sequence}`; firstInvalidLine = i + 1; break; }
    const { hash, ...unsigned } = event;
    if (hash !== sha256(`${event.prevHash}\n${canonicalJson(unsigned)}`)) { error = `hash mismatch at sequence ${event.sequence}`; firstInvalidLine = i + 1; break; }
    previous = hash; expected += 1; lastValid = event;
    validBytes += Buffer.byteLength(line) + 1;
  }
  const discarded = firstInvalidLine ? lines.slice(firstInvalidLine - 1) : [];
  const stamp = (l) => { try { return JSON.parse(l).timestamp || null; } catch { return null; } };
  return {
    file, valid: !error, error, totalLines: lines.length, validEvents: expected - 1, headHash: previous, validBytes,
    lastValidTimestamp: lastValid?.timestamp || null, firstInvalidLine, discardedLines: discarded.length,
    firstDiscardedTimestamp: discarded.length ? stamp(discarded[0]) : null, lastDiscardedTimestamp: discarded.length ? stamp(discarded.at(-1)) : null,
  };
}

function lockHolder(ledgerDir) {
  const lockFile = path.join(ledgerDir, 'events.lock');
  if (!fs.existsSync(lockFile)) return null;
  try {
    const holder = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    if (holder.host !== os.hostname()) return holder;
    try { process.kill(holder.pid, 0); return holder; } catch (error) { return error?.code === 'EPERM' ? holder : null; }
  } catch { return { unreadable: true }; }
}

export function repairLedger(file, { now = new Date() } = {}) {
  const report = scanLedger(file);
  if (report.valid) return { ...report, applied: false, reason: 'LEDGER_ALREADY_VALID' };
  const holder = lockHolder(path.dirname(file));
  if (holder) throw new Error(`LEDGER_IN_USE: stop the process holding ${path.join(path.dirname(file), 'events.lock')} (${JSON.stringify(holder)}) first`);
  const backup = `${file}.corrupt-${now.toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
  if (fs.statSync(backup).size !== fs.statSync(file).size) throw new Error('LEDGER_BACKUP_SIZE_MISMATCH');
  const fd = fs.openSync(file, 'r');
  const prefix = Buffer.alloc(report.validBytes);
  fs.readSync(fd, prefix, 0, report.validBytes, 0);
  fs.closeSync(fd);
  const tmp = `${file}.repair-${process.pid}.tmp`;
  fs.writeFileSync(tmp, prefix, { mode: 0o600 });
  fs.renameSync(tmp, file);
  const after = scanLedger(file);
  if (!after.valid || after.validEvents !== report.validEvents) throw new Error(`LEDGER_REPAIR_VERIFY_FAILED: ${after.error}`);
  return { ...report, applied: true, backup, after: { validEvents: after.validEvents, headHash: after.headHash } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--workspace');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const workspace = path.resolve(at >= 0 ? args[at + 1] : path.join(here, '..', '..'));
  const file = path.join(workspace, '.jaco', 'continuum', 'ledger', 'events.jsonl');
  if (!fs.existsSync(file)) { console.error(`No ledger at ${file}`); process.exit(2); }
  const result = args.includes('--apply') ? repairLedger(file) : { ...scanLedger(file), applied: false, reason: 'DRY_RUN (pass --apply to repair)' };
  console.log(JSON.stringify(result, null, 2));
}
