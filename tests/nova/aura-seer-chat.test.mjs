import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { auraChatViaSeer, buildAuraSeerPrompts, AURA_CANONICAL_OBJECTIVE, renderAuraToolTranscript, summarizeAuraModelCosts } from '../../agents/lib/aura-seer-chat.mjs';
import { seerCompletion, seerCompletionResult } from '../../agents/lib/seer-client.mjs';

const root=process.cwd();
const TOKEN='test-token-12345678901234567890';

function withEnv(values, fn){
  const before={};
  for(const [key,value] of Object.entries(values)){
    before[key]=process.env[key];
    if(value===undefined) delete process.env[key];
    else process.env[key]=value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(()=>{
      for(const [key,value] of Object.entries(before)){
        if(value===undefined) delete process.env[key];
        else process.env[key]=value;
      }
    });
}

test('Aura chat bridge sends bounded conversation context through canonical SEER brain', async()=>{
  await withEnv({JACO_GATEWAY_TOKEN:TOKEN,SEER_URL:'http://127.0.0.1:2997'}, async()=>{
    let seenUrl='', seenHeaders, seenBody;
    const out=await auraChatViaSeer({
      message:'Hej Aura',
      activeFilePath:'src/server.ts',
      targetSubAgent:'nova',
      persona:'architectural',
      messagesHistory:[
        {role:'user',parts:[{text:'Tidigare fråga'}]},
        {role:'model',parts:[{text:'Tidigare svar'}]},
      ],
      ragContext:'Verifierad projektanteckning: SEER äger strategi.',
    }, async(url,opts)=>{
      seenUrl=String(url);seenHeaders=opts.headers;seenBody=JSON.parse(opts.body);
      return {ok:true,status:200,async json(){return {ok:true,text:'Hej från Gemma',provider:'litert',model:'gemma4-e4b',local:true};}};
    });
    assert.equal(seenUrl,'http://127.0.0.1:2997/cortex/brain');
    assert.equal(seenHeaders.Authorization,`Bearer ${TOKEN}`);
    // Aura brings live state itself; SEER's memory block is kept small so a CPU model answers in time.
    assert.equal(seenBody.memory_chars,1500);
    assert.match(seenBody.system,/Aura/);
    assert.match(seenBody.system,/CANONICAL_OBJECTIVE/);
    assert.match(seenBody.system,new RegExp(AURA_CANONICAL_OBJECTIVE.slice(0,40)));
    assert.doesNotMatch(seenBody.system,/<think>|chain-of-thought/i);
    assert.match(seenBody.user,/Tidigare fråga/);
    assert.match(seenBody.user,/ACTIVE_FILE: src\/server\.ts/);
    assert.match(seenBody.user,/WORKSPACE_AND_TOOL_CONTEXT/);
    assert.match(seenBody.user,/SEER äger strategi/);
    assert.equal(out.reply,'Hej från Gemma');
    assert.equal(out.provider,'litert');
    assert.equal(out.model,'gemma4-e4b');
    assert.equal(out.local,true);
    assert.equal(out.modelUsed,'litert/gemma4-e4b');
    assert.equal(out.objective,AURA_CANONICAL_OBJECTIVE);
    assert.deepEqual(out.subAgentDispatches,[]);
  });
});

test('SEER client keeps text-only compatibility while exposing truthful metadata', async()=>{
  await withEnv({JACO_GATEWAY_TOKEN:TOKEN}, async()=>{
    const fake=async()=>({ok:true,status:200,async json(){return {ok:true,text:' answer ',provider:'ollama',model:'qwen',local:true};}});
    const result=await seerCompletionResult({system:'s',user:'u'},fake);
    assert.equal(result.text,'answer');
    assert.equal(result.provider,'ollama');
    assert.equal(await seerCompletion({system:'s',user:'u'},fake),'answer');
  });
});

test('Aura exposes one active chat surface and routes it through canonical SEER',()=>{
  const server=fs.readFileSync(path.join(root,'runtime/server.ts'),'utf8');
  const app=fs.readFileSync(path.join(root,'runtime/src/App.tsx'),'utf8');
  const panel=fs.readFileSync(path.join(root,'runtime/src/components/AuraChatPanel.tsx'),'utf8');

  assert.match(server,/auraChatViaSeer/);
  assert.doesNotMatch(app,/JacoAgentChatbot/);
  assert.doesNotMatch(app,/FloatingAuraAssistant/);
  assert.doesNotMatch(app,/<AgentConsole/);
  assert.match(app,/<JacoAuraComputeIDE \/>/);
  assert.match(panel,/\/api\/aura\/chat/);
  assert.match(panel,/Starta uppdrag/);
  assert.match(panel,/interactionMode: runMode === 'planning' \? 'planning' : 'question'/);
  assert.match(panel,/initialAuraRunMode/);
  assert.match(server,/normalizeAuraChatMode/);
  assert.match(server,/cognitiveQuestionToolbox/);
  assert.match(panel,/jaco:aura:prefill/);
});
test('Aura setup guidance requires consent, keeps secrets out of generic tools and separates offers from execution',()=>{
  const {system}=buildAuraSeerPrompts({message:'Hjälp mig koppla upp JACO'});
  assert.match(system,/\/connect\.html/);
  assert.match(system,/Never read \.env with repo_read, shell/);
  assert.match(system,/outside the model context, chat history/);
  assert.match(system,/Sign-in, passwords, MFA and CAPTCHA are done by the operator/);
  assert.match(system,/A question or an offer is not a completed mission/);
  assert.match(system,/start_goal only when the operator has ordered the work/);
  assert.match(system,/Manual\/Planning are always read-only/);
  assert.match(system,/Never promise that a larger model will be faster/);
});

test('Aura structured workspace and selected-tool context survives prompt construction',()=>{
  const {user}=buildAuraSeerPrompts({
    message:'använd verktyget',
    activeFilePath:'src/x.ts',
    targetSubAgent:'Desktop AgentOS',
    ragContext:[
      {source:'src/x.ts',content:'export const x = 42;'},
      {source:'jaco://tool/desktop-observe',content:{kind:'agent',toolName:'desktop-observe',authorityNote:'context only'}},
    ],
  });
  assert.match(user,/export const x = 42/);
  assert.match(user,/desktop-observe/);
  assert.match(user,/REQUESTED_TARGET_TOOL_PROVIDER: Desktop AgentOS/);
  assert.doesNotMatch(user,/\[object Object\]/);
});


test('Aura canonical strategic goal replaces legacy primary goals without PODAR auto-completion',()=>{
  for (const file of [
    path.join(root,'runtime/src/auraEngine.ts'),
  ]) {
    const source=fs.readFileSync(file,'utf8');
    assert.match(source,/AURA_CANONICAL_GOAL_ID = "aura-canonical-objective-v1"/);
    assert.match(source,/Verifiable autonomous IDE surface from goal to receipt/);
    assert.match(source,/legacyIds = new Set\(\["goal-1", "goal-2", "goal-3"\]\)/);
    assert.match(source,/status: "paused"/);
    assert.match(source,/g\.id !== AURA_CANONICAL_GOAL_ID/);
    assert.match(source,/target-host evidence; source\/CI evidence alone is insufficient/);
  }
});


test('SEER client accepts SEER_TOKEN alias without exposing credentials', async()=>{
  await withEnv({JACO_GATEWAY_TOKEN:undefined,GATEWAY_TOKEN:undefined,SEER_TOKEN:TOKEN}, async()=>{
    let auth='';
    const fake=async(_url,opts)=>{
      auth=opts.headers.Authorization;
      return {ok:true,status:200,async json(){return {ok:true,text:'alias-ok',provider:'litert',model:'gemma4-e4b',local:true};}};
    };
    const result=await seerCompletionResult({system:'s',user:'u'},fake);
    assert.equal(auth,`Bearer ${TOKEN}`);
    assert.equal(result.text,'alias-ok');
  });
});

test('Aura chat responses do not embed the full legacy Aura state',()=>{
  const source=fs.readFileSync(path.join(root,'runtime/server.ts'),'utf8');
  const start=source.indexOf('app.post("/api/aura/chat"');
  const end=source.indexOf('\n  app.',start+20);
  assert.ok(start>=0 && end>start);
  const route=source.slice(start,end);
  assert.doesNotMatch(route,/res\.json\(\{ \.\.\.result, auraState \}\)/);
  assert.doesNotMatch(route,/auraState: auraEngineManager\.getState\(\)/);
  assert.doesNotMatch(source,/app\.get\("\/api\/aura\/state"/);
});
test('Aura chat runs a tool call (even when the model repeats the call line) and answers from the receipt', async()=>{
  await withEnv({JACO_GATEWAY_TOKEN:TOKEN,SEER_URL:'http://127.0.0.1:2997'}, async()=>{
    const replies=[
      'TOOL_CALL {"name":"repo_list","args":{"path":"agents/lib"}}TOOL_CALL {"name":"repo_list","args":{"path":"agents/lib"}}',
      'agents/lib innehåller a.mjs och b.mjs.',
    ];
    const prompts=[];
    const seen=[];
    const out=await auraChatViaSeer({
      message:'Vad finns i agents/lib?',
      toolbox:{
        observe:async()=>'{"services":{"seer":"up"}}',
        tools:{repo_list:{description:'list',run:async(args)=>{seen.push(args.path);return 'a.mjs\nb.mjs';}}},
      },
    }, async(_url,opts)=>{
      prompts.push(JSON.parse(opts.body));
      return {ok:true,status:200,async json(){return {ok:true,text:replies.shift(),provider:'ollama',model:'gpt-oss',local:false};}};
    });
    assert.deepEqual(seen,['agents/lib']);
    assert.equal(out.reply,'agents/lib innehåller a.mjs och b.mjs.');
    assert.equal(out.toolReceipts.length,1);
    assert.equal(out.toolReceipts[0].ok,true);
    assert.match(prompts[0].system,/TOOL_CALL/);
    assert.match(prompts[0].user,/OBSERVED_STATE/);
    assert.match(prompts[1].user,/TOOL_RESULT \(ok/);
  });
});

test('Aura chat nudges the model once when it announces a tool instead of calling it', async()=>{
  await withEnv({JACO_GATEWAY_TOKEN:TOKEN,SEER_URL:'http://127.0.0.1:2997'}, async()=>{
    const replies=['We will call mission_list.','TOOL_CALL {"name":"mission_list","args":{}}','Två uppdrag är aktiva.'];
    let calls=0;
    const out=await auraChatViaSeer({
      message:'Vilka uppdrag är aktiva?',
      toolbox:{observe:async()=>'{}',tools:{mission_list:{description:'list',run:async()=>{calls++;return [{id:'m1'},{id:'m2'}];}}}},
    }, async()=>({ok:true,status:200,async json(){return {ok:true,text:replies.shift(),provider:'ollama',model:'gpt-oss',local:false};}}));
    assert.equal(calls,1);
    assert.equal(out.reply,'Två uppdrag är aktiva.');
  });
});

test('operator message survives large prior context and is always the latest prompt content', () => {
  const goal='SVARA PÅ DEN HÄR AKTUELLA FRÅGAN';
  const {user}=buildAuraSeerPrompts({
    message:goal,
    observedState:'old:'.repeat(1200),
    ragContext:'R'.repeat(12000),
    toolTranscript:'T'.repeat(28000),
  });
  assert.ok(user.endsWith('CURRENT_USER_MESSAGE:\n'+goal), 'latest operator message must be at the truncation-safe tail');
  assert.equal(user.match(/TOOL_TRANSCRIPT/g)?.length,1);
  assert.ok(user.indexOf('TOOL_TRANSCRIPT')<user.indexOf('CURRENT_USER_MESSAGE'));
  assert.ok(user.length<28000,'oversized tool history must not be forwarded to the model');
});

test('tool transcript retains recent receipts and bounds each model round', () => {
  const entries=Array.from({length:8},(_,i)=>({
    call:{name:'repo_read',args:{path:'file'+i+'.ts'}},
    ok:true,at:'2026-11-02T12:00:00.000Z',
    text:'header'+i+' '+('X'.repeat(10000))+' ending'+i,
  }));
  const output=renderAuraToolTranscript(entries);
  assert.ok(output.includes('EARLIER_TOOL_OBSERVATIONS (5'));
  assert.ok(output.includes('file0.ts'), 'earlier result keeps a bounded evidence reference');
  assert.ok(output.includes('file7.ts'));
  assert.ok(output.includes('ending7'));
  assert.ok(!output.includes('header0 '+('X'.repeat(10000))), 'original long tool output must not be forwarded');
  assert.ok(output.length<8000,'latest three tool results must not grow the prompt without bound');
});

test('FREE/LOCAL model usage is not misreported as unknown cloud spend', () => {
  assert.equal(summarizeAuraModelCosts([{status:'FREE'}]).costStatus,'FREE');
  assert.equal(summarizeAuraModelCosts([{status:'LOCAL'},{status:'FREE'}]).costStatus,'LOCAL');
  assert.deepEqual(summarizeAuraModelCosts([{status:'FREE'},{status:'SETTLED',usd:0.001}]),{
    costStatus:'SETTLED',costUsd:0.001,modelCalls:2,
  });
  assert.equal(summarizeAuraModelCosts([{status:'SETTLED',usd:0.001},{status:'OUTCOME_UNKNOWN'}]).costStatus,'OUTCOME_UNKNOWN');
  assert.equal(summarizeAuraModelCosts([{status:'FREE'},{status:'unknown'}]).costStatus,'OUTCOME_UNKNOWN');
  assert.equal(summarizeAuraModelCosts([]),null);
});

test('a model cannot execute a sixth tool or expose an unexecuted TOOL_CALL as success', async () => {
  const seen=[], executed=[];
  let turns=0;
  const out=await auraChatViaSeer({
    message:'Undersök felet, men hitta inte på vad som körts.',
    complete:async ({user})=>{
      seen.push(user);
      turns++;
      return {provider:'fixture',model:'free-model',local:false,costStatus:'FREE',text:
        'TOOL_CALL '+JSON.stringify({name:'inspect',args:{step:turns}})};
    },
    toolbox:{observe:async()=>'system OK',tools:{inspect:{description:'read-only inspection',run:async ({step})=>{
      executed.push(step);
      return {observed:true,text:'O'.repeat(10000)+'receipt'+step};
    }}}},
  });
  assert.equal(turns,6,'bounded tool loop performs only the final summary inference');
  assert.deepEqual(executed,[1,2,3,4,5]);
  assert.equal(out.toolReceipts.length,5);
  assert.match(out.reply,/did not carry out the last proposed call/);
  assert.doesNotMatch(out.reply,/TOOL_CALL/);
  assert.equal(out.providerReceipt.costStatus,'FREE');
  assert.equal(out.providerReceipt.costUsd,0);
  assert.equal(out.providerReceipt.modelCalls,6);
  assert.ok(seen.at(-1).endsWith('CURRENT_USER_MESSAGE:\nUndersök felet, men hitta inte på vad som körts.'));
  assert.ok(seen.at(-1).length<9000,'tool receipts should not create a runaway prompt');
});

test('Aura context grows only for explicitly larger provider budgets and preserves the last instruction', () => {
  const query='Vad gör du nu?';
  const context={ message:query, messagesHistory:Array.from({length:10},()=>({role:'user',content:'prior '.repeat(1500)})),
    ragContext:'R'.repeat(12000), toolTranscript:'T'.repeat(28000), observedState:'S'.repeat(6000) };
  const small=buildAuraSeerPrompts({...context,contextChars:7500});
  const extended=buildAuraSeerPrompts({...context,contextChars:24000});
  assert.ok(small.user.length<=7500);
  assert.ok(extended.user.length<=24000 && extended.user.length>small.user.length);
  assert.ok(small.user.endsWith('CURRENT_USER_MESSAGE:\n'+query));
  assert.ok(extended.user.endsWith('CURRENT_USER_MESSAGE:\n'+query));
  assert.match(small.user,/TOOL_TRANSCRIPT/);
  assert.match(small.user,/RECENT_CONVERSATION/);
  assert.throws(()=>buildAuraSeerPrompts({message:'x'.repeat(10000),contextChars:7500}),/AURA_CHAT_MESSAGE_TOO_LARGE_FOR_CONTEXT/);
});

test('Aura is told to find the way and offer to start, not to list what it cannot do', () => {
  const { system } = buildAuraSeerPrompts({ message: 'Hur når vi fler användare?' });
  assert.match(system, /Be solution-first/);
  assert.match(system, /never answer with what you cannot do or ask them to write a clearer mission/);
  assert.match(system, /End by offering to start the first step now/);
});
