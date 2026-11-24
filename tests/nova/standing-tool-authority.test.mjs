import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { standingToolAuthority, mcpAuthorityRoot } from '../../agents/lib/standing-tool-authority.mjs';

const fixture = run => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-tool-authority-'));
  const file = path.join(root, '.jaco', 'state', 'autonomy', 'mandates.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { return run({root,file}); } finally { fs.rmSync(root, { recursive: true, force: true }); }
};
const saved = (file, decisions = {}) => fs.writeFileSync(file, JSON.stringify([{
  id: 'operator-level5-default', enabled: true, signedByOperator: true,
  validity: 'STANDING', expiresAt: null, revision: 7,
  decisions: { READ: 'ALLOW', LOCAL_MUTATION: 'ALLOW', EXTERNAL_MUTATION: 'DENY',
    PUBLISH: 'REVIEW', FINANCIAL: 'REVIEW', ...decisions }
}]));

test('no mandate legacy compatibility does not fabricate an operator grant', () => fixture(({root}) => {
  assert.equal(standingToolAuthority(root,'LOCAL_MUTATION').status, 'LEGACY');
}));

test('first-install unsigned placeholder keeps legacy local development available', () => fixture(({root,file}) => {
  fs.writeFileSync(file, JSON.stringify([{
    id:'operator-level5-default', enabled:false, signedByOperator:false,
    signedAt:null, validity:'STANDING', expiresAt:null, decisions:{ LOCAL_MUTATION:'ALLOW' }
  }]));
  assert.equal(standingToolAuthority(root, 'LOCAL_MUTATION').status, 'LEGACY');
}));

test('standing operator controls local and outward actions independently', () => fixture(({root,file}) => {
  saved(file);
  assert.equal(standingToolAuthority(root,'LOCAL_MUTATION').allowed, true);
  assert.equal(standingToolAuthority(root,'EXTERNAL_MUTATION').status, 'DENY');
  assert.equal(standingToolAuthority(root,'PUBLISH').status, 'REVIEW');
  assert.equal(standingToolAuthority(root,'FINANCIAL').status, 'REVIEW');
  saved(file, { LOCAL_MUTATION: 'DENY', EXTERNAL_MUTATION: 'ALLOW' });
  assert.equal(standingToolAuthority(root,'LOCAL_MUTATION').status, 'DENY', 'GUI edit acts at next call');
  assert.equal(standingToolAuthority(root,'EXTERNAL_MUTATION').allowed, true);
}));

test('revoke and damaged state never allow a write', () => fixture(({root,file}) => {
  saved(file);
  const records = JSON.parse(fs.readFileSync(file, 'utf8'));
  records[0].enabled = false;
  fs.writeFileSync(file, JSON.stringify(records));
  assert.equal(standingToolAuthority(root, 'LOCAL_MUTATION').status, 'DENY');
  fs.writeFileSync(file, 'invalid-json');
  assert.equal(standingToolAuthority(root, 'LOCAL_MUTATION').status, 'DENY');
}));

test('timed legacy grant expires but signed standing grant does not', () => fixture(({root,file}) => {
  saved(file);
  const grant = JSON.parse(fs.readFileSync(file, 'utf8'));
  grant[0].validity = 'TIMED';
  grant[0].expiresAt = '2026-01-01T00:00:00.000Z';
  fs.writeFileSync(file, JSON.stringify(grant));
  assert.equal(standingToolAuthority(root, 'LOCAL_MUTATION', { now: Date.UTC(2026, 10, 24) }).status, 'DENY');
}));

test('MCP host workspace is derived from existing config, not a second store', () => fixture(({root}) => {
  assert.equal(mcpAuthorityRoot({configFile:path.join(root,'.jaco','mcp','servers.json')}), root);
  assert.equal(mcpAuthorityRoot({}), null);
}));
