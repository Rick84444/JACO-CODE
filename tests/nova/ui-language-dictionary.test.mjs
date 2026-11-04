// The UI's English comes from a Swedish-keyed dictionary: `L(text) => tr(text, EN_LABELS[text] || text)`.
// The Swedish string IS the lookup key, so translating a producer in place orphans its entry — and the failure is
// silent and one-sided: an English session keeps English by accident (it falls through to the now-English source
// string) while a Swedish session loses Swedish, with no error anywhere. The browser gate catches one such string
// by chance; this catches all of them, without a browser.
//
// Fixing an orphan means either restoring the Swedish key at the producer, or deleting the dictionary entry if the
// string is genuinely server-side and English-only. Both are deliberate acts. Silently translating is not.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DICTIONARY = 'runtime/src/components/CognitiveWorkspace.tsx';
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const dictionarySource = read(DICTIONARY);
const entries = [...dictionarySource.matchAll(/^\s*"([^"]+)":\s*"([^"]+)",?\s*$/gm)].map(m => ({ swedish: m[1], english: m[2] }));

// The dictionary cannot be its own producer: strip the EN_LABELS literal before searching this file.
function withoutDictionary(source) {
  const literal = /const EN_LABELS[^{]*\{[\s\S]*?\n\};/.exec(source);
  return literal ? source.slice(0, literal.index) + source.slice(literal.index + literal[0].length) : source;
}

const sourceFiles = execFileSync('git', ['ls-files', 'runtime/src', 'agents'], { cwd: root, encoding: 'utf8' })
  .split('\n').filter(file => /\.(ts|tsx|mjs)$/.test(file));
const corpus = sourceFiles.map(file => {
  const text = read(file);
  return file === DICTIONARY ? withoutDictionary(text) : text;
}).join('\n');

test('the dictionary has entries at all, so an empty parse cannot pass this file', () => {
  assert.ok(entries.length >= 40, `parsed only ${entries.length} dictionary entries`);
});

test('every dictionary key is still produced by the code that feeds it', () => {
  const orphans = entries.filter(entry => !corpus.includes(entry.swedish));
  assert.deepEqual(orphans.map(entry => entry.swedish), [],
    'these Swedish strings are dictionary keys that nothing produces any more, so a Swedish session renders English:\n  ' +
    orphans.map(entry => `${entry.swedish}  ->  ${entry.english}`).join('\n  '));
});

test('no dictionary entry translates a string to itself', () => {
  const useless = entries.filter(entry => entry.swedish === entry.english);
  assert.deepEqual(useless.map(entry => entry.swedish), [], 'an entry that maps a string to itself does nothing');
});

test('the live status labels are dictionary keys, not already-English text', () => {
  // These come from cognitiveEvents.mjs, which runs in the client where the operator's language is known, so its
  // status labels go through the dictionary. Its event titles (tool phrases, category names) do not: those are
  // produced where no language is known and are English by design. The split is the point.
  const events = read('runtime/src/lib/cognitiveEvents.mjs');
  const keys = new Set(entries.map(entry => entry.swedish));
  // Every quoted string inside a `label:` expression, which covers the plain form, the busy ternary and the
  // phase map — and nothing outside it, so category ids and evidence outcomes are not mistaken for copy.
  // A `label:` expression can also contain comparison operands (`busy === 'goal' ? ... : ...`). Those are state
  // names, not copy, and the file itself says so by comparing against them.
  const operands = new Set([...events.matchAll(/===\s*'([^']+)'/g)].map(m => m[1]));
  const labels = [...events.matchAll(/label:\s*([\s\S]*?),\s*tone:/g)]
    .flatMap(match => [...match[1].matchAll(/'([^']+)'/g)].map(quoted => quoted[1]))
    .filter(text => !operands.has(text));
  assert.ok(labels.length >= 15, `found only ${labels.length} status labels to check`);
  const strays = labels.filter(text => !keys.has(text));
  assert.deepEqual(strays, [], `status labels that are not dictionary keys, so English would be shown in a Swedish session:\n  ${strays.join('\n  ')}`);
});
