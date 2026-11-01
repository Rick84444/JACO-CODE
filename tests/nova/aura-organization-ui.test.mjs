import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { wouldCompleteTrifecta } from '../../runtime/src/lib/organizationRisk.mjs';

const permissions = {
  'files.read': { exposure: ['private'] },
  'mail.receive': { exposure: ['untrusted'] },
  'mail.send': { exposure: ['external'] },
  'commands.run': { exposure: ['external'] },
  browser: { exposure: ['untrusted', 'external'] },
  'files.write': { exposure: [] },
};

test('dashboard warns before a grant completes untrusted + private + external', () => {
  assert.equal(wouldCompleteTrifecta(['files.read', 'mail.receive'], permissions, 'mail.send'), true);
  assert.equal(wouldCompleteTrifecta(['files.read'], permissions, 'browser'), true);
  assert.equal(wouldCompleteTrifecta(['mail.receive', 'mail.send'], permissions, 'files.read'), true);
  assert.equal(wouldCompleteTrifecta(['files.read', 'mail.receive'], permissions, 'files.write'), false);
  assert.equal(wouldCompleteTrifecta(['files.read'], permissions, 'mail.send'), false);
});

test('dashboard source uses the real organization API, never simulated agents', () => {
  const source = fs.readFileSync(new URL('../../runtime/src/components/AuraOrganizationPanel.tsx', import.meta.url), 'utf8');
  const board = fs.readFileSync(new URL('../../runtime/src/components/AuraAgentBoard.tsx', import.meta.url), 'utf8');
  assert.match(source, /fetch\('\/api\/aura\/organization'/);
  assert.match(source, /x-jaco-operator-token/);
  assert.match(source, /wouldCompleteTrifecta/);
  assert.match(source, /runtime enforcement is not connected yet/);
  assert.match(board, /view==='organization'/);
  assert.match(board, /React\.lazy\(\(\) => import\('\.\/AuraOrganizationPanel'\)/);
});
