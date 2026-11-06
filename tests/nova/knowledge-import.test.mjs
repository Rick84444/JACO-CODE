import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildKnowledge, chunkText, MAX_CHUNK_CHARS } from '../../agents/lib/knowledge-import.mjs';
import { KnowledgeStore } from '../../runtime/src/server/continuum/knowledgeStore.mjs';

const wiki = files => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'));
  for (const [rel, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), body); }
  return root;
};
const store = () => new KnowledgeStore(fs.mkdtempSync(path.join(os.tmpdir(), 'ks-')), { append() {} }, null);

test('pages become knowledge objects that the store accepts and its search finds', () => {
  const root = wiki({ 'Home.md': '# JACO Home\nStart here.', 'guides/Deploy-Steps.md': '# Deploy\nRun the zebra migration first.', 'image.png': 'x', '.git/config': 'x', 'node_modules/a.md': 'x' });
  try {
    const built = buildKnowledge(root, { source: 'My Wiki' });
    assert.equal(built.pages, 2);
    assert.deepEqual(built.objects.map(o => o.implementation.path).sort(), ['Home.md', 'guides/Deploy-Steps.md']);
    const ks = store();
    for (const o of built.objects) ks.put(o, 'wiki-import');
    const found = ks.search('zebra');
    assert.equal(found.length, 1);
    assert.equal(found[0].kind, 'wiki-page');
    assert.equal(found[0].verificationStatus, 'UNVERIFIED');
    assert.equal(found[0].reusable, false);
    assert.match(found[0].purpose, /Deploy \(guides\/Deploy-Steps\.md\)/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('importing twice keeps the same ids and revision for an unchanged page, and updates a changed one', () => {
  const root = wiki({ 'a.md': '# A\none' });
  try {
    const ks = store();
    const first = buildKnowledge(root).objects[0];
    ks.put(first, 'x');
    const again = buildKnowledge(root).objects[0];
    assert.equal(again.id, first.id);
    const before = ks.get(first.id);
    ks.put(again, 'x');
    assert.equal(ks.get(first.id).contentHash, before.contentHash);
    fs.writeFileSync(path.join(root, 'a.md'), '# A\ntwo');
    ks.put(buildKnowledge(root).objects[0], 'x');
    assert.notEqual(ks.get(first.id).contentHash, before.contentHash);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a page with a credential is skipped and reported, not stored', () => {
  const root = wiki({ 'ok.md': '# OK\nfine', 'bad.md': '# Bad\napi_key = sk-proj-abcdefghijklmnopqrstuvwx' });
  try {
    const built = buildKnowledge(root);
    assert.equal(built.objects.length, 1);
    assert.deepEqual(built.skipped.map(s => [s.path, s.reason]), [['bad.md', 'looks like a credential']]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('long pages are split at headings into chunks that fit one knowledge object', () => {
  const section = n => `## Part ${n}\n` + 'word '.repeat(700);
  const chunks = chunkText([1, 2, 3, 4].map(section).join('\n'));
  assert.ok(chunks.length >= 2);
  for (const c of chunks) assert.ok(c.length <= MAX_CHUNK_CHARS);
  const one = chunkText('x'.repeat(MAX_CHUNK_CHARS * 2 + 10));
  assert.equal(one.length, 3);
});

test('files above the size limit and empty pages are skipped with a reason', () => {
  const root = wiki({ 'big.md': 'x'.repeat(600 * 1024), 'empty.md': '   \n', 'fine.md': 'hello' });
  try {
    const built = buildKnowledge(root);
    assert.deepEqual(built.objects.map(o => o.implementation.path), ['fine.md']);
    assert.deepEqual(built.skipped.map(s => s.path).sort(), ['big.md', 'empty.md']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
