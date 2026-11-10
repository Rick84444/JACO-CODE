import test from 'node:test';
import assert from 'node:assert/strict';
import { projectAuraLiveWorkspace, surfaceForAuraTool } from '../../runtime/src/lib/liveWorkspaceProjection.mjs';
import { toCognitiveEvent } from '../../runtime/src/lib/cognitiveEvents.mjs';
import { cognitiveQuestionToolbox } from '../../runtime/src/server/connected/cognitiveQuestionToolbox.mjs';

const AT = '2026-11-10T20:00:00.000Z';
const later = seconds => new Date(Date.parse(AT) + seconds * 1000).toISOString();
const create = ({ missionId='m1', actionId='a1', type='repo-read', phase='NOVA_ACTION_STARTED',
  at=AT, durable=true, outcome='observed', seq=1 } = {}) => ({
  id:'mission:'+seq, seq, at, missionId, actionId,
  type:phase, toolType:type, durable,
  evidence:{outcome,path:null,url:null,commit:null,exitCode:null,error:null},
  text:type
});

test('the projection only observes real tool events, never advertised capabilities or a planning message',()=>{
  const events=[
    { ...create({phase:'MISSION_CREATED'}), type:'MISSION_CREATED' },
    { ...create({phase:'NOVA_PLANNING_RESULT'}), type:'NOVA_PLANNING_RESULT' },
    { ...create(), toolType:null },
    create({actionId:'actual'})
  ];
  const result=projectAuraLiveWorkspace(events,{missionId:'m1',now:Date.parse(AT)+1000});
  assert.equal(result.actionCount,1);
  assert.equal(result.surfaces[0].primary.actionId,'actual');
});

test('simultaneous code, browser and tests are visible in the same mission',()=>{
  const events=[
    create({actionId:'code',type:'repo-write',seq:1}),
    create({actionId:'browser',type:'browser-click',seq:2}),
    create({actionId:'test',type:'repo-test',seq:3}),
    create({actionId:'code',type:'repo-write',phase:'NOVA_ACTION_RESULT',outcome:'verified',seq:4,at:later(5)})
  ];
  const p=projectAuraLiveWorkspace(events,{missionId:'m1',now:Date.parse(AT)+10000});
  assert.equal(p.actionCount,3);
  assert.deepEqual(new Set(p.surfaces.map(s=>s.id)),new Set(['code','browser','tests']));
  assert.equal(p.surfaces.find(s=>s.id==='browser').primary.state,'RUNNING');
  assert.equal(p.surfaces.find(s=>s.id==='code').primary.state,'VERIFIED');
  assert.equal(p.surfaces.find(s=>s.id==='tests').primary.state,'RUNNING');
});

test('the presentation never confuses failures, unknown outcomes and unverified receipts',()=>{
  const events=[
    create({actionId:'failure',type:'shell',phase:'NOVA_ACTION_RESULT',seq:1,outcome:'failed'}),
    create({actionId:'unknown',type:'repo-read',phase:'NOVA_ACTION_RESULT',seq:2,outcome:'unknown'}),
    create({actionId:'unchecked',type:'repo-test',phase:'NOVA_ACTION_RESULT',seq:3,outcome:'unverified'})
  ];
  const p=projectAuraLiveWorkspace(events,{missionId:'m1'});
  assert.equal(p.surfaces.find(s=>s.id==='terminal').primary.state,'FAILED');
  assert.equal(p.surfaces.find(s=>s.id==='code').primary.state,'UNKNOWN');
  assert.equal(p.surfaces.find(s=>s.id==='tests').primary.state,'UNVERIFIED');
});

test('connection loss and old starts do not claim live activity or replay a tool',()=>{
  const e=create();
  assert.equal(projectAuraLiveWorkspace([e],{connection:'reconnecting',now:Date.parse(AT)+1000}).surfaces[0].primary.state,'OBSERVATION_INTERRUPTED');
  assert.equal(projectAuraLiveWorkspace([e],{connection:'live',now:Date.parse(AT)+500000}).surfaces[0].primary.state,'NO_RECENT_OBSERVATION');
});

test('mission identity prevents unrelated tool actions from leaking into the active mission',()=>{
  const a=create({missionId:'m1',actionId:'same',seq:1});
  const b=create({missionId:'m2',actionId:'same',seq:2,type:'browser-click'});
  const scoped=projectAuraLiveWorkspace([a,b],{missionId:'m1'});
  assert.equal(scoped.actionCount,1);
  assert.deepEqual(scoped.surfaces.map(s=>s.id),['code']);
  assert.equal(projectAuraLiveWorkspace([a,b]).actionCount,2);
});

test('durable receipts win even when a later volatile duplicate claims a different outcome',()=>{
  const durable=create({phase:'NOVA_ACTION_RESULT',outcome:'verified',at:later(1),durable:true});
  const volatile=create({phase:'NOVA_ACTION_RESULT',outcome:'failed',at:later(10),durable:false});
  const result=projectAuraLiveWorkspace([durable,volatile],{now:Date.parse(AT)+20000});
  assert.equal(result.surfaces[0].primary.state,'VERIFIED');
  assert.equal(result.surfaces[0].primary.durable,true);
});

test('pinning changes presentation priority but never execution truth',()=>{
  const a=create({type:'repo-read',actionId:'a',seq:1});
  const b=create({type:'browser-click',actionId:'b',seq:2});
  const p=projectAuraLiveWorkspace([a,b],{pinnedSurface:'code',now:Date.parse(AT)+1000});
  assert.equal(p.surfaces[0].id,'code');
  assert.equal(p.actionCount,2);
  assert.equal(p.surfaces[1].primary.state,'RUNNING');
});

test('tool identity is bounded, contains no arguments and uses existing events',()=>{
  const raw=toCognitiveEvent({
    id:'start',at:AT,type:'NOVA_ACTION_STARTED',missionId:'m1',
    payload:{action:{id:'a',type:'repo-test',data:{secret:'do-not-expose'}},say:'Running checks'}
  });
  assert.equal(raw.toolType,'repo-test');
  assert.equal(JSON.stringify(raw).includes('do-not-expose'),false);
  assert.equal(surfaceForAuraTool(raw.toolType),'tests');
  assert.equal(surfaceForAuraTool('git-status'),'git');
  assert.equal(surfaceForAuraTool('browser-click'),'browser');
  assert.equal(surfaceForAuraTool('terminal-exec'),'terminal');
  assert.equal(surfaceForAuraTool('unknown-task'),'tools');
});

test('Aura can inspect causal links through its existing read-only toolbox without gaining mutation tools',async()=>{
  let writes=0;
  const observed={schema:'jaco.aura-causal-context/v1',links:[{graphId:'g1',nodeKey:'n1',actionId:'a1'}]};
  const toolbox=cognitiveQuestionToolbox({tools:{
    causal_workspace:{description:'inspect',run:async()=>observed},
    start_goal:{description:'mutate',run:async()=>{writes++;}},
    mcp_tool:{description:'mutate',run:async()=>{writes++;}},
  }},()=>({events:[]}));
  assert.deepEqual(await toolbox.tools.causal_workspace.run({}),observed);
  assert.equal(toolbox.tools.start_goal,undefined);
  assert.equal(toolbox.tools.mcp_tool,undefined);
  assert.equal(writes,0);
});
