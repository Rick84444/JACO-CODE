import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { compactMissionForBrain } from '../../agents/hands-off-agent.mjs';
import { normalizeCodingContract } from '../../agents/lib/coding-contract.mjs';
import { createAutonomyLoop } from '../../gateway/src/seer-autonomy-loop.mjs';
import { createMissionDispatcher } from '../../gateway/src/seer-mission-dispatch.mjs';
import { createMissionGraph } from '../../gateway/src/seer-mission-graph.mjs';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { NovaMissionControl } from '../../runtime/src/server/connected/novaMissionControl.mjs';
import { buildAgentBoard } from '../../runtime/src/server/connected/auraAgentBoard.mjs';
import { cognitiveQuestionToolbox } from '../../runtime/src/server/connected/cognitiveQuestionToolbox.mjs';
import { layoutAgentNetwork } from '../../runtime/src/lib/agentNetworkLayout.mjs';

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-agent-network-'));
  let db,graph;
  const open=()=>{db=new DatabaseSync(path.join(root,'seer.sqlite'));graph=createMissionGraph({db,uid:randomUUID,now:Date.now});};
  open();
  const bus=new DurableMissionBus(path.join(root,'bus')),control=new NovaMissionControl(bus,{allowedTasks:['repo-read']});
  t.after(()=>{db.close();bus.close();fs.rmSync(root,{recursive:true,force:true});});
  return {bus,control,get graph(){return graph;},reopen(){db.close();open();}};
}
const workplace={reachable:true,agents:[{agentId:'actual-agent',name:'Execution node',role:'Executor',status:'READY',liveSessions:1}]};
const coordinator={reachable:true,health:{local_model:{model:'local-model'}}};

test('task agents are persisted contexts and nested delegation survives restart without a second registry',t=>{
  const f=fixture(t);
  const created=f.graph.create({title:'Build a feature',objective:'Complete and verify the feature',policy:{autonomy:'closed-loop',allowedTasks:['repo-read']},nodes:[{key:'implement',title:'Feature agent',objective:'Implement the requested feature',contract:normalizeCodingContract({objective:'Implement and verify',scope:{allowed:['src/**']},acceptance:['Observed result'],verification:{tests_required:false,falsifier_required:false},budget:{max_steps:40,max_tool_calls:40,max_duration_ms:60000}})}]});
  f.graph.fail(created.id,'implement',{reason:'NOVA_REPLAN_REQUEST:split work'});
  f.graph.replan(created.id,{failed_key:'implement',replacements:[{key:'inspect',title:'Research agent',objective:'Inspect the actual interfaces',dependencies:[]},{key:'integrate',title:'Integration agent',objective:'Integrate the change',dependencies:['inspect']}]});
  f.graph.fail(created.id,'inspect',{reason:'NOVA_REPLAN_REQUEST:inspect separately'});
  f.graph.replan(created.id,{failed_key:'inspect',replacements:[{key:'inspect.api',title:'API specialist',objective:'Observe API contracts',dependencies:[]},{key:'inspect.report',title:'Research synthesis',objective:'Report findings',dependencies:['inspect.api']}]});
  f.reopen();
  const graph=f.graph.get(created.id);
  assert.equal(graph.nodes.find(n=>n.key==='inspect.api').contract.budget.max_steps,10);
  const spec=f.graph.dispatchSpec(created.id,'inspect.api');
  assert.equal(spec.parent.agent.name,'API specialist');
  assert.equal(spec.parent.agent.parentKey,'inspect');
  const mission=f.control.create({...spec,parent:{...spec.parent,agent:{...spec.parent.agent,permissions:{shell:true}}}});
  assert.equal(mission.metadata.parent.agent.kind,'task-agent');
  assert.equal(compactMissionForBrain(mission).parent.agent.name,'API specialist');
  assert.equal(mission.metadata.parent.agent.permissions,undefined);
  assert.equal(mission.allowedTasks.includes('shell'),false);
  f.graph.bindNova(created.id,'inspect.api',mission.id);
  const {token}=f.control.claim(mission.id,'actual-agent');
  const board=buildAgentBoard({bus:f.bus,control:f.control,workplace,coordinator,graphs:f.graph.list()});
  const root=board.network.nodes.find(n=>n.nodeKey==='implement');
  const child=board.network.nodes.find(n=>n.nodeKey==='inspect');
  const leaf=board.network.nodes.find(n=>n.nodeKey==='inspect.api');
  assert.equal(root.kind,'task-agent');
  assert.equal(child.parentId,root.id);
  assert.equal(leaf.parentId,child.id);
  assert.equal(leaf.id,mission.metadata.parent.agent.id);
  assert.equal(leaf.executorId,'agent:actual-agent');
  assert.equal(leaf.status,'DISPATCHED');
  assert.ok(board.network.links.some(link=>link.kind==='execution'&&link.from==='agent:actual-agent'&&link.to===leaf.id));
  assert.equal(board.agents.length,1,'delegated contexts must not fabricate live Workplace sessions');
  assert.equal(board.network.plans[0].agentIds.length,5);
  f.control.release(mission.id,{owner:'actual-agent',token});
});

test('network projections redact graph, worker and model fields and preserve unavailable sources',t=>{
  const f=fixture(t);
  const board=buildAgentBoard({bus:f.bus,control:f.control,workplace:{reachable:false,agents:[]},
    coordinator:{reachable:false,health:{local_model:{model:'deployed-secret'}}},
    graphs:[{id:'g',title:'token=private-value',objective:'deployed-secret',status:'ACTIVE',nodes:[{key:'a',title:'deployed-secret',objective:'password=private-value',status:'READY',dependencies:[],strategy:{}}]}],
    workers:[{id:'worker',heartbeatAt:'2000-01-01T00:00:00Z',status:'BUSY',metadata:{name:'deployed-secret',token:'never-forward'}}],secrets:['deployed-secret']});
  const wire=JSON.stringify(board);
  for(const secret of ['deployed-secret','private-value','never-forward'])assert.ok(!wire.includes(secret),secret);
  assert.equal(board.network.coordinatorAvailable,false);
  assert.equal(board.network.nodes.find(n=>n.kind==='worker').status,'OFFLINE');
  const missing=buildAgentBoard({bus:f.bus,control:f.control,workplace:{reachable:false}});
  assert.equal(missing.network.planningAvailable,false);
  assert.equal(missing.network.nodes[0].status,'UNAVAILABLE');
});

test('conversation can inspect its agent team without gaining creation or mutation tools',async()=>{
  let reads=0;
  const toolbox=cognitiveQuestionToolbox({tools:{agent_team:{run:async()=>{reads++;return {observed:true};}},spawn_agent:{run:()=>assert.fail('mutation')},start_goal:{run:()=>assert.fail('mutation')}}},()=>({}));
  assert.equal((await toolbox.tools.agent_team.run()).observed,true);
  assert.equal(reads,1);
  assert.equal(toolbox.tools.spawn_agent,undefined);
  assert.equal(toolbox.tools.start_goal,undefined);
});

test('radial layout is deterministic and terminates with cycles and missing parents',()=>{
  const nodes=[{id:'root',parentId:null},{id:'a',parentId:'b'},{id:'b',parentId:'a'},{id:'c',parentId:'missing'}];
  const a=layoutAgentNetwork(nodes,'root'),b=layoutAgentNetwork(nodes,'root');
  assert.deepEqual(a,b);
  for(const position of Object.values(a.positions)){assert.ok(Number.isFinite(position.x));assert.ok(Number.isFinite(position.y));}
  assert.equal(a.positions.root.x,a.width/2);
  assert.equal(a.positions.root.y,a.height/2);
});


test('a planner decomposition becomes durable child agents through the actual reconciliation and autonomy loop',async t=>{
  const f=fixture(t);
  const created=f.graph.create({title:'Adapt the work',objective:'Inspect and verify an interface',policy:{autonomy:'closed-loop',allowedTasks:['repo-read']},nodes:[{key:'work',title:'Interface agent',objective:'Inspect and verify the interface',contract:normalizeCodingContract({objective:'Inspect the interface',scope:{allowed:['src/**']},acceptance:['Observed API'],verification:{tests_required:false,falsifier_required:false}})}]});
  const dispatcher=createMissionDispatcher({missionGraph:f.graph,createNova:async spec=>f.control.create(spec),cancelNova:async id=>f.control.requestCancel(id)});
  const dispatched=await dispatcher.dispatch(created.id,'work');
  const lease=f.control.claim(dispatched.nova.id,'actual-agent');
  f.control.release(dispatched.nova.id,{owner:'actual-agent',token:lease.token,replanRequest:{reason:'Separate discovery from synthesis',subgoals:[{title:'Contract researcher',objective:'Read the current API contract'},{title:'Evidence synthesizer',objective:'Compare observations against the original goal'}]}});
  const result=f.graph.reconcileNova(created.id,'work',f.control.get(dispatched.nova.id));
  assert.equal(result.outcome,'failed');
  const loop=createAutonomyLoop({missionGraph:f.graph,dispatch:dispatcher.dispatch,callLLM:()=>assert.fail('Reuse the planner decomposition instead of inventing another plan')});
  await loop.turn();
  const graph=f.graph.get(created.id);
  const research=graph.nodes.find(n=>n.title==='Contract researcher');
  assert.equal(research.strategy.delegatedFrom,'work');
  assert.ok(research.nova_mission_id,'the child must be dispatched, not merely drawn');
  const child=f.control.get(research.nova_mission_id);
  assert.equal(child.metadata.parent.agent.name,'Contract researcher');
  const network=buildAgentBoard({bus:f.bus,control:f.control,workplace,coordinator,graphs:[graph]}).network;
  assert.equal(network.nodes.find(n=>n.name==='Contract researcher').parentId,network.nodes.find(n=>n.name==='Interface agent').id);
  assert.ok(network.plans[0].replans.length>0);
});


test('the canonical coordinator registration is merged without guessing from a display name',t=>{
  const f=fixture(t);
  const network=buildAgentBoard({bus:f.bus,control:f.control,coordinator,graphs:[],workplace:{reachable:true,agents:[
    {agentId:'registered-seer',stableId:'seer',name:'SEER',role:'strategic-governor',liveSessions:1,status:'READY'},
    {agentId:'other',stableId:'external',name:'SEER',role:'assistant',liveSessions:1,status:'READY'},
  ]}}).network;
  assert.equal(network.nodes.filter(n=>n.kind==='coordinator').length,1);
  assert.equal(network.nodes.find(n=>n.kind==='coordinator').source,'SEER + Workplace');
  assert.ok(network.nodes.some(n=>n.id==='agent:other'));
  assert.ok(!network.nodes.some(n=>n.id==='agent:registered-seer'));
});
