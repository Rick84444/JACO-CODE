import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REVERSE_GOAL_GRAPH_SCHEMA, REVERSE_GOAL_ROOT,
  reverseGoalLayout, nodeVisualState, hasVerifiedReceipt,
} from '../../runtime/src/lib/reverseGoalLayout.mjs';

const node = (key, dependencies=[], status='READY', evidenceRefs=[]) => ({
  key,title:'Step '+key,objective:'Execute '+key,dependencies,status,evidenceRefs,
});
const graph = nodes => ({id:'g',objective:'Deliver a verified enterprise product',status:'ACTIVE',changes:[],nodes});

test('the immutable intuition is centered and terminal goals are below, dependencies below their consumers', () => {
  const r=reverseGoalLayout(graph([node('finish',['build']),node('build',['read']),node('read')]));
  assert.equal(r.schema,REVERSE_GOAL_GRAPH_SCHEMA);
  assert.equal(r.source,'AURA_MISSION_GRAPH');
  assert.equal(r.readOnly,true);
  assert.equal(r.executed,false);
  assert.equal(r.nodes[0].id,REVERSE_GOAL_ROOT);
  assert.equal(r.nodes[0].title,'Deliver a verified enterprise product');
  const by=new Map(r.nodes.map(n=>[n.id,n]));
  assert.equal(by.get(REVERSE_GOAL_ROOT).x+by.get(REVERSE_GOAL_ROOT).width/2,r.width/2);
  assert.ok(by.get('finish').y>by.get(REVERSE_GOAL_ROOT).y);
  assert.ok(by.get('build').y>by.get('finish').y);
  assert.ok(by.get('read').y>by.get('build').y);
  assert.deepEqual(r.edges.map(e=>[e.from,e.to]),[
    [REVERSE_GOAL_ROOT,'finish'],['finish','build'],['build','read'],
  ]);
  assert.equal(r.totalSteps,3);
});
test('a shared prerequisite has one node and two genuinely independent incoming edges',()=>{
  const r=reverseGoalLayout(graph([node('ship',['qa','docs']),node('qa',['source']),node('docs',['source']),node('source')]));
  assert.equal(r.nodes.filter(n=>n.id==='source').length,1);
  assert.equal(r.edges.filter(e=>e.to==='source').length,2);
  assert.equal(new Set(r.nodes.map(n=>n.id)).size,r.nodes.length);
});
test('active execution sends a BLUE pulse along the whole real ancestry, while inactive edges remain white',()=>{
  const r=reverseGoalLayout(graph([node('ship',['qa','docs']),node('qa',['source']),node('docs'),node('source',[],'RUNNING')]));
  assert.equal(r.activeCount,1);
  assert.equal(r.edges.find(e=>e.from===REVERSE_GOAL_ROOT&&e.to==='ship').status,'active');
  assert.equal(r.edges.find(e=>e.from==='ship'&&e.to==='qa').status,'active');
  assert.equal(r.edges.find(e=>e.from==='qa'&&e.to==='source').status,'active');
  assert.equal(r.edges.find(e=>e.from==='ship'&&e.to==='docs').status,'pending');
  assert.equal(r.nodes.find(n=>n.id==='source').status,'active');
});
test('verification requires a persisted Aura execution-evidence reference, never model prose or registration',()=>{
  assert.equal(hasVerifiedReceipt(node('a',[],'VERIFIED',[])),false);
  assert.equal(nodeVisualState(node('a',[],'VERIFIED',[])),'reported');
  assert.equal(nodeVisualState(node('a',[],'VERIFIED',['receipt:123'])),'verified');
  assert.equal(nodeVisualState(node('a',[],'DISPATCHED')),'active');
  const plan=graph([node('finish',['test']),node('test',[],'VERIFIED',[])]);
  const before=reverseGoalLayout(plan);
  assert.equal(before.edges.find(e=>e.to==='test').status,'pending');
  plan.nodes[1].evidenceRefs=['real:receipt'];
  const after=reverseGoalLayout(plan);
  assert.equal(after.edges.find(e=>e.to==='test').status,'verified');
  assert.deepEqual(after.nodes.map(({id,x,y})=>[id,x,y]),before.nodes.map(({id,x,y})=>[id,x,y]),
    'a new receipt must not rearrange any node');
});
test('collapsing one parent never erases a shared dependency still visible through another parent',()=>{
  const plan=graph([node('ship',['qa','docs']),node('qa',['source']),node('docs',['source']),node('source')]);
  const r=reverseGoalLayout(plan,{collapsed:['qa']});
  assert.ok(r.nodes.some(n=>n.id==='source'));
  assert.ok(r.edges.some(e=>e.from==='docs'&&e.to==='source'));
  assert.ok(!r.edges.some(e=>e.from==='qa'&&e.to==='source'));
  assert.equal(r.nodes.find(n=>n.id==='qa').collapsed,true);
});
test('active-only is a VIEW FILTER; it never fakes an active step',()=>{
  const plan=graph([node('finish',['test']),node('test')]);
  const no=reverseGoalLayout(plan,{activeOnly:true});
  assert.deepEqual(no.nodes.map(n=>n.id),[REVERSE_GOAL_ROOT]);
  assert.equal(no.activePathsObserved,false);
  plan.nodes[1].status='RUNNING';
  const yes=reverseGoalLayout(plan,{activeOnly:true});
  assert.deepEqual(new Set(yes.nodes.map(n=>n.id)),new Set([REVERSE_GOAL_ROOT,'finish','test']));
});
test('a plan replan preserves the operator goal and hides replaced work rather than treating it as active',()=>{
  const plan=graph([node('finish',['new']),node('old',[],'SUPERSEDED'),node('new',[],'READY')]);
  plan.changes=[{reason:'Tests disproved original design'}];
  const r=reverseGoalLayout(plan);
  assert.equal(r.hiddenSuperseded,1);
  assert.equal(r.revisionCount,1);
  assert.equal(r.nodes[0].title,plan.objective);
  assert.equal(r.nodes.find(n=>n.id==='old'),undefined);
});
test('adversarial graph inputs fail closed without inventing a branch or a certificate',()=>{
  assert.throws(()=>reverseGoalLayout(graph([node('a',['missing'])])),/GAMEBOARD_UNKNOWN_DEPENDENCY/);
  assert.throws(()=>reverseGoalLayout(graph([node('a',['b']),node('b',['a'])])),/GAMEBOARD_CYCLE/);
  assert.throws(()=>reverseGoalLayout(graph([node('a',['a'])])),/GAMEBOARD_CYCLE/);
  assert.throws(()=>reverseGoalLayout(graph([node('a'),node('a')])),/DUPLICATE/);
  assert.throws(()=>reverseGoalLayout(graph(Array.from({length:241},(_,i)=>node('step'+i)))),/GRAPH_LIMIT/);
});
test('operator approval is visualized, not executed or granted by drawing the board',()=>{
  const plan=graph([{...node('publish'),'missionId':'mission-1'}]);
  const r=reverseGoalLayout(plan,{waitingMissionIds:['mission-1']});
  assert.equal(r.nodes.find(n=>n.id==='publish').status,'approval');
  assert.equal(r.readOnly,true);
  assert.equal(r.executed,false);
});


test('senior audit: an offline runtime must stop blue motion, while retaining the last observed source graph',()=>{
  const plan=graph([node('ship',['run']),node('run',[],'RUNNING')]);
  const live=reverseGoalLayout(plan,{executionFresh:true});
  const stale=reverseGoalLayout(plan,{executionFresh:false});
  assert.equal(live.activeCount,1);
  assert.equal(live.edges.filter(e=>e.status==='active').length,2);
  assert.equal(stale.executionFresh,false);
  assert.equal(stale.reportedActiveCount,1);
  assert.equal(stale.activeCount,0);
  assert.equal(stale.edges.filter(e=>e.status==='active').length,0);
  assert.equal(stale.nodes.find(n=>n.id==='run').status,'stale');
  assert.deepEqual(stale.nodes.map(({id,x,y})=>[id,x,y]),live.nodes.map(({id,x,y})=>[id,x,y]));
});
