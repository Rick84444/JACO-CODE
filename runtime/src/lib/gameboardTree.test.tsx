import test from 'node:test';
import assert from 'node:assert/strict';
import { decisionGuidance, planTree } from '../components/StrategyBoard';

const node = (key: string, dependencies: string[] = [], status = 'READY') =>
  ({ key, title: key, objective: key, status, statusText: status, failure: null, dependencies, needs: [], comments: [] });

const shape = (items: ReturnType<typeof planTree>): any => items.map(i => i.repeat ? `=${i.node.key}` : (i.children.length ? { [i.node.key]: shape(i.children) } : i.node.key));

test('the Gameboard is a tree: subgoals under the final goal, the steps they build on under them', () => {
  // research -> page -> publish; research -> post; publish and post lead to the goal.
  const tree = planTree([node('research'), node('page', ['research']), node('publish', ['page']), node('post', ['research'])]);
  assert.deepEqual(shape(tree), [{ publish: [{ page: ['research'] }] }, { post: ['=research'] }]);
});

test('replaced steps leave the tree and a cycle never loops forever', () => {
  assert.deepEqual(shape(planTree([node('a'), node('old', ['a'], 'SUPERSEDED'), node('b', ['a'])])), [{ b: ['a'] }]);
  const cyclic = planTree([node('x', ['y']), node('y', ['x'])]);
  assert.equal(cyclic.length, 1);
  assert.ok(JSON.stringify(shape(cyclic)).includes('"='));
});

test('the Gameboard opens on the plan asked for, else the one Aura is working on', async () => {
  const { pickPlan } = await import('../components/StrategyBoard');
  const plan = (id: string, status = 'READY') => ({ id, status, nodes: [node(id + '1', [], status === 'RUNNING' ? 'RUNNING' : 'VERIFIED')] }) as any;
  const plans = [plan('old'), plan('now', 'RUNNING')];
  assert.equal(pickPlan(plans, 'old')?.id, 'old');
  assert.equal(pickPlan(plans, null)?.id, 'now');
  assert.equal(pickPlan([], null), null);
});

test('the board offers only the mission controls the ledger allows', async () => {
  const { missionControlState } = await import('../components/StrategyBoard');
  const m = (over: Record<string, unknown>) => ({ identity: 'm', goal: 'g', status: 'ACTIVE', verifiedActions: 0, ...over });
  assert.deepEqual(missionControlState(m({})), { live: true, pause: true, resume: false, steer: true, end: true, endGoal: false, state: 'working' });
  assert.deepEqual(missionControlState(m({ paused: { at: 't' }, graphId: 'g1' })), { live: true, pause: false, resume: true, steer: true, end: true, endGoal: true, state: 'paused' });
  // A blocker is decided through the approval row, not paused; a pause on a blocked mission can still be lifted.
  const blocked = missionControlState(m({ status: 'BLOCKED' }));
  assert.deepEqual([blocked.pause, blocked.steer, blocked.end, blocked.state], [false, false, true, 'blocked']);
  assert.equal(missionControlState(m({ status: 'BLOCKED', paused: { at: 't' } })).resume, true);
  assert.equal(missionControlState(m({ status: 'AWAITING_VERIFICATION' })).state, 'verifying');
  // Once ending or ended, nothing is offered.
  assert.deepEqual([missionControlState(m({ cancelRequested: true })).live, missionControlState(m({ cancelRequested: true })).state], [false, 'ending']);
  assert.deepEqual([missionControlState(m({ status: 'DONE' })).live, missionControlState(m({ status: 'CANCELLED', graphId: 'g1' })).endGoal], [false, false]);
});

test('the line from the active subgoal to the goal glows all the way to the middle', async () => {
  const { litLine } = await import('../components/StrategyBoard');
  const item = (status: string) => ({ node: node('n', [], status), children: [], repeat: false });
  // Five boxes, work in the first: its drop and the bar to the middle box glow.
  assert.deepEqual(litLine(['RUNNING', 'VERIFIED', 'VERIFIED', 'VERIFIED', 'VERIFIED'].map(item)), ['jp-v jp-r', 'jp-l jp-r', 'jp-l', '', '']);
  assert.deepEqual(litLine(['VERIFIED', 'RUNNING'].map(item)), ['', 'jp-v jp-l']);
  assert.deepEqual(litLine(['VERIFIED', 'VERIFIED'].map(item)), ['', '']);
});

test('parallel active Gameboard branches illuminate every real active route', async () => {
  const { litLine } = await import('../components/StrategyBoard');
  const item = (status: string) => ({ node: node('n', [], status), children: [], repeat: false });
  const paths = litLine(['RUNNING', 'READY', 'READY', 'READY', 'RUNNING'].map(item));
  assert.ok(paths[0].includes('jp-v'));
  assert.ok(paths[4].includes('jp-v'));
  assert.ok(paths[1].includes('jp-r'));
  assert.ok(paths[3].includes('jp-l'));
});

test('a Gameboard approval explains the action, the reason and a safer path in plain language', () => {
  const guidance = decisionGuidance({ id:'mission:m1', kind:'MISSION', title:'Publicera sidan', risk:'HIGH', reason:'Publicering gör resultatet synligt för andra.', actions:['resume','cancel'] }, 'sv');
  assert.match(guidance.what, /fortsätter uppdraget en gång/);
  assert.match(guidance.why, /Publicering/);
  assert.match(guidance.safer, /evidensen|avsluta/);
  assert.match(guidance.acknowledgement, /Jag förstår.*godkänner/);
});

test('lessons waiting for the operator come first, retired ones last', async () => {
  const { lessonOrder } = await import('../components/MetaLessonsPanel');
  const l = (id: string, status: string, n = 1) => ({ id, status, sources: Array(n).fill({ missionId: 'm', evidence: ['e'] }) }) as any;
  assert.deepEqual(lessonOrder([l('r', 'RETIRED'), l('t1', 'TRIAL', 1), l('a', 'ACTIVE'), l('t2', 'TRIAL', 3), l('p', 'PROPOSED')]).map(x => x.id), ['p', 'a', 't2', 't1', 'r']);
});

test('ending a mission from the board waits long enough to undo', async () => {
  const { UNDO_SECONDS } = await import('../components/StrategyBoard');
  assert.ok(UNDO_SECONDS >= 5 && UNDO_SECONDS <= 15);
});
