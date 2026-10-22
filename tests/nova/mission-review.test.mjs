import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createMissionWorktrees } from '../../agents/lib/mission-worktree.mjs';
import { normalizeCodingContract } from '../../agents/lib/coding-contract.mjs';
import { readMissionReview } from '../../runtime/src/server/connected/missionReview.mjs';

const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-review-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const project=path.join(root,'project'),stateDir=path.join(root,'state');fs.mkdirSync(project);
 git(project,'init','-q');git(project,'config','user.name','Review fixture');git(project,'config','user.email','fixture@example.test');
 fs.writeFileSync(path.join(project,'code.mjs'),'export const value = 1;\n');git(project,'add','.');git(project,'commit','-qm','baseline');
 const worktrees=createMissionWorktrees({stateDir});
 const mission={id:'m-review',goal:'Update the value',status:'AWAITING_VERIFICATION',phase:'READY',metadata:{projectRoot:project},contract:normalizeCodingContract({objective:'Update the value',acceptance:['The requested value is updated'],scope:{allowed:['**']}}),contractStatus:{machineVerified:true,missing:[]},receipts:[{actionId:'test-1',type:'repo-test',ok:true,verified:true,at:'2026-10-20T00:00:00Z',input:{command:'node --test'},result:{output:'actual recorded test output'}}]};
 return {root,project,stateDir,worktrees,mission};
}
test('review reads committed, unstaged and new mission files without modifying the operator project',t=>{
 const {project,stateDir,worktrees,mission}=fixture(t);
 const work=worktrees.ensure({projectRoot:project,missionId:mission.id});
 fs.writeFileSync(path.join(work.path,'code.mjs'),'export const value = 2;\n');git(work.path,'add','.');git(work.path,'commit','-qm','agent change');
 fs.writeFileSync(path.join(work.path,'new.mjs'),'export const extra = true;\n');
 const summary=readMissionReview({mission,projectRoot:project,worktrees});
 assert.equal(summary.workspace.state,'READY');assert.deepEqual(summary.workspace.files.map(f=>f.path),['code.mjs','new.mjs']);
 const tracked=readMissionReview({mission,projectRoot:project,worktrees,file:'code.mjs'});assert.match(tracked.patch.content,/\+export const value = 2/);
 const newFile=readMissionReview({mission,projectRoot:project,worktrees,file:'new.mjs'});assert.match(newFile.patch.content,/\+export const extra = true/);
 assert.equal(fs.readFileSync(path.join(project,'code.mjs'),'utf8'),'export const value = 1;\n');assert.equal(git(project,'status','--porcelain'),'');
 assert.equal(summary.verificationScope,'RECORDED_MISSION_RECEIPTS');assert.equal(summary.tests[0].output,'actual recorded test output');
 const reopened=createMissionWorktrees({stateDir});assert.equal(readMissionReview({mission,projectRoot:project,worktrees:reopened,file:'code.mjs'}).patch.content,tracked.patch.content);
});
test('review refuses another project, unrelated worktrees, path escapes and protected files',t=>{
 const {root,project,stateDir,worktrees,mission}=fixture(t);const work=worktrees.ensure({projectRoot:project,missionId:mission.id});
 fs.writeFileSync(path.join(work.path,'.env'),'PRIVATE=value');fs.writeFileSync(path.join(work.path,'code.mjs'),'changed');
 const summary=readMissionReview({mission,projectRoot:project,worktrees});assert.equal(summary.workspace.hiddenFiles,1);
 for(const file of ['../code.mjs','.env','missing.mjs'])assert.throws(()=>readMissionReview({mission,projectRoot:project,worktrees,file}),/FILE_NOT_FOUND/);
 assert.throws(()=>readMissionReview({mission,projectRoot:root,worktrees}),/PROJECT_MISMATCH/);
 git(work.path,'checkout','-qb','unrelated-branch');assert.throws(()=>worktrees.inspect({projectRoot:project,missionId:mission.id}),/WORKTREE_MISMATCH/);
 fs.rmSync(work.path,{recursive:true,force:true});const outside=path.join(root,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(stateDir,'worktrees',mission.id));
 assert.throws(()=>worktrees.inspect({projectRoot:project,missionId:mission.id}),/LINK_DENIED/);
});
test('opening a review never creates a missing worktree and secret redaction precedes patch delivery',t=>{
 const {project,stateDir,worktrees,mission}=fixture(t);
 const missing=readMissionReview({mission,projectRoot:project,worktrees});assert.equal(missing.workspace.state,'NOT_CREATED');assert.equal(fs.existsSync(stateDir),false);
 const work=worktrees.ensure({projectRoot:project,missionId:mission.id});const secret='sk-proj-'+'A'.repeat(55);
 fs.writeFileSync(path.join(work.path,'code.mjs'),`const token = '${secret}';\n`);
 const observed=readMissionReview({mission,projectRoot:project,worktrees,file:'code.mjs'});assert.ok(!observed.patch.content.includes(secret));
});
