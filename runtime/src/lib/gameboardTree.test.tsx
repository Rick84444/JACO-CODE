import test from 'node:test';
import assert from 'node:assert/strict';
import { planTree } from '../components/StrategyBoard';

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

test('the line from the active subgoal to the goal glows all the way to the middle', async () => {
  const { litLine } = await import('../components/StrategyBoard');
  const item = (status: string) => ({ node: node('n', [], status), children: [], repeat: false });
  // Five boxes, work in the first: its drop and the bar to the middle box glow.
  assert.deepEqual(litLine(['RUNNING', 'VERIFIED', 'VERIFIED', 'VERIFIED', 'VERIFIED'].map(item)), ['jp-v jp-r', 'jp-l jp-r', 'jp-l', '', '']);
  assert.deepEqual(litLine(['VERIFIED', 'RUNNING'].map(item)), ['', 'jp-v jp-l']);
  assert.deepEqual(litLine(['VERIFIED', 'VERIFIED'].map(item)), ['', '']);
});
