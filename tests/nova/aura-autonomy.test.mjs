import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createAuraAutonomyRouter } from '../../runtime/src/server/connected/auraAutonomy.mjs';
import { loadApprovalPolicy } from '../../agents/lib/approval-policy.mjs';

test('operator can lower and restore autonomy without agent policy-edit grant', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-autonomy-route-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const policyFile = path.join(dir, 'approval-policy.json');
  const env = { JACO_AUTO_APPROVE_LEVEL: '5', JACO_POLICY_EDIT_GRANT: '0' };
  const app = express(); app.use(express.json());
  app.use('/autonomy', createAuraAutonomyRouter({
    env, policyFile,
    requireOperatorUi: (req, res, next) => req.get('x-test-operator') === 'true'
      ? next() : res.status(401).json({ success: false, error: 'NOT_OPERATOR' }),
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port + '/autonomy';
  const req = async (method, body, extraHeaders = {}) => {
    const r = await fetch(url, {
      method, headers: { 'content-type': 'application/json', 'x-test-operator': 'true', ...extraHeaders },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: await r.json() };
  };
  assert.equal((await req('GET')).data.policy.level, 5, 'starts with full autonomy');
  assert.equal((await req('PATCH', { level: 1 })).data.policy.level, 1);
  assert.equal(loadApprovalPolicy({ env, file: policyFile }).level, 1, 'persistent override read back');
  assert.equal((await req('PATCH', { level: 5 })).data.policy.level, 5);
  for (const body of [{ level: '5' }, { level: 7 }, { level: 4, editsGranted: true }, { extraBlocked: [] }]) {
    assert.equal((await req('PATCH', body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await req('PATCH', { level: 0 }, { origin: 'https://attacker.example' })).status, 403);
  const unauthorized = await fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 0 }) });
  assert.equal(unauthorized.status, 401);
  assert.equal(loadApprovalPolicy({ env, file: policyFile }).level, 5);
});
