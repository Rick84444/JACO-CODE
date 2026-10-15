// Operator 2026-10-03: JACO writes skills from its own missions; the operator approves them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { toolCorrections, correctionNote, procedureSteps, skillProposal, lessonsFrom, learningStore, nameProcedure } = await import('../../agents/lib/skill-learning.mjs');
const { listSkills } = await import('../../agents/lib/skills.mjs');
const { plannerTools } = await import('../../agents/lib/native-tools.mjs');

const r = (n, ok, server, tool, args, extra = {}) => ({ actionId: `m:turn:${n}`, type: 'mcp-call', ok, verified: ok, input: { server, tool, arguments: args }, ...extra });
// Shaped like mission d718a3e1 (2026-10-03).
const receipts = [
  r(1, true, 'git', 'git_log', { repo_path: 'C:/r', max_count: 3 }, { expectedOutcome: 'three commits' }),
  r(2, false, 'git', 'git_show', { repo_path: 'C:/r', revision: 'abc1234 --name-only' }, { result: { output: "Ref 'abc1234 --name-only' did not resolve to an object" } }),
  r(3, true, 'git', 'git_show', { repo_path: 'C:/r', revision: 'HEAD~2' }),
  r(4, false, 'git', 'git_diff', { repo_path: 'C:/r', target: 'PLACEHOLDER_HASH_1' }, { result: { output: "Ref 'PLACEHOLDER_HASH_1' did not resolve" } }),
  r(5, true, 'git', 'git_diff', { repo_path: 'C:/r', target: 'HEAD~1' }),
  r(6, false, 'git', 'git_show', { commit: 'HEAD' }, { result: { output: "'revision' is a required property" } }),
  r(7, true, 'git', 'git_show', { repo_path: 'C:/r', revision: 'HEAD' }),
];

test('a failed call fixed by a later call of the same tool becomes a general note', () => {
  const c = toolCorrections(receipts);
  assert.deepEqual(c.map(x => [x.tool, x.steps]), [['git.git_show', [2, 3]], ['git.git_diff', [4, 5]], ['git.git_show', [6, 7]]]);
  assert.match(correctionNote(c[0]), /^revision takes a single value; options such as --name-only are not accepted/);
  assert.match(correctionNote(c[1]), /^target must be a real value taken from a receipt, never a placeholder/);
  assert.match(correctionNote(c[2]), /^pass repo_path, revision; not commit/);
  assert.deepEqual(toolCorrections([{ ...receipts[1], input: undefined }, receipts[2]]), [], 'receipts without input teach nothing');
});

test('a procedure is learned only from a DONE mission whose claims held, not from skill runs', () => {
  const ok = [r(1, true, 'repo', 'recent_commits', { max_count: 3 }), r(2, true, 'repo', 'commit_files', { revision: 'a' }), r(3, true, 'repo', 'commit_files', { revision: 'b' })];
  assert.deepEqual(procedureSteps(ok).map(s => [s.tool, s.times]), [['repo.recent_commits', 1], ['repo.commit_files', 2]]);
  const mission = { id: 'm1', status: 'DONE', goal: 'Vilka filer ändrades i de tre senaste commitsen?', receipts: ok };
  assert.ok(lessonsFrom(mission, { ok: true }).procedure);
  assert.equal(lessonsFrom(mission, null).procedure, null, 'no claim check, no procedure');
  assert.equal(lessonsFrom(mission, { ok: false }).procedure, null);
  assert.equal(lessonsFrom({ ...mission, status: 'CANCELLED' }, { ok: true }).procedure, null);
  assert.equal(lessonsFrom({ ...mission, goal: 'Skill repo-insight: x' }, { ok: true }).procedure, null);
  const p = skillProposal(mission, ok, { name: 'Lista filer per commit', description: 'När man vill se vilka filer commits ändrade.' });
  assert.equal(p.id, 'learned-lista-filer-per-commit');
  assert.match(p.skillMd, /^---\nname: Lista filer per commit\ndescription: När man vill se vilka filer commits ändrade\.\ntasks: \[mcp-call\]\n---/);
  assert.match(p.skillMd, /2\. mcp-call repo\.commit_files \{revision\} \(2 times, one per item\)/);
});

test('store: proposals are made once, wait for the operator, and approval installs them', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-learn-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = learningStore(dir);
  const note = { kind: 'tool-note', tool: 'git.git_show', note: 'pass revision', missionId: 'm1' };
  const a = store.add(note);
  assert.equal(a.status, 'PENDING');
  assert.equal(store.add(note), null, 'the same lesson is never proposed twice');
  assert.deepEqual(store.notes(), {}, 'nothing is used before approval');
  store.decide(a.key, 'approve');
  assert.equal(store.notes()['git.git_show'][0].note, 'pass revision');
  assert.throws(() => store.decide(a.key, 'reject'), /PROPOSAL_APPROVED/);
  const ok = [r(1, true, 'repo', 'recent_commits', {}), r(2, true, 'repo', 'commit_files', { revision: 'a' })];
  const s = store.add({ ...skillProposal({ id: 'm2', goal: 'Lista filer' }, ok, {}), missionId: 'm2' });
  assert.equal(store.add({ ...skillProposal({ id: 'm3', goal: 'Annan formulering' }, ok, {}), missionId: 'm3' }), null, 'same tool sequence, no second proposal');
  const done = store.decide(s.key, 'approve');
  assert.equal(listSkills([path.join(dir, 'skills')]).find(x => x.id === done.installedAs)?.tasks.join(), 'mcp-call', 'the approved skill parses as a SKILL.md');
  const rejected = store.add({ kind: 'tool-note', tool: 'fetch.fetch', note: 'x', missionId: 'm4' });
  store.decide(rejected.key, 'reject');
  assert.equal(store.notes()['fetch.fetch'], undefined);
});

test('approved notes reach the planner with the tool; naming falls back to the template', async () => {
  const { tools } = plannerTools(['mcp-call', 'web-fetch'], [{ server: 'git', name: 'git_show', readOnly: true, description: 'Show', inputSchema: { type: 'object' }, note: 'pass revision' }], { 'web-fetch': 'use lite.duckduckgo.com' });
  assert.match(tools.find(x => x.function.name === 'mcp__git__git_show').function.description, /Learned: pass revision$/);
  assert.equal(tools.find(x => x.function.name === 'web-fetch').function.description, 'Learned: use lite.duckduckgo.com');
  const named = await nameProcedure('x', [], { candidates: [{ name: 'groq', model: 'm', url: 'http://x', key: 'k' }], fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(named, { name: null, description: null, by: null });
});

test('read missions are remembered in the store', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-learned-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = learningStore(dir);
  assert.equal(store.isLearned('m1'), false);
  store.markLearned('m1');
  assert.equal(learningStore(dir).isLearned('m1'), true);
});
