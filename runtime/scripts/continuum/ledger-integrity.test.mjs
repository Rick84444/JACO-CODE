#!/usr/bin/env node
// Ledger single-writer lock, foreign-append detection and prefix repair.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ContinuumEventStore, matchesLedgerProcessIdentity } from '../../src/server/continuum/eventStore.mjs';
import { repairLedger, scanLedger } from './repair-ledger.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const storeUrl = pathToFileURL(path.join(here, '..', '..', 'src', 'server', 'continuum', 'eventStore.mjs')).href;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-ledger-'));
const pass = [];
async function ok(name, fn) { await fn(); pass.push(name); console.log(`PASS ${name}`); }

// Runs a short script in a separate process that opens the ledger in `dir` and appends `count` events.
function writeInChild(dir, count) {
  const code = `import { ContinuumEventStore } from ${JSON.stringify(storeUrl)};
const s = new ContinuumEventStore(${JSON.stringify(dir)});
for (let i = 0; i < ${count}; i++) s.append({ stream: 'test', type: 'child.event', data: { i } });`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`child failed: ${r.stderr}`);
}

try {
  await ok('lock.second-process-refused', async () => {
    const dir = path.join(work, 'locked');
    const holder = spawn(process.execPath, ['--input-type=module', '-e', `import { ContinuumEventStore } from ${JSON.stringify(storeUrl)};
new ContinuumEventStore(${JSON.stringify(dir)}); console.log('HELD'); setInterval(() => {}, 1000);`], { stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => { holder.stdout.on('data', d => String(d).includes('HELD') && resolve()); holder.once('exit', () => reject(new Error('holder exited'))); });
    try {
      assert.throws(() => new ContinuumEventStore(dir), /LEDGER_LOCKED/);
      writeInChild(path.join(work, 'other'), 1); // an unrelated ledger is unaffected
      fs.appendFileSync(path.join(dir, 'events.jsonl'), 'broken\n');
      assert.throws(() => repairLedger(path.join(dir, 'events.jsonl')), /LEDGER_IN_USE/);
    } finally { holder.kill(); await new Promise(r => holder.once('exit', r)); }
  });

  await ok('lock.stale-holder-taken-over', async () => {
    const dir = path.join(work, 'stale');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'events.lock'), JSON.stringify({ pid: 999999, host: os.hostname(), startedAt: 'long ago' }));
    const store = new ContinuumEventStore(dir);
    store.append({ stream: 'test', type: 'after.stale.lock' });
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'events.lock'), 'utf8')).pid, process.pid);
  });

  await ok('lock.reused-pid-is-not-treated-as-live-writer', async () => {
    if (!fs.existsSync('/proc/self/stat')) return; // Linux/Android process identity path
    const dir = path.join(work, 'pid-reuse');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'events.lock'), JSON.stringify({
      pid: process.pid,
      host: os.hostname(),
      startedAt: 'old process',
      bootId: 'stale-boot-id',
      startTicks: '0',
      ownerId: 'stale-owner',
    }));
    const store = new ContinuumEventStore(dir);
    store.append({ stream: 'test', type: 'after.pid.reuse' });
    const holder = JSON.parse(fs.readFileSync(path.join(dir, 'events.lock'), 'utf8'));
    assert.equal(holder.pid, process.pid);
    assert.notEqual(holder.ownerId, 'stale-owner');
  });

  await ok('lock.windows-new-writer-has-stable-process-birth', async () => {
    const old = { pid: 4520, startedAt:'2026-10-24T07:00:00.000Z', host:os.hostname() };
    assert.equal(matchesLedgerProcessIdentity(old, {
      platform:'win32', processBirth:'2026-10-30T21:30:00.000Z',
    }), false, 'Windows PID reused after lock creation is proven stale');
    assert.equal(matchesLedgerProcessIdentity(old, {
      platform:'win32', processBirth:'2026-10-24T06:59:59.000Z',
    }), true, 'original owner potentially alive must remain locked');
    assert.equal(matchesLedgerProcessIdentity(old, { platform:'win32', processBirth:null }), true,
      'missing process birth is ambiguous and must fail closed');
    assert.equal(matchesLedgerProcessIdentity({pid:4520,startedAt:'unknown'}, {
      platform:'win32', processBirth:'2026-10-30T21:30:00.000Z',
    }), true, 'malformed legacy lock creation time must fail closed');
    const current = {pid:4520, processBirth:'2026-10-30T20:00:00Z'};
    assert.equal(matchesLedgerProcessIdentity(current,{platform:'win32',processBirth:'2026-10-30T20:00:00.000Z'}),true);
    assert.equal(matchesLedgerProcessIdentity(current,{platform:'win32',processBirth:'2026-10-30T21:30:00.000Z'}),false);
  });

  await ok('append.refuses-foreign-writes', async () => {
    const dir = path.join(work, 'foreign');
    const store = new ContinuumEventStore(dir);
    store.append({ stream: 'test', type: 'mine' });
    fs.appendFileSync(path.join(dir, 'events.jsonl'), fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8'));
    assert.throws(() => store.append({ stream: 'test', type: 'would-fork' }), /modified outside this process/);
    assert.equal(fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').length, 2);
  });

  await ok('repair.keeps-valid-prefix-and-backs-up-original', async () => {
    const dir = path.join(work, 'forked');
    writeInChild(dir, 5);
    const file = path.join(dir, 'events.jsonl');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    fs.appendFileSync(file, `${lines.slice(2).join('\n')}\n`); // replay of sequences 3..5, as two writers produce
    const original = fs.readFileSync(file);
    writeInChild(path.join(work, 'noop'), 0);
    assert.throws(() => writeInChild(dir, 1), /integrity failure: sequence gap at 6/);

    const scan = scanLedger(file);
    assert.equal(scan.valid, false); assert.equal(scan.validEvents, 5); assert.equal(scan.firstInvalidLine, 6); assert.equal(scan.discardedLines, 3);

    const result = repairLedger(file, { now: new Date('2026-09-16T00:00:00Z') });
    assert.equal(result.applied, true);
    assert.deepEqual(fs.readFileSync(result.backup), original);
    assert.equal(scanLedger(file).valid, true);
    writeInChild(dir, 2); // runtime can start and append again
    assert.equal(scanLedger(file).validEvents, 7);
    assert.equal(repairLedger(file).reason, 'LEDGER_ALREADY_VALID');
  });

  console.log(`LEDGER_INTEGRITY: PASS (${pass.length}/${pass.length})`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
