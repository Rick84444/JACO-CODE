import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSkill, relevantAuthorizedSkills } from '../../agents/lib/skills.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills');

test('Aura Desktop is a canonical skill, not a new agent or control plane', () => {
  const skill = loadSkill([root], 'aura-desktop');
  assert.equal(skill.id, 'aura-desktop');
  assert.deepEqual(skill.tasks, ['desktop-windows','desktop-observe','desktop-action','screenshot','skill-load']);
  for (const source of ['mission-screen-frame.mjs', 'tractionCore.mjs', 'desktopTraction.mjs', 'desktopHandsOff.ts', 'modelRelay.ts', 'Mission Bus', 'Continuum']) {
    assert.ok(skill.body.includes(source), 'existing owner missing: ' + source);
  }
  assert.match(skill.body, /UNVERIFIED/);
  assert.match(skill.body, /not an additional agent/);
});

test('Skill discovery preserves mission task attenuation and does not grant desktop writes', () => {
  const skill = loadSkill([root], 'aura-desktop');
  const catalog = [{ id: skill.id, description: skill.description, tasks: skill.tasks }];
  const goal = 'Aura Desktop Laser Vision remote sandbox observation';
  assert.equal(relevantAuthorizedSkills(catalog, skill.tasks, goal).length, 1);
  assert.deepEqual(relevantAuthorizedSkills(catalog, ['desktop-windows','desktop-observe','screenshot','skill-load'], goal), []);
});
