import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { NovaMissionControl } from '../../runtime/src/server/connected/novaMissionControl.mjs';
import { boardColumn, buildAgentBoard } from '../../runtime/src/server/connected/auraAgentBoard.mjs';

const workplace = { reachable: true, agents: [{ agentId: 'agent:a', name: 'Nova', status: 'READY', liveSessions: 1, lastSeenAt: '2026-10-05T00:00:00Z', permissions: { read: true }, sessionToken: 'must-never-cross' }] };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-board-'));
  const bus = new DurableMissionBus(root), control = new NovaMissionControl(bus);
  t.after(() => { bus.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { bus, control };
}
test('board distinguishes canonical statuses, uncertain phases and cancellation', () => {
  for (const [status,phase,column] of [['ACTIVE','READY','queue'],['ACTIVE','PLANNING','running'],['ACTIVE','EXECUTING','running'],['ACTIVE',null,'unknown'],['BLOCKED','BLOCKED','blocked'],['AWAITING_VERIFICATION','AWAITING_VERIFICATION','review'],['DONE','CLOSED','done'],['CANCELLED','CLOSED','cancelled'],['invented','READY','unknown']]) assert.equal(boardColumn(status,phase),column);
});
test('counts include every stored mission while list is bounded to 200', t => {
  const {bus,control}=fixture(t);
  for(let i=0;i<205;i++) bus.createMission({goal:`Goal ${i}`});
  const result=buildAgentBoard({bus,control,workplace});
  assert.equal(result.total,205); assert.equal(result.missions.length,200); assert.equal(result.truncated,true);
  assert.equal(Object.values(result.statusCounts).reduce((a,b)=>a+b,0),205);
  assert.equal(result.missions[0].detailError,'SESSION_DETAILS_UNAVAILABLE');
  assert.equal(result.missions[0].agentId,null);
});
test('safe projection preserves step evidence without asserting goal acceptance or exposing credentials', t => {
  const {bus,control}=fixture(t);
  const base=bus.createMission({goal:'Inspect token=private-value and deployed-secret',metadata:{executor:'nova',sessionToken:'hidden'}});
  const full={...base,phase:'READY',receipts:[{ok:true,verified:true,type:'web-fetch',expectedOutcome:'Read docs',sessionToken:'hidden',result:{status:200,content:'huge SECRET',token:'hidden'},at:'2026-10-05T00:00:00Z'}]};
  const result=buildAgentBoard({bus,control:{get:()=>full},workplace,secrets:['deployed-secret']});
  const wire=JSON.stringify(result);
  for(const secret of ['private-value','deployed-secret','must-never-cross','huge SECRET','sessionToken']) assert.ok(!wire.includes(secret),secret);
  assert.equal(result.missions[0].lastResult.verified,true);
  assert.equal(result.missions[0].lastResult.result.status,200);
  assert.equal(result.missions[0].status,base.status);
  assert.equal(result.missions[0].contractStatus,null);
  assert.equal(result.missions[0].agentId,null);
});
test('unavailable sources remain unknown rather than healthy empty states', t => {
  const {bus,control}=fixture(t);
  let result=buildAgentBoard({bus,control,workplace:{reachable:false}});
  assert.equal(result.sources.workplace.available,false);
  result=buildAgentBoard({bus:{missionStatusCounts(){throw Error('credential=private');}},control,workplace});
  assert.equal(result.sources.missions.available,false); assert.equal(result.total,null);
  assert.ok(!JSON.stringify(result).includes('private'));
});
test('team counts live identities once and does not count offline work reports',t=>{
  const {bus,control}=fixture(t);
  const result=buildAgentBoard({bus,control,workplace:{reachable:true,agents:[
    {agentId:'a',name:'Nova',status:'BUSY',liveSessions:2,sessions:[{status:'BUSY'},{status:'READY'}]},
    {agentId:'b',name:'SEER',status:'READY',liveSessions:1,sessions:[{status:'READY'}]},
    {agentId:'c',name:'Old Codex',status:'BUSY',liveSessions:0,sessions:[{status:'OFFLINE'}]},
  ]}});
  assert.deepEqual(result.summary,{connected:2,reportingWork:1,offline:1,activeMissions:0});
  assert.equal(buildAgentBoard({bus,control,workplace:{reachable:false}}).summary,null);
});
