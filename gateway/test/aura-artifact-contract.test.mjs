import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { auraArtifactContract } from '../src/aura-artifact-contract.mjs';
import { createMissionGraph } from '../src/seer-mission-graph.mjs';
import { createCodingWorkspace } from '../../agents/lib/coding-workspace.mjs';
import { normalizeCodingContract, isPathAllowed } from '../../agents/lib/coding-contract.mjs';
import { NovaMissionControl } from '../../runtime/src/server/connected/novaMissionControl.mjs';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';

test('Aura can create nested Markdown files without a selected IDE project or a synthetic shell capability', async t => {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-aura-artifact-'));
  const db=new DatabaseSync(':memory:');
  const bus=new DurableMissionBus(path.join(base,'bus'));
  t.after(()=>{db.close();bus.close();fs.rmSync(base,{recursive:true,force:true});});
  let sequence=0;
  const graph=createMissionGraph({db,uid:()=>String(++sequence),now:()=>Date.now()});
  const contract=auraArtifactContract({
    goal:'Research opportunities and create Markdown files',
    objective:'Create a market report in Markdown',
    nodeTitle:'Create market report',
  });
  const created=graph.create({title:'Capital mission',objective:'Research opportunities and create Markdown files',
    policy:{primary_agent:'aura',strategy_capability:'aura.strategy',execution_capability:'aura.execution'},
    nodes:[{key:'report',title:'Market research report',objective:'Create a Markdown research report',contract}]});
  const spec=graph.dispatchSpec(created.id,'report');
  assert.equal(spec.parent.agent,undefined,'ordinary Aura steps must not fabricate subagents');
  const control=new NovaMissionControl(bus,{allowedTasks:['repo-list','repo-read','repo-write','repo-edit','web-fetch','mcp-call']});
  const mission=control.create(spec);
  assert.ok(mission.allowedTasks.includes('repo-write'), 'file writes are visible to Aura before planning');
  assert.equal(mission.metadata.authority,'AURA');
  assert.equal(mission.metadata.primaryAgent,'aura');
  const normalized=normalizeCodingContract(contract);
  assert.equal(isPathAllowed(normalized,'artifacts/aura/market/report.md'),true);
  assert.equal(isPathAllowed(normalized,'runtime/server.ts'),false);
  const root=path.join(base,'workspace');
  fs.mkdirSync(root);
  const workspace=createCodingWorkspace({root});
  const output=await workspace.execute({type:'repo-write',data:{
    path:'artifacts/aura/market/report.md',content:'# Research\n\nSource-backed results pending.\n',
  }},mission.contract);
  assert.equal(output.ok,true);
  assert.equal(output.verified,true);
  assert.ok(fs.existsSync(path.join(root,'artifacts','aura','market','report.md')));
  assert.equal((await workspace.execute({type:'repo-read',data:{path:'artifacts/aura/market/report.md'}},mission.contract)).content,'# Research\n\nSource-backed results pending.\n');
  await assert.rejects(workspace.execute({type:'repo-write',data:{path:'runtime/server.ts',content:'no'}},mission.contract),/SCOPE_DENIED/);
  assert.equal(mission.contract.execution.allow_git_push,false);
  assert.equal(mission.contract.verification.tests_required,false);
});

test('Aura may not turn an explicitly observation-only or no-write goal into a writable contract',()=>{
  assert.equal(auraArtifactContract({goal:'Read the files only, do not edit files',objective:'Document findings'}),null);
  assert.equal(auraArtifactContract({goal:'Create documents',observationOnly:true}),null);
  const contract=normalizeCodingContract(auraArtifactContract({goal:'Create documents',objective:'Write Markdown'}));
  assert.equal(isPathAllowed(contract,'artifacts/aura/report.md'),true);
  assert.equal(isPathAllowed(contract,'.env'),false);
  assert.equal(isPathAllowed(contract,'artifacts/aura/.env'),false);
  assert.throws(()=>isPathAllowed(contract,'../secrets.txt'),/CONTRACT_PATH_TRAVERSAL/);
});

test('existing no-contract Nova missions remain read-only and do not acquire write authority',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-aura-read-'));
  const bus=new DurableMissionBus(root);
  t.after(()=>{bus.close();fs.rmSync(root,{recursive:true,force:true});});
  const control=new NovaMissionControl(bus,{allowedTasks:['repo-read','repo-write','web-fetch']});
  const mission=control.create({goal:'Research only',idempotencyKey:'read-only'});
  assert.equal(mission.allowedTasks.includes('repo-write'),false);
  assert.equal(mission.contract,null);
});
