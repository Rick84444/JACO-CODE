import test from 'node:test';
import assert from 'node:assert/strict';
import { readLivePlanContext } from '../../agents/lib/live-plan-context.mjs';

const mission = {
  metadata: { parent: { graphId: 'plan-1', mainGoal: 'Build the final product' } },
};
const fake = comments => async (url, options) => {
  assert.match(url, /\/api\/aura\/plan\/comments\?graphId=plan-1$/);
  assert.equal(options.headers['x-gateway-token'], 'test-token');
  return { ok: true, json: async () => ({ comments }) };
};
const note = (text, author = 'operator', graphId = 'plan-1') => ({ graphId, text, author });

test('plan notes distinguish fresh operator direction from untrusted Aura observations', async () => {
  const result = await readLivePlanContext(mission, {
    runtimeUrl: 'http://127.0.0.1:3000/',
    token: 'test-token',
    fetchImpl: fake([
      note('Focus on the latest design'), note('Background research', 'aura'),
      note('Do not deploy yet'), note('Wrong plan instruction', 'operator', 'other-plan'),
    ]),
  });
  assert.match(result, /FINAL GOAL OF THIS PLAN[\s\S]*Build the final product/);
  assert.match(result, /CURRENT OPERATOR COMMENTS[\s\S]*Do not deploy yet/);
  assert.match(result, /NOTES FROM EARLIER STEPS[\s\S]*Background research/);
  assert.doesNotMatch(result, /Wrong plan instruction/);
  assert.match(result, /no new permissions/);
});

test('a new Gameboard comment appears on the next planning turn without restarting the mission', async () => {
  const comments = [note('First instruction')];
  const fetchImpl = fake(comments);
  const options = { runtimeUrl: 'http://127.0.0.1:3000', token: 'test-token', fetchImpl };
  assert.match(await readLivePlanContext(mission, options), /First instruction/);
  comments.push(note('Latest correction'));
  assert.match(await readLivePlanContext(mission, options), /Latest correction/);
});

test('no plan means no remote fetch, and failed reads are explicit', async () => {
  assert.equal(await readLivePlanContext({}, { fetchImpl: () => { throw new Error('must not fetch'); } }), '');
  await assert.rejects(readLivePlanContext(mission, {
    runtimeUrl: 'http://127.0.0.1:3000',
    fetchImpl: async () => ({ ok: false, status: 503 }),
  }), /PLAN_COMMENTS_HTTP_503/);
});

test('long histories are bounded and newest operator notes survive', async () => {
  const comments = Array.from({ length: 40 }, (_, i) => note(('entry' + i + ':') + 'x'.repeat(1900)));
  const result = await readLivePlanContext(mission, {
    runtimeUrl: 'http://127.0.0.1:3000',
    token: 'test-token',
    fetchImpl: fake(comments),
  });
  assert.ok(result.length <= 8500);
  assert.match(result, /entry39/);
  assert.doesNotMatch(result, /entry0:/);
});
