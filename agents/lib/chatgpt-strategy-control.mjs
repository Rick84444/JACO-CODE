// Operator-scoped ChatGPT strategy admission for the existing Aura/SEER graph.
// GitHub is untrusted transport. No grants, money permissions, project paths,
// model selection or operator decisions may be supplied by the Git payload.
import { createHash } from 'node:crypto';
import { normalizeCodingContract, CODE_TASKS } from './coding-contract.mjs';

const readTasks=new Set([
  'health-check','detect-surfaces','browser-survey-site','desktop-observe',
  'desktop-windows','android-status','android-observe','screenshot',
  'web-fetch','get-cursor','repo-list','repo-read','git-status','git-diff',
]);
const idPattern=/^[A-Za-z0-9._:-]{1,80}$/;
const clean=(v,max)=>typeof v==='string'&&v.trim()&&v.trim().length<=max?v.trim():null;
const reject=code=>{throw Error('CHATGPT_STRATEGY_'+code);};
const csv=v=>String(v||'').split(',').map(s=>s.trim()).filter(Boolean);

// The operator's on-host policy, never a document from a public Git ref.
export function strategyPolicy(env=process.env){
  const enabled=env.JACO_CHATGPT_STRATEGY_ENABLED==='1';
  const explicit=csv(env.JACO_CHATGPT_STRATEGY_ALLOWED_TASKS);
  const allowedTasks=[...new Set(explicit.length?explicit:['health-check','detect-surfaces'])];
  if(allowedTasks.some(t=>!readTasks.has(t)&&!CODE_TASKS.has(t)))reject('TASK_POLICY_INVALID');
  const codeRoots=csv(env.JACO_CHATGPT_STRATEGY_CODE_ROOTS);
  if(allowedTasks.some(t=>CODE_TASKS.has(t))&&!codeRoots.length)
    reject('CODE_SCOPE_NOT_CONFIGURED');
  return {enabled,allowedTasks,codeRoots,
    maxNodes:Math.min(12,Math.max(1,Number(env.JACO_CHATGPT_STRATEGY_MAX_NODES)||8)),
    maxSteps:Math.min(100,Math.max(1,Number(env.JACO_CHATGPT_STRATEGY_MAX_STEPS)||20)),
    maxToolCalls:Math.min(300,Math.max(1,Number(env.JACO_CHATGPT_STRATEGY_MAX_TOOL_CALLS)||60)),
    maxDurationMs:Math.min(8*3600000,Math.max(60000,Number(env.JACO_CHATGPT_STRATEGY_MAX_DURATION_MS)||3600000)),
  };
}

function assertDag(nodes){
  const byKey=new Map(nodes.map(n=>[n.key,n]));
  const busy=new Set(),done=new Set();
  const visit=key=>{
    if(done.has(key))return;
    if(busy.has(key))reject('GRAPH_CYCLE');
    const n=byKey.get(key);if(!n)reject('UNKNOWN_DEPENDENCY');
    busy.add(key);
    for(const dep of n.dependencies)visit(dep);
    busy.delete(key);done.add(key);
  };
  for(const n of nodes)visit(n.key);
}

// Incoming plan never owns the execution authority. The operator explicitly
// enables the adapter and decides allowed task TYPES and exact code paths locally.
export function prepareChatGptStrategy(payload,{env=process.env,repo='Rick84444/JACO-CODE'}={}){
  if(payload?.op!=='strategy.graph.create')reject('OPERATION_UNSUPPORTED');
  const policy=strategyPolicy(env);
  if(!policy.enabled)reject('OPERATOR_OPT_IN_REQUIRED');
  const commandId=clean(payload.commandId,160);
  if(!commandId||!/^[A-Za-z0-9._:-]{6,160}$/.test(commandId))reject('COMMAND_ID_INVALID');
  const raw=payload.graph;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))reject('GRAPH_REQUIRED');
  const title=clean(raw.title,200),objective=clean(raw.objective,4000);
  if(!title||!objective)reject('GOAL_REQUIRED');
  if(!Array.isArray(raw.nodes)||raw.nodes.length<1||raw.nodes.length>policy.maxNodes)
    reject('NODE_COUNT_INVALID');
  if(raw.policy!==undefined||raw.projectRoot!==undefined||raw.project_root!==undefined)
    reject('CALLER_POLICY_DENIED');
  const nodes=raw.nodes.map((n,index)=>{
    if(!n||typeof n!=='object'||Array.isArray(n))reject('NODE_INVALID');
    const key=clean(n.key,80)||'step'+(index+1);
    if(!idPattern.test(key))reject('NODE_KEY_INVALID');
    const stepObjective=clean(n.objective,4000),stepTitle=clean(n.title,200);
    if(!stepObjective||!stepTitle)reject('NODE_GOAL_INVALID');
    const dependencies=n.dependencies===undefined?[]:n.dependencies;
    if(!Array.isArray(dependencies)||dependencies.length>policy.maxNodes||
      dependencies.some(d=>typeof d!=='string'||!idPattern.test(d)))reject('DEPENDENCIES_INVALID');
    const node={key,title:stepTitle,objective:stepObjective,dependencies:[...new Set(dependencies)]};
    if(n.contract!==undefined){
      if(!policy.allowedTasks.some(t=>CODE_TASKS.has(t)))reject('CONTRACT_NOT_AUTHORIZED');
      const source=n.contract;
      if(!source||typeof source!=='object'||Array.isArray(source))reject('CONTRACT_INVALID');
      const paths=source.scope?.allowed;
      if(!Array.isArray(paths)||paths.length===0||paths.some(p=>!policy.codeRoots.includes(p)))
        reject('CODE_SCOPE_DENIED');
      if((source.services||[]).length)reject('EXTERNAL_SERVICE_CONTRACT_DENIED');
      const approvedTests=csv(env.JACO_CHATGPT_STRATEGY_TEST_COMMANDS);
      if((source.verification?.commands||[]).some(command=>!approvedTests.includes(command)))
        reject('TEST_COMMAND_NOT_APPROVED');
      const normalized=normalizeCodingContract({
        ...source,scope:{allowed:paths,forbidden:source.scope?.forbidden||[]},preApproved:[],
        execution:{...source.execution,allow_git_push:false,allow_git_merge:false,
          allow_git_commit:false,require_git_commit:false},
        budget:{max_steps:Math.min(policy.maxSteps,Number(source.budget?.max_steps)||policy.maxSteps),
          max_tool_calls:Math.min(policy.maxToolCalls,Number(source.budget?.max_tool_calls)||policy.maxToolCalls),
          max_duration_ms:Math.min(policy.maxDurationMs,Number(source.budget?.max_duration_ms)||policy.maxDurationMs)},
      },stepObjective);
      node.contract=normalized;
    }else if(policy.allowedTasks.some(t=>CODE_TASKS.has(t))){
      // Code task admission is per-node. Never infer broad project authority.
      reject('NODE_CODING_CONTRACT_REQUIRED');
    }
    return node;
  });
  if(new Set(nodes.map(n=>n.key)).size!==nodes.length)reject('DUPLICATE_NODE_KEY');
  assertDag(nodes);
  const graphId='chatgpt-'+createHash('sha256').update(repo+':'+commandId).digest('hex').slice(0,28);
  return {id:graphId,title,objective,nodes,
    policy:{owner:'aura',source:'chatgpt-git-strategy',origin_command_id:commandId,
      allowedTasks:policy.allowedTasks,executor:'nova',autonomy:'closed-loop',
      strategyBudget:{maxNodes:policy.maxNodes,maxSteps:policy.maxSteps,
        maxToolCalls:policy.maxToolCalls,maxDurationMs:policy.maxDurationMs}},
  };
}

export function createLocalAuraGraphClient({
  fetchImpl=globalThis.fetch,
  env=process.env,
}={}){
  // Follow the existing SEER endpoint configuration when Windows allocated
  // a nondefault service port; never fall back to an Internet endpoint.
  const raw=String(env.JACO_CHATGPT_STRATEGY_URL||env.JACO_SEER_URL||('http://127.0.0.1:'+(env.SEER_PORT||2997))).replace(/\/+$/,'');
  const target=new URL(raw);
  if(!['127.0.0.1','localhost','::1'].includes(target.hostname)||target.protocol!=='http:')
    reject('LOOPBACK_REQUIRED');
  const token=env.JACO_GATEWAY_TOKEN||env.GATEWAY_TOKEN||env.SEER_TOKEN||'';
  const request=async(method,resource,payload)=>{
    if(token.length<24)reject('SEER_TOKEN_REQUIRED');
    const res=await fetchImpl(raw+resource,{
      method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},
      ...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(12000),
    });
    if(res.status===404)return null;
    const data=await res.json();
    if(!res.ok)throw Error(typeof data?.error==='string'?data.error:'CHATGPT_STRATEGY_SEER_HTTP_'+res.status);
    return data;
  };
  return {
    async get(id){return request('GET','/cortex/mission-graphs/'+encodeURIComponent(id));},
    async create(graph){
      const existing=await this.get(graph.id);
      if(existing){
        if(existing.policy?.origin_command_id!==graph.policy.origin_command_id)
          reject('GRAPH_ID_COLLISION');
        return existing;
      }
      return request('POST','/cortex/mission-graphs',graph);
    },
  };
}
