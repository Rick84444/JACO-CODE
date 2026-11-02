import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { synchronizeAuraHarnessModel, auraHarnessPlannerProtocol } from '../../agents/lib/aura-harness-model-choice.mjs';
import { readPlannerChoice, writePlannerChoice } from '../../agents/lib/planner-choice.mjs';

function setup(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aura-harness-routing-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return path.join(root,'state','provider-preference.json');
}
const local = { providerId:'ollama', model:'gemma3:4b' };
const env = { OLLAMA_MODEL:'gemma3:4b', JACO_ALLOW_PAID_MODELS:'0' };

test('an explicit Aura choice is persisted once; the next goal reuses that same model',async t=>{
  const file=setup(t);
  let probes=0;
  const first=await synchronizeAuraHarnessModel(local,{file,env,probe:async()=>{probes++;return {ok:true};}});
  assert.equal(first.synchronized,true);
  assert.equal(first.choice.provider,'ollama');
  assert.equal(first.choice.model,'gemma3:4b');
  assert.equal(first.verifiedText,true);
  assert.equal(first.verifiedToolCalling,false,'a text probe does not prove tool-call support');
  assert.deepEqual(readPlannerChoice(file).model,'gemma3:4b');
  const second=await synchronizeAuraHarnessModel(local,{file,env,probe:async()=>{probes++;return {ok:false};}});
  assert.equal(second.changed,false);
  assert.equal(probes,1,'same saved choice does not repeatedly spend on model probes');
});

test('failed or ungoverned model probes cannot overwrite a prior operator choice',async t=>{
  const file=setup(t);
  writePlannerChoice(file,{provider:'ollama',model:'gemma3:4b'},'operator');
  const different={providerId:'ollama',model:'gemma3:other'};
  const altEnv={...env,OLLAMA_MODEL:'gemma3:4b',JACO_OLLAMA_LOCAL_MODEL:'gemma3:other'};
  await assert.rejects(synchronizeAuraHarnessModel(different,{file,env:altEnv}),/PROBE_REQUIRED/);
  await assert.rejects(synchronizeAuraHarnessModel(different,{file,env:altEnv,probe:async()=>({ok:false})}),/TEXT_PROBE_FAILED/);
  assert.equal(readPlannerChoice(file).model,'gemma3:4b');
});

test('environment authority and model validations fail closed before dispatch',async t=>{
  const file=setup(t);
  await assert.rejects(synchronizeAuraHarnessModel(local,{file,env:{...env,JACO_PRIMARY_PROVIDER:'groq'},probe:async()=>({ok:true})}),/ENV_PRIMARY_AUTHORITATIVE/);
  await assert.rejects(synchronizeAuraHarnessModel({providerId:'ollama',model:'unknown'}, {file,env,probe:async()=>({ok:true})}),/PLANNER_MODEL_UNKNOWN/);
  await assert.rejects(synchronizeAuraHarnessModel({providerId:'ollama',model:'gemma3:4b',other:true}, {file,env,probe:async()=>({ok:true})}),/SELECTION_INVALID/);
  await assert.rejects(synchronizeAuraHarnessModel({providerId:'seer',model:'gemma3:4b'}, {file,env}),/SELECTION_INVALID/);
  assert.equal(readPlannerChoice(file),null);
});

test('existing callers and canonical model route preserve the current preference',async t=>{
  const file=setup(t);
  writePlannerChoice(file,{provider:'ollama',model:'gemma3:4b'},'operator');
  const untouched=await synchronizeAuraHarnessModel(undefined,{file,env});
  assert.equal(untouched.synchronized,false);
  assert.equal(untouched.choice.model,'gemma3:4b');
  assert.equal(readPlannerChoice(file).model,'gemma3:4b');
});

test('connected non-native provider is accepted only from existing runtime registry',async t=>{
  const file=setup(t);
  const chosen={providerId:'gemini',model:'gemini-2.5-flash'};
  const extra={gemini:{label:'Gemini',url:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',paid:false,keyEnv:null,models:['gemini-2.5-flash'],dynamic:true}};
  const result=await synchronizeAuraHarnessModel(chosen,{file,env,connectedChoices:extra,probe:async()=>({ok:true})});
  assert.equal(result.choice.model,'gemini-2.5-flash');
  assert.equal(readPlannerChoice(file).provider,'gemini');
});

test('UI and backend route share the selection rather than spawning another model gateway',()=>{
  const root=path.resolve(import.meta.dirname,'../..');
  const gui=fs.readFileSync(path.join(root,'runtime/src/components/AuraChatPanel.tsx'),'utf8');
  const parent=fs.readFileSync(path.join(root,'runtime/src/components/JacoAuraComputeIDE.tsx'),'utf8');
  const server=fs.readFileSync(path.join(root,'runtime/server.ts'),'utf8');
  const seer=fs.readFileSync(path.join(root,'gateway/src/seer.mjs'),'utf8');
  assert.match(gui,/selectedProvider === 'seer' \? undefined : \{providerId:selectedProvider,model:chatModel\}/);
  assert.match(parent,/\.\.\.\(harnessModel \? \{ harnessModel \} : \{\}\)/);
  assert.match(server,/await synchronizeAuraHarnessModel\(req\.body\.harnessModel/);
  assert.match(server,/testPlannerModel\(valid/);
  assert.match(seer,/const auraOnly = process\.env\.JACO_SEER_PROVIDER_PREFERENCE === 'aura' \|\| pinned/);
});

test('same chosen model falls back to structured planning protocol, not another provider',()=>{
  const pinned={name:'ollama',model:'gemma3:4b',chosen:true};
  assert.equal(auraHarnessPlannerProtocol(pinned,{nativeToolsAllowed:false}),'structured');
  assert.equal(auraHarnessPlannerProtocol(pinned,{nativeToolsRejected:true}),'structured');
  assert.equal(auraHarnessPlannerProtocol(pinned,{nativeToolsAllowed:true}),'native');
  assert.equal(auraHarnessPlannerProtocol({name:'ollama',model:'gemma3:4b'}, {nativeToolsAllowed:false}),'native',
    'automatic chains keep their legacy policies');
  const repo=path.resolve(import.meta.dirname,'../..');
  const runner=fs.readFileSync(path.join(repo,'agents/hands-off-agent.mjs'),'utf8');
  assert.match(runner,/selectedProtocol === 'native'/);
  assert.match(runner,/result\.deferred && unsupported/);
});
