import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { NovaMissionControl } from '../../runtime/src/server/connected/novaMissionControl.mjs';
import { normalizeCodingContract, validateCodingTask, assertCodingBudget, contractVerificationStatus } from '../../agents/lib/coding-contract.mjs';
import { createCodingWorkspace } from '../../agents/lib/coding-workspace.mjs';

const contractInput = {
  schema: 'jaco.coding-contract/v1',
  objective: 'Fix Nova safely',
  scope: { allowed: ['agents/**','tests/**'], forbidden: ['agents/private/**'] },
  acceptance: ['tests pass'],
  execution: { autonomous: true, allow_git_commit: true },
  verification: { tests_required: true, falsifier_required: true, commands: ['npm test','node --test tests/nova/coding-contract.test.mjs'] },
  budget: { max_steps: 6, max_tool_calls: 8, max_failures: 2 },
};

test('coding contract enforces scope, contracted commands and budgets', () => {
  const contract = normalizeCodingContract(contractInput);
  assert.equal(validateCodingTask({type:'repo-write',data:{path:'agents/lib/x.mjs',content:'x'}},contract).data.path,'agents/lib/x.mjs');
  assert.throws(()=>validateCodingTask({type:'repo-write',data:{path:'agents/private/key.txt',content:'x'}},contract),/CODING_SCOPE_DENIED/);
  assert.throws(()=>validateCodingTask({type:'repo-read',data:{path:'../outside'}},contract),/TRAVERSAL/);
  assert.doesNotThrow(()=>validateCodingTask({type:'repo-test',data:{command:'npm test',kind:'test'}},contract));
  assert.throws(()=>validateCodingTask({type:'repo-test',data:{command:'node --version'}},contract),/NOT_CONTRACTED/);
  assert.doesNotThrow(()=>assertCodingBudget(contract,{toolCallsUsed:3,stepsUsed:2,failures:0}));
  assert.throws(()=>assertCodingBudget(contract,{toolCallsUsed:8,stepsUsed:2,failures:0}),/TOOL_BUDGET/);
  const { budget }=normalizeCodingContract({...contractInput,budget:undefined});
  assert.deepEqual(budget,{max_steps:40,max_tool_calls:120,max_failures:3,max_duration_ms:2*60*60_000},'longer default runs (operator 2026-10-02)');
});

test('tests and falsifier must be newer than the latest write before commit', () => {
  const contract = normalizeCodingContract(contractInput);
  const oldTest={ok:true,verified:true,type:'repo-test',actionId:'m:turn:1',result:{kind:'test'}};
  const write={ok:true,verified:true,type:'repo-write',actionId:'m:turn:2',result:{}};
  const testReceipt={ok:true,verified:true,type:'repo-test',actionId:'m:turn:3',result:{kind:'test'}};
  const falsifierReceipt={ok:true,verified:true,type:'repo-test',actionId:'m:turn:4',result:{kind:'falsifier'}};
  assert.deepEqual(contractVerificationStatus(contract,[oldTest,write]).missing,['tests','falsifier','commit']);
  assert.doesNotThrow(()=>validateCodingTask({type:'git-commit',data:{message:'fix: nova'}},contract,[write,testReceipt,falsifierReceipt]));
});

test('Nova durable mission binds coding contract and gates completion', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-contract-'));
  const bus=new DurableMissionBus(dir);
  t.after(()=>{bus.close();fs.rmSync(dir,{recursive:true,force:true});});
  const control=new NovaMissionControl(bus,{allowedTasks:['repo-write','repo-test','git-commit']});
  const mission=control.create({goal:'Fix Nova',idempotencyKey:'coding-1',contract:contractInput});
  assert.equal(mission.contract.schema,'jaco.coding-contract/v1');
  let lease=control.claim(mission.id,'nova');
  assert.throws(()=>control.begin(mission.id,{owner:'nova',token:lease.token,task:{type:'repo-write',data:{path:'gateway/x.mjs',content:'x'}}}),/CODING_SCOPE_DENIED/);
  control.release(mission.id,{owner:'nova',token:lease.token,error:'scope rejected'});

  const finishTest = (kind, command) => {
    lease=control.claim(mission.id,'nova');
    const action=control.begin(mission.id,{owner:'nova',token:lease.token,task:{type:'repo-test',data:{command,kind}}});
    control.finish(mission.id,{owner:'nova',token:lease.token,actionId:action.id,receipt:{ok:true,verified:true,result:{kind}}});
  };
  finishTest('test','npm test');
  finishTest('falsifier','node --test tests/nova/coding-contract.test.mjs');

  lease=control.claim(mission.id,'nova');
  const commit=control.begin(mission.id,{owner:'nova',token:lease.token,task:{type:'git-commit',data:{message:'feat: coding contract'}}});
  control.finish(mission.id,{owner:'nova',token:lease.token,actionId:commit.id,receipt:{ok:true,verified:true,result:{commit:'abc'}}});
  lease=control.claim(mission.id,'nova');
  assert.equal(control.release(mission.id,{owner:'nova',token:lease.token,completionProposed:true}).status,'AWAITING_VERIFICATION');
  assert.equal(control.resolve(mission.id,{decision:'confirm',note:'acceptance reviewed'}).status,'DONE');
});

test('an operator resume starts a fresh budget window; an automated resume does not', t => {
  // Live 2026-10-01: a mission created two days earlier was resumed nine times and re-blocked on
  // CODING_CONTRACT_DURATION_EXCEEDED every time, because the window ran from mission creation.
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-contract-resume-'));
  const bus=new DurableMissionBus(dir);
  t.after(()=>{bus.close();fs.rmSync(dir,{recursive:true,force:true});});
  let now=Date.now();
  const control=new NovaMissionControl(bus,{allowedTasks:['repo-test'],now:()=>now});
  const mission=control.create({goal:'Fix Nova',idempotencyKey:'coding-resume',contract:{...contractInput,budget:{...contractInput.budget,max_duration_ms:60_000}}});
  const tryBegin=()=>{
    const lease=control.claim(mission.id,'nova');
    try { return control.begin(mission.id,{owner:'nova',token:lease.token,task:{type:'repo-test',data:{command:'npm test',kind:'test'}}}); }
    catch (error) { control.release(mission.id,{owner:'nova',token:lease.token,error:error.message}); throw error; }
  };
  now+=10*60_000;
  const first=tryBegin(); // ten minutes queued before the first claim do not count against 60 s
  const { token }=control.db.prepare('SELECT token FROM nova_sessions WHERE mission_id=?').get(mission.id);
  control.finish(mission.id,{owner:'nova',token,actionId:first.id,receipt:{ok:true,verified:true,result:{kind:'test'}}});
  now+=120_000;
  assert.throws(tryBegin,/CODING_CONTRACT_DURATION_EXCEEDED/);
  assert.equal(control.get(mission.id).status,'BLOCKED');
  control.resolve(mission.id,{decision:'resume',note:'auto-resumed (level 3): recoverable failure'});
  assert.throws(tryBegin,/CODING_CONTRACT_DURATION_EXCEEDED/,'an automated resume must not extend the budget');
  control.resolve(mission.id,{decision:'resume',note:'Operator decision from Aura Approval Center: resume'});
  assert.equal(tryBegin().type,'repo-test');
});

test('a contract that allows commits is not complete until the verified change is committed', () => {
  // Live 2026-09-30: Nova proposed completion with its verified change left uncommitted.
  const contract = normalizeCodingContract(contractInput);
  const write={ok:true,verified:true,type:'repo-write',actionId:'m:turn:1',result:{}};
  const testReceipt={ok:true,verified:true,type:'repo-test',actionId:'m:turn:2',result:{kind:'test'}};
  const falsifierReceipt={ok:true,verified:true,type:'repo-test',actionId:'m:turn:3',result:{kind:'falsifier'}};
  const commit={ok:true,verified:true,type:'git-commit',actionId:'m:turn:4',result:{commit:'abc'}};
  assert.deepEqual(contractVerificationStatus(contract,[write,testReceipt,falsifierReceipt]).missing,['commit']);
  assert.doesNotThrow(()=>validateCodingTask({type:'git-commit',data:{message:'fix: x'}},contract,[write,testReceipt,falsifierReceipt]),'the missing commit must not block the commit itself');
  assert.equal(contractVerificationStatus(contract,[write,testReceipt,falsifierReceipt,commit]).machineVerified,true);
  assert.equal(contractVerificationStatus(contract,[testReceipt,falsifierReceipt]).missing.includes('commit'),false,'nothing written, nothing to commit');
  const defaulted=normalizeCodingContract({...contractInput,execution:{autonomous:true}});
  assert.equal(contractVerificationStatus(defaulted,[write,testReceipt,falsifierReceipt]).missing.includes('commit'),false,'a default commit permission does not require a commit');
});

test('coding missions default to code tasks plus read-only context, not browser or desktop control', t => {
  // A live coding mission clicked GitHub "Add file" in an open browser tab instead of using repo-write.
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-contract-default-'));
  const bus=new DurableMissionBus(dir);
  t.after(()=>{bus.close();fs.rmSync(dir,{recursive:true,force:true});});
  const control=new NovaMissionControl(bus);
  const coding=control.create({goal:'Fix Nova',idempotencyKey:'coding-default',contract:contractInput}).allowedTasks;
  for (const task of ['repo-write','repo-test','git-commit','web-fetch']) assert.ok(coding.includes(task),task);
  assert.equal(coding.some(task=>/browser|desktop|android|lawnmower|click|type/.test(task)),false,coding.join(','));
  const plain=control.create({goal:'Check status',idempotencyKey:'plain-default'}).allowedTasks;
  assert.equal(plain.some(task=>['repo-write','repo-test','git-commit'].includes(task)),false);
  assert.ok(plain.length>coding.filter(task=>!['repo-write','repo-test','git-commit','repo-read'].includes(task)).length,'non-coding missions keep their wider default');
});

test('a missing coding root fails code tasks with a reason instead of crashing at creation', async () => {
  // Live 2026-09-30: the jaco-nova worktree disappeared and Nova could not even be imported.
  const gone = path.join(os.tmpdir(), `jaco-missing-root-${Date.now()}`);
  const workspace = createCodingWorkspace({ root: gone });
  assert.equal(workspace.missing, true);
  const contract = normalizeCodingContract(contractInput);
  await assert.rejects(workspace.execute({ type: 'repo-read', data: { path: 'agents/x.mjs' } }, contract), /CODING_ROOT_MISSING/);
});

test('coding workspace commits only contracted paths', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-code-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  execFileSync('git',['init'],{cwd:dir});
  execFileSync('git',['config','user.email','test@example.com'],{cwd:dir});
  execFileSync('git',['config','user.name','JACO Test'],{cwd:dir});
  fs.mkdirSync(path.join(dir,'agents'),{recursive:true});
  fs.writeFileSync(path.join(dir,'agents','a.mjs'),'export const a=1;\n');
  fs.writeFileSync(path.join(dir,'outside.txt'),'leave me\n');
  execFileSync('git',['add','.'],{cwd:dir});
  execFileSync('git',['commit','-m','base'],{cwd:dir});
  const contract=normalizeCodingContract({objective:'edit',scope:{allowed:['agents/**']},acceptance:['pass'],execution:{allow_git_commit:true},verification:{tests_required:true,commands:['node --check agents/a.mjs']}});
  const workspace=createCodingWorkspace({root:dir});
  await workspace.execute({type:'repo-write',data:{path:'agents/a.mjs',content:'export const a=2;\n'}},contract,{actor:'nova'});
  fs.writeFileSync(path.join(dir,'outside.txt'),'unrelated\n');
  const result=await workspace.execute({type:'repo-test',data:{command:'node --check agents/a.mjs',kind:'test'}},contract,{actor:'nova'});
  const testReceipt={ok:true,verified:true,type:'repo-test',result};
  const committed=await workspace.execute({type:'git-commit',data:{message:'fix: scoped'}},contract,{actor:'nova',receipts:[testReceipt]});
  assert.equal(committed.files.includes('agents/a.mjs'),true);
  assert.equal(execFileSync('git',['status','--short'],{cwd:dir,encoding:'utf8'}).trim(),'M outside.txt');
});


test('coding workspace includes already-staged contracted paths without absorbing unrelated staged files', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-code-staged-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  execFileSync('git',['init'],{cwd:dir});
  execFileSync('git',['config','user.email','test@example.com'],{cwd:dir});
  execFileSync('git',['config','user.name','JACO Test'],{cwd:dir});
  fs.mkdirSync(path.join(dir,'agents'),{recursive:true});
  fs.writeFileSync(path.join(dir,'agents','a.mjs'),'export const a=1;\n');
  fs.writeFileSync(path.join(dir,'outside.txt'),'base\n');
  execFileSync('git',['add','.'],{cwd:dir});
  execFileSync('git',['commit','-m','base'],{cwd:dir});

  fs.writeFileSync(path.join(dir,'agents','a.mjs'),'export const a=2;\n');
  fs.writeFileSync(path.join(dir,'outside.txt'),'staged but unrelated\n');
  execFileSync('git',['add','agents/a.mjs','outside.txt'],{cwd:dir});

  const contract=normalizeCodingContract({
    objective:'commit staged scoped change',
    scope:{allowed:['agents/**']},
    acceptance:['syntax passes'],
    execution:{allow_git_commit:true},
    verification:{tests_required:true,commands:['node --check agents/a.mjs']},
  });
  const workspace=createCodingWorkspace({root:dir});
  const result=await workspace.execute({type:'repo-test',data:{command:'node --check agents/a.mjs',kind:'test'}},contract,{actor:'nova'});
  const committed=await workspace.execute(
    {type:'git-commit',data:{message:'fix: staged scoped'}},
    contract,
    {actor:'nova',receipts:[{ok:true,verified:true,type:'repo-test',result}]},
  );

  assert.deepEqual(committed.files,['agents/a.mjs']);
  assert.match(committed.commit,/^[0-9a-f]{40}$/);
  assert.match(committed.tree,/^[0-9a-f]{40}$/);
  assert.match(committed.remainingChanges,/outside\.txt/);
  assert.equal(execFileSync('git',['show','--name-only','--format=',committed.commit],{cwd:dir,encoding:'utf8'}).trim(),'agents/a.mjs');
  assert.match(execFileSync('git',['diff','--cached','--name-only'],{cwd:dir,encoding:'utf8'}),/outside\.txt/);
});
