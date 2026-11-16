import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareChatGptStrategy, strategyPolicy, createLocalAuraGraphClient } from '../../agents/lib/chatgpt-strategy-control.mjs';
import { createGithubNovaControlInbox } from '../../agents/lib/github-control-inbox.mjs';
import { gitControlReceiptSnapshot } from '../../agents/lib/git-control-receipts.mjs';

const base={
  schema:'jaco.nova-control/v1',
  commandId:'chatgpt-strategy-001',
  op:'strategy.graph.create',
  graph:{
    title:'Verify JACO connection',
    objective:'Produce bounded, tested evidence of runtime health',
    nodes:[
      {key:'health',title:'Health',objective:'Check local services',dependencies:[]},
      {key:'report',title:'Report',objective:'Summarize evidence',dependencies:['health']},
    ],
  },
};
const enabled={
  JACO_CHATGPT_STRATEGY_ENABLED:'1',
  JACO_CHATGPT_STRATEGY_ALLOWED_TASKS:'health-check,detect-surfaces',
};
const copy=x=>JSON.parse(JSON.stringify(x));
test('strategy graph requires local opt-in; Git payload cannot grant itself autonomy',()=>{
  assert.throws(()=>prepareChatGptStrategy(base,{env:{}}),/CHATGPT_STRATEGY_OPERATOR_OPT_IN_REQUIRED/);
  const payload=copy(base);
  payload.graph.policy={allowedTasks:['shell'],spendLimit:10000};
  assert.throws(()=>prepareChatGptStrategy(payload,{env:enabled}),/CHATGPT_STRATEGY_CALLER_POLICY_DENIED/);
  payload.graph.policy=undefined;
  payload.graph.nodes[0].contract={scope:{allowed:['**']},acceptance:['done']};
  assert.throws(()=>prepareChatGptStrategy(payload,{env:enabled}),/CHATGPT_STRATEGY_CONTRACT_NOT_AUTHORIZED/);
});
test('goals are scoped, graph is bounded and authored into canonical Aura policy',()=>{
  const graph=prepareChatGptStrategy(base,{env:enabled,repo:'Rick84444/JACO-CODE'});
  assert.equal(graph.policy.owner,'aura');
  assert.equal(graph.policy.source,'chatgpt-git-strategy');
  assert.equal(graph.policy.executor,'nova');
  assert.deepEqual(graph.policy.allowedTasks,['health-check','detect-surfaces']);
  assert.equal(graph.nodes[1].dependencies[0],'health');
  assert.ok(!graph.policy.project_root);
  const same=prepareChatGptStrategy(base,{env:enabled,repo:'Rick84444/JACO-CODE'});
  assert.equal(graph.id,same.id,'retries use stable graph identity');
  assert.notEqual(graph.id,prepareChatGptStrategy({...base,commandId:'chatgpt-strategy-002'},{env:enabled}).id);
  const cyclic=copy(base);
  cyclic.graph.nodes[0].dependencies=['report'];
  assert.throws(()=>prepareChatGptStrategy(cyclic,{env:enabled}),/CHATGPT_STRATEGY_GRAPH_CYCLE/);
  const unknown=copy(base);
  unknown.graph.nodes[0].dependencies=['nonexistent'];
  assert.throws(()=>prepareChatGptStrategy(unknown,{env:enabled}),/CHATGPT_STRATEGY_UNKNOWN_DEPENDENCY/);
});
test('remote strategy cannot grant shell, money, deployment or unscoped code',()=>{
  for(const task of ['shell','browser-click','git-push','repo-write','repo-read','mcp-write']){
    const env={...enabled,JACO_CHATGPT_STRATEGY_ALLOWED_TASKS:task};
    if(['git-push','repo-write','repo-read'].includes(task))env.JACO_CHATGPT_STRATEGY_CODE_ROOTS='gateway/src/workplace/**';
    if(['git-push','repo-write','repo-read'].includes(task))
      assert.throws(()=>prepareChatGptStrategy(base,{env}),/CHATGPT_STRATEGY_NODE_CODING_CONTRACT_REQUIRED/);
    else assert.throws(()=>prepareChatGptStrategy(base,{env}),/CHATGPT_STRATEGY_TASK_POLICY_INVALID/);
  }
  const env={...enabled,JACO_CHATGPT_STRATEGY_ALLOWED_TASKS:'repo-write',
    JACO_CHATGPT_STRATEGY_CODE_ROOTS:'gateway/src/workplace/**'};
  const incoming=copy(base);
  incoming.graph.nodes=incoming.graph.nodes.slice(0,1);
  incoming.graph.nodes[0].contract={
    schema:'jaco.coding-contract/v1',
    scope:{allowed:['**']},acceptance:['test'],
  };
  assert.throws(()=>prepareChatGptStrategy(incoming,{env}),/CHATGPT_STRATEGY_CODE_SCOPE_DENIED/);
  incoming.graph.nodes[0].contract.scope.allowed=['gateway/src/workplace/**'];
  incoming.graph.nodes[0].contract.verification={commands:['rm -rf .']};
  assert.throws(()=>prepareChatGptStrategy(incoming,{env}),/CHATGPT_STRATEGY_TEST_COMMAND_NOT_APPROVED/);
  incoming.graph.nodes[0].contract.verification={commands:[]};
  const graph=prepareChatGptStrategy(incoming,{env});
  assert.equal(graph.nodes[0].contract.execution.allow_git_push,false);
  assert.equal(graph.nodes[0].contract.execution.allow_git_merge,false);
  assert.equal(graph.nodes[0].contract.execution.allow_git_commit,false);
  assert.deepEqual(graph.nodes[0].contract.preApproved,[]);
});
test('graph service client is restricted to authenticated localhost only',async()=>{
  assert.throws(()=>createLocalAuraGraphClient({env:{JACO_CHATGPT_STRATEGY_URL:'https://evil.example'}}),
    /CHATGPT_STRATEGY_LOOPBACK_REQUIRED/);
  const target=createLocalAuraGraphClient({env:{JACO_GATEWAY_TOKEN:'x'.repeat(26)},fetchImpl:async(url,opts)=>{
    assert.equal(opts.headers.authorization,'Bearer '+'x'.repeat(26));
    if(opts.method==='GET')return {ok:false,status:404,json:async()=>({})};
    return {ok:true,status:201,json:async()=>({id:'graph-a',status:'ACTIVE'})};
  }});
  assert.equal((await target.create({id:'graph-a'})).id,'graph-a');
});

test('Git-only strategy command creates one canonical graph and publishes graph identity in bounded receipt',async()=>{
  const calls=[];const graphs=new Map();let input=copy(base);
  const client={async create(){throw Error('Nova mission creation forbidden here')},
    async get(){throw Error('Unexpected Nova get')},async resolve(){throw Error('Unexpected resolve')}};
  const strategyClient={
    async create(graph){calls.push(graph);const item={...graph,status:'ACTIVE'};graphs.set(graph.id,item);return item;},
    async get(id){return graphs.get(id);},
  };
  const inbox=createGithubNovaControlInbox({
    missionClient:client,strategyClient,strategyEnv:enabled,
    repo:'Rick84444/JACO-CODE',token:'',transportMode:'git-ref',actor:'Rick84444',
    gitExecImpl:async(_bin,args)=>{
      if(args[2]==='fetch')return {stdout:''};
      if(args[2]==='show')return {stdout:JSON.stringify(input)};
      // Status push is optional; no fake receipts make authority.
      throw Error('Git receipt push unavailable in fixture');
    },repoRoot:'/test/repo',
  });
  const state={};const first=await inbox.poll(state,{force:true});
  assert.equal(first.accepted.length,1);
  assert.equal(first.accepted[0].op,'strategy.graph.create');
  assert.equal(calls.length,1);
  assert.equal(calls[0].nodes.length,2);
  const receipt=gitControlReceiptSnapshot(state.githubControl);
  const item=receipt.entries.find(e=>e.commandId===base.commandId);
  assert.equal(item.operation,'strategy.graph.create');
  assert.equal(item.graphId,calls[0].id);
  assert.equal(item.missionId,null);
  assert.equal(item.status,'ACTIVE');
  assert.equal((await inbox.poll(state,{force:true})).accepted.length,0);
  assert.equal(calls.length,1,'replay does not create duplicate graph');
  graphs.get(item.graphId).status='VERIFIED';
  await inbox.poll(state,{force:true});
  assert.equal(gitControlReceiptSnapshot(state.githubControl).entries.find(e=>e.graphId===item.graphId).closed,true);
});
test('without operator opt-in a Git strategy command is REJECTED without graph side effects',async()=>{
  let called=0;const s={};
  const inbox=createGithubNovaControlInbox({
    missionClient:{async create(){throw Error('must not run')},async get(){throw Error('must not run')}},
    strategyClient:{async create(){called++;throw Error('must not run')},async get(){return null}},
    strategyEnv:{},transportMode:'git-ref',repo:'Rick84444/JACO-CODE',token:'',
    gitExecImpl:async(_bin,args)=>{
      if(args[2]==='fetch')return {stdout:''};
      if(args[2]==='show')return {stdout:JSON.stringify(base)};
      throw Error('status transport offline');
    },repoRoot:'/test/repo',
  });
  const result=await inbox.poll(s,{force:true});
  assert.equal(result.accepted.length,0);
  assert.equal(called,0);
  const entry=gitControlReceiptSnapshot(s.githubControl).entries.find(e=>e.commandId===base.commandId);
  assert.equal(entry.status,'REJECTED');
});
