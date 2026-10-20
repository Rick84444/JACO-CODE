// Operator 2026-10-03: JACO's own skills (SKILL.md), followed by whichever LLM plans.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { parseSkill, skillTasks, listSkills, loadSkill, skillMissionGoal, skillIdOfGoal, fetchSkill } = await import('../../agents/lib/skills.mjs');

const repoSkills = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-skills-'));
const write = (root, id, text) => { fs.mkdirSync(path.join(root, id), { recursive: true }); fs.writeFileSync(path.join(root, id, 'SKILL.md'), text); };
const a = path.join(dir, 'a'), b = path.join(dir, 'b');
write(a, 'look', '---\nname: "Look"\ndescription: Looks at things\ntasks: [mcp-call, web-fetch]\n---\n# Look\nDo it.\n');
write(a, 'coder', '---\nname: Coder\ntasks: [repo-write]\n---\nbody');
write(a, 'Bad_Id', '---\nname: x\ntasks: [mcp-call]\n---\n');
write(b, 'look', '---\nname: Shadowed\ntasks: [mcp-call]\n---\n');
write(b, 'plain', 'no frontmatter');

test('SKILL.md frontmatter: name, description, list and comma tasks', () => {
  const { meta, body } = parseSkill('---\r\nname: X\r\ntasks: a, b\r\n---\r\nhello');
  assert.deepEqual([meta.name, meta.tasks, body], ['X', 'a, b', 'hello']);
  assert.throws(() => parseSkill('# none'), /SKILL_FRONTMATTER_MISSING/);
  assert.deepEqual(skillTasks({ tasks: 'mcp-call, web-fetch' }), ['mcp-call', 'web-fetch']);
  assert.throws(() => skillTasks({ tasks: ['nope'] }), /SKILL_TASK_UNKNOWN:nope/);
  assert.throws(() => skillTasks({ tasks: ['repo-write'] }), /SKILL_CODE_TASKS_NEED_CONTRACT/);
  assert.throws(() => skillTasks({}), /SKILL_TASKS_REQUIRED/);
});

test('listing: first root wins, invalid ids skipped, malformed skills listed with their error', () => {
  const list = listSkills([a, b, path.join(dir, 'missing')]);
  assert.deepEqual(list.map(s => [s.id, s.name, s.error || null]), [
    ['coder', 'Coder', null],
    ['look', 'Look', null],
    ['plain', 'plain', 'SKILL_FRONTMATTER_MISSING'],
  ]);
  assert.equal(list[1].body, undefined, 'the list carries no bodies');
  const skill = loadSkill([a, b], 'look');
  assert.deepEqual([skill.tasks, skill.body], [['mcp-call', 'web-fetch'], '# Look\nDo it.']);
  assert.throws(() => loadSkill([a], '../etc'), /SKILL_ID_INVALID/);
  assert.throws(() => loadSkill([a], 'absent'), /SKILL_NOT_FOUND/);
});

test('a run is a mission goal that names the skill; Nova reads the skill back from the runtime', async () => {
  const goal = skillMissionGoal({ id: 'look' }, '  what changed?  ');
  assert.equal(goal, 'Skill look: what changed?');
  assert.equal(skillIdOfGoal(goal), 'look');
  assert.equal(skillIdOfGoal('Look at Skill x: no'), null);
  assert.throws(() => skillMissionGoal({ id: 'look' }, ' '), /SKILL_INPUT_REQUIRED/);
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push([url, init.headers['x-gateway-token']]); return new Response(JSON.stringify({ success: true, skill: { name: 'Look', description: 'd', body: 'Do it.' } })); };
  assert.deepEqual(await fetchSkill('look', { env: { JACO_GATEWAY_TOKEN: 't' }, fetchImpl, runtimeUrl: 'http://rt' }), { id: 'look', name: 'Look', description: 'd', instructions: 'Do it.' });
  assert.deepEqual(seen, [['http://rt/api/skills/look', 't']]);
  await assert.rejects(fetchSkill('x', { env: {}, runtimeUrl: 'http://rt', fetchImpl: async () => new Response('{"success":false,"error":"SKILL_NOT_FOUND"}', { status: 404 }) }), /SKILL_NOT_FOUND/);
});

test('an oversized skill is listed with its error; runs of different skills are never merged', async () => {
  write(b, 'huge', '---\nname: Huge\ntasks: [mcp-call]\n---\n' + 'x'.repeat(30_000));
  assert.equal(listSkills([b]).find(s => s.id === 'huge').error, 'SKILL_TOO_LARGE');
  const { findDuplicate } = await import('../../runtime/src/server/connected/missionDedupe.mjs');
  const input = 'summarise the last ten commits of the JACO repository and list every changed file path';
  const open = [{ id: 'm1', goal: `Skill repo-insight: ${input}`, executor: 'nova' }];
  assert.equal(findDuplicate(`Skill web-research: ${input}`, 'nova', open, 0.8), null);
  assert.equal(findDuplicate(`Skill repo-insight: ${input}`, 'nova', open, 0.8)?.id, 'm1');
});

test('the repository skills all parse and declare only allowed, non-code tasks', () => {
  const list = listSkills([repoSkills]);
  assert.deepEqual(list.map(s => s.id), ['community-post', 'create-github-repo', 'repo-insight', 'repo-security-scan', 'web-research']);
  for (const s of list) assert.equal(s.error, undefined, `${s.id}: ${s.error}`);
});

test('Nova can pick a skill itself: skill-load is a validated read-only task and the catalog comes from the runtime', async () => {
  const { validateTask } = await import('../../runtime/src/server/connected/novaMissionControl.mjs');
  assert.equal(validateTask({ type: 'skill-load', data: { id: 'repo-insight' } }, ['skill-load']).data.id, 'repo-insight');
  assert.throws(() => validateTask({ type: 'skill-load', data: { id: '../x' } }, ['skill-load']), /INVALID_SKILL_ID/);
  const { BATCHABLE } = await import('../../agents/lib/mission-client.mjs');
  assert.ok(BATCHABLE.has('skill-load'));
  const { fetchSkillList, resetSkillList } = await import('../../agents/lib/skills.mjs');
  resetSkillList();
  let calls = 0;
  const fetchImpl = async url => { calls++; assert.equal(url, 'http://rt/api/skills'); return new Response(JSON.stringify({ success: true, skills: [{ id: 'a', description: 'A', tasks: ['mcp-call'] }, { id: 'b', error: 'SKILL_TOO_LARGE', tasks: [] }] })); };
  assert.deepEqual(await fetchSkillList({ env: {}, fetchImpl, runtimeUrl: 'http://rt' }), [{ id: 'a', description: 'A', tasks: ['mcp-call'] }]);
  await fetchSkillList({ env: {}, fetchImpl, runtimeUrl: 'http://rt' });
  assert.equal(calls, 1, 'cached');
  const { compactMissionForBrain } = await import('../../agents/hands-off-agent.mjs');
  const brain = compactMissionForBrain({ receipts: [{ type: 'skill-load', ok: true, verified: true, actionId: 'm:turn:1', input: { id: 'a' }, result: { id: 'a', instructions: 'x'.repeat(5000) } }] });
  assert.equal(brain.recentReceipts[0].n, 1);
  assert.match(JSON.stringify(brain.recentReceipts[0].result), /see state.skill/);
  assert.ok(JSON.stringify(brain).length < 1000, 'instructions are not repeated in the receipt');
});
