import test from 'node:test';
import assert from 'node:assert/strict';
import { readCognitiveGraphContext } from '../../agents/lib/cognitive-graph-context.mjs';

const row = (id, type, verificationStatus, score = 1) => ({ score, node: { id, type, verificationStatus, label: id } });
const response = matches => ({ ok: true, json: async () => ({
  success: true, result: { schema: 'jaco.cognitive-graph.search.v1', graphHash: 'sha256:a',
    repositorySnapshotHash: 'sha256:b', partial: false, matches },
}) });

test('read-only graph lookup retains verified knowledge and observed files but never stale or unverified claims', async () => {
  let requested;
  const found = await readCognitiveGraphContext('Repair session persistence and retries', {
    runtimeUrl: 'http://127.0.0.1:3000', token: 'fixture',
    fetchImpl: async (url, options) => { requested = { url, options }; return response([
      row('knowledge:retry-v4', 'KNOWLEDGE', 'VERIFIED', 3),
      row('knowledge:retry-old', 'KNOWLEDGE', 'STALE', 2),
      row('knowledge:guess', 'KNOWLEDGE', 'UNVERIFIED', 1),
      row('file:src/retry.mjs', 'FILE', 'OBSERVED', 1),
    ]); },
  });
  assert.deepEqual(found.matches.map(x => x.id), ['knowledge:retry-v4', 'file:src/retry.mjs']);
  assert.equal(found.authority, 'read_only_context');
  assert.equal(found.graphHash, 'sha256:a');
  assert.match(requested.url.pathname, /cognition\/graph\/search/);
  assert.match(requested.url.searchParams.get('q'), /session persistence/);
  assert.equal(requested.options.headers.authorization, 'Bearer fixture');
  assert.equal(requested.options.method, 'GET');
});

test('no remote URL, invalid data, unavailable service or empty query can create an apparent memory hit', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('ECONNREFUSED'); };
  assert.equal(await readCognitiveGraphContext('retry', { runtimeUrl: 'https://example.org', fetchImpl }), null);
  assert.equal(await readCognitiveGraphContext('och en det', { runtimeUrl: 'http://127.0.0.1:3000', fetchImpl }), null);
  assert.equal(calls, 0);
  assert.equal(await readCognitiveGraphContext('retry', { runtimeUrl: 'http://127.0.0.1:3000', fetchImpl }), null);
  assert.equal(calls, 1);
  assert.equal(await readCognitiveGraphContext('retry', { runtimeUrl: 'http://127.0.0.1:3000', fetchImpl:async()=>({ok:true,json:async()=>({success:true,result:{schema:'wrong',matches:[row('knowledge:x','KNOWLEDGE','VERIFIED')]}})}) }),null);
});

test('memory graph context is bounded and cannot attach tool authorization', async () => {
  const found = await readCognitiveGraphContext('retry', { runtimeUrl: 'http://localhost:3000', maxMatches: 8, maxChars: 600,
    fetchImpl: async () => response(Array.from({length:12},(_,i)=>row('knowledge:'+i,'KNOWLEDGE','VERIFIED'))),
  });
  assert.ok(found.matches.length > 0 && found.matches.length <= 8);
  assert.ok(JSON.stringify(found).length <= 600);
  assert.equal(found.allowedTasks, undefined);
});
