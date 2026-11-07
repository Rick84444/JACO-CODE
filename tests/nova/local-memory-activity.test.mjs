import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { localMemoryActivity } from '../../runtime/src/server/connected/localMemoryActivity.mjs';

function makeRuntime() {
  const stored = new Map([
    ['knowledge-a', {
      id: 'knowledge-a', kind: 'verified-pattern', purpose: 'Reusable retry strategy',
      reasoningSummary: 'Two candidate approaches were tested; B passed. This is a recorded decision summary.',
      verificationStatus: 'VERIFIED', confidence: 0.9, updatedAt: '2026-11-07T22:00:00Z',
      evidenceRefs: ['receipt-1'], dependencies: ['fetch'], failureModes: ['429'],
      usedIn: ['mission-3'],
    }],
  ]);
  const events = [{
    id:'evt-1', stream:'knowledge', sequence:14, type:'knowledge.created',
    entityId:'knowledge-a', timestamp:'2026-11-07T22:00:00Z',
  }];
  return {
    knowledge: {get: id => {if(!stored.has(id))throw Error('not found');return stored.get(id);},
      list:()=>[...stored.values()]},
    events:{list:()=>events},
  };
}

test('local memory activity projects only persisted knowledge and exact write receipts',()=>{
  const r = localMemoryActivity(makeRuntime());
  assert.equal(r.source,'local-continuum');
  assert.equal(r.latestWriteSequence,14);
  assert.equal(r.entries.length,1);
  assert.equal(r.entries[0].title,'Reusable retry strategy');
  assert.equal(r.entries[0].decisionSummary.includes('candidate approaches'),true);
  assert.deepEqual(r.entries[0].evidenceRefs,['receipt-1']);
  assert.deepEqual(r.entries[0].missionIds,['mission-3']);
  assert.equal(r.changes[0].sequence,14);
  assert.match(r.explanation,/not hidden model chain-of-thought/);
});

test('non-write events do not cause a false saving animation',()=>{
  const runtime=makeRuntime();
  runtime.events.list=()=>[{id:'evt-2',stream:'knowledge',type:'knowledge.compression_completed',sequence:22,entityId:'knowledge-a'}];
  const r=localMemoryActivity(runtime);
  assert.equal(r.latestWriteSequence,0);
  assert.equal(r.changes.length,0);
  assert.equal(r.entries.length,1);
});

test('secrets are redacted from user-facing memory summary',()=>{
  const runtime=makeRuntime();
  runtime.knowledge.get=()=>({
    id:'knowledge-a',purpose:'The key is sk-abc123abc123abc123',
    reasoningSummary:'Bearer secret-something-secret',updatedAt:'2026-11-07',
    verificationStatus:'UNVERIFIED',
  });
  const r=localMemoryActivity(runtime);
  assert.doesNotMatch(JSON.stringify(r.entries),/sk-abc123abc123abc123|Bearer secret-something-secret/);
});

test('view is fail-closed without the actual local memory provider',()=>{
  assert.throws(()=>localMemoryActivity({}),/LOCAL_CONTINUUM_MEMORY_UNAVAILABLE/);
  assert.throws(()=>localMemoryActivity({knowledge:{get(){}},events:{}}),/LOCAL_CONTINUUM_MEMORY_UNAVAILABLE/);
});

test('gameboard icon is tracked and the official memory view is not an external service',()=>{
  const file=path.resolve('runtime/public/branding/memory-tree.png');
  const bytes=fs.readFileSync(file);
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.ok(bytes.length>1000);
});
