#!/usr/bin/env node
import test from 'node:test';
import assert from 'node:assert/strict';
import { CognitiveGraphProjection } from '../../src/server/continuum/cognitiveGraphProjection.mjs';

function stores() {
  const entries = new Map();
  const receipts = new Map();
  let repo = { status: 'SCANNED', snapshotHash: 'sha256:one', updatedAt: '2026-10-20T01:00:00Z',
    files: [
      { path: 'src/api.ts', sha256: 'hash-api', symbols: ['retry'], parser: 'typescript-ast' },
      { path: 'src/transport.ts', sha256: 'hash-transport', symbols: ['transport'] },
    ], edges: [{ from: 'src/api.ts', to: 'src/transport.ts', type: 'IMPORTS' }] };
  const graph = new CognitiveGraphProjection({
    knowledge: { list: ({ limit }) => [...entries.values()].slice(0, limit) },
    evidence: { get: id => { if (!receipts.has(id)) throw new Error('not found'); return receipts.get(id); } },
    repository: { snapshot: () => structuredClone(repo) },
  });
  return { entries, receipts, graph, get repo() { return repo; }, set repo(value) { repo = value; } };
}
const fact = (id, more = {}) => ({ id, purpose: `Reliable ${id} retry`, kind: 'verified-code-pattern', verificationStatus: 'VERIFIED',
  revision: 1, updatedAt: '2026-10-20T02:00:00Z', confidence: .9, evidenceRefs: [], dependencies: [], usedIn: [], ...more });
const node = (g, id) => g.nodes.find(item => item.id === id);

test('projects code imports, knowledge dependencies and evidence without independent persistence', () => {
  const s = stores();
  s.receipts.set('pass1', { id: 'pass1', claim: 'Tests passed', kind: 'test', verified: true, contentHash: 'proof1' });
  s.entries.set('retry', fact('retry', { usedIn: ['src/api.ts'], evidenceRefs: ['pass1'] }));
  s.entries.set('gateway', fact('gateway', { dependencies: ['retry', 'nonexistent-symbol'] }));
  const result = s.graph.build();
  assert.equal(result.authority, 'DERIVED_READ_ONLY');
  assert.equal(node(result, 'knowledge:retry').verificationStatus, 'VERIFIED');
  assert(result.edges.some(e => e.from === 'knowledge:gateway' && e.to === 'knowledge:retry' && e.type === 'DEPENDS_ON'));
  assert(result.edges.some(e => e.from === 'knowledge:retry' && e.to === 'file:src/api.ts' && e.type === 'USED_IN'));
  assert(result.edges.some(e => e.from === 'file:src/api.ts' && e.to === 'file:src/transport.ts' && e.type === 'IMPORTS'));
  assert(result.edges.some(e => e.from === 'knowledge:retry' && e.to === 'evidence:pass1' && e.type === 'SUPPORTED_BY'));
  assert.equal(result.edges.some(e => e.to.includes('nonexistent-symbol')), false);
  assert.equal(s.graph.build().graphHash, result.graphHash);
  assert.equal(s.graph.neighbors('knowledge:retry', { depth: 1 }).nodes.length, 4);
  assert.deepEqual(s.graph.search('retry').matches.map(x => x.node.id), ['knowledge:gateway', 'knowledge:retry', 'file:src/api.ts'].sort());
});

test('derived staleness follows repository revision and cascades to dependent verified knowledge', () => {
  const s = stores();
  s.entries.set('base', fact('base', { metrics: { repositorySnapshotHash: 'sha256:one' } }));
  s.entries.set('derived', fact('derived', { dependencies: ['base'] }));
  assert.equal(node(s.graph.build(), 'knowledge:derived').verificationStatus, 'VERIFIED');
  s.repo = { ...s.repo, snapshotHash: 'sha256:two' };
  const current = s.graph.build();
  assert.equal(node(current, 'knowledge:base'), undefined);
  assert.equal(node(current, 'knowledge:derived'), undefined);
  const historical = s.graph.build({ includeInactive: true });
  assert.equal(node(historical, 'knowledge:base').verificationStatus, 'STALE');
  assert.equal(node(historical, 'knowledge:derived').verificationStatus, 'STALE');
  assert.equal(s.entries.get('base').verificationStatus, 'VERIFIED');
  assert.equal(s.graph.search('base').matches.length, 0);
  assert.equal(s.graph.search('base', { includeInactive: true }).matches.length, 1);
});

test('unverified evidence downgrades effective verification without mutating canonical store', () => {
  const s = stores();
  s.entries.set('candidate', fact('candidate', { evidenceRefs: ['missing', 'unverified'] }));
  s.receipts.set('unverified', { id: 'unverified', verified: false, claim: 'Pending' });
  const result = s.graph.build();
  assert.equal(node(result, 'knowledge:candidate').verificationStatus, 'UNVERIFIED');
  assert.equal(node(result, 'knowledge:candidate').storedVerificationStatus, 'VERIFIED');
  assert(result.edges.some(e => e.to === 'evidence:unverified'));
  assert(!result.edges.some(e => e.to === 'evidence:missing'));
});

test('search, neighborhood and snapshot honor bounds and omit dangling edges', () => {
  const s = stores();
  for (let i=0; i<12; i++) s.entries.set(`pattern${i}`, fact(`pattern${i}`, { dependencies: i ? [`pattern${i-1}`] : [] }));
  const page = s.graph.snapshot({ limit: 3 });
  assert.equal(page.nodes.length, 3);
  assert.equal(page.partial, true);
  assert(page.edges.every(e => page.nodes.some(n => n.id === e.from) && page.nodes.some(n => n.id === e.to)));
  const neighborhood = s.graph.neighbors('knowledge:pattern0', { depth: 3, limit: 3 });
  assert(neighborhood.nodes.length <= 3);
  assert(neighborhood.partial);
  assert.equal(s.graph.search('pattern', { limit: 2 }).matches.length, 2);
  assert.throws(() => s.graph.neighbors('knowledge:does-not-exist'), /NODE_NOT_FOUND/);
});
