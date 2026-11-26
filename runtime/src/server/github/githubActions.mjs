// Read-only Actions projection for the canonical Git view. No workflow dispatch.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {githubRepoFromRemote} from '../mcp/auraAgentMcpCall.mjs';
const execute=promisify(execFile);
const fields='databaseId,workflowName,displayTitle,status,conclusion,headBranch,headSha,event,createdAt,updatedAt';
const safeRepo=/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const states=new Set(['queued','in_progress','completed','waiting','requested','pending','action_required']);
const results=new Set(['success','failure','cancelled','skipped','timed_out','neutral','action_required','stale','startup_failure']);
const clean=(x,max=160)=>typeof x==='string'?x.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max):'';
const stamp=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))?new Date(x).toISOString():null;
const allowed=new Set(['PATH','Path','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','SYSTEMROOT','SystemRoot','TEMP','TMP','TMPDIR','LANG','LC_ALL','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME']);
export const actionsEnvironment=(env=process.env)=>({...Object.fromEntries(Object.entries(env).filter(([k,v])=>allowed.has(k)&&typeof v==='string')),GH_HOST:'github.com',GH_PROMPT_DISABLED:'1',GH_NO_UPDATE_NOTIFIER:'1',GH_NO_EXTENSION_UPDATE_NOTIFIER:'1'});
export async function readGithubActions(root,{exec=execute,env=process.env}={}){
  const options={cwd:root,env:actionsEnvironment(env),windowsHide:true,timeout:12000,maxBuffer:512*1024};
  let remote;
  try {remote=await exec('git',['remote','get-url','origin'],options);}
  catch {throw Error('GIT_ORIGIN_UNAVAILABLE');}
  const repo=githubRepoFromRemote(remote.stdout);
  if(!repo||!safeRepo.test(repo)||repo.split('/').some(x=>x==='.'||x==='..'))throw Error('GITHUB_ORIGIN_UNAVAILABLE');
  let raw;
  try {raw=await exec('gh',['run','list','--repo',repo,'--limit','20','--json',fields],options);}
  catch(e){throw Error(e?.code==='ENOENT'?'GITHUB_CLI_NOT_INSTALLED':'GITHUB_ACTIONS_UNAVAILABLE');}
  let data;
  try{data=JSON.parse(raw.stdout);}catch{throw Error('GITHUB_ACTIONS_INVALID_RESPONSE');}
  if(!Array.isArray(data)||data.length>20)throw Error('GITHUB_ACTIONS_INVALID_RESPONSE');
  const runs=data.map(r=>{
    if(!Number.isSafeInteger(r?.databaseId)||r.databaseId<1||!states.has(r.status))throw Error('GITHUB_ACTIONS_INVALID_RESPONSE');
    return {id:r.databaseId,workflow:clean(r.workflowName),title:clean(r.displayTitle),status:r.status,
      conclusion:results.has(r.conclusion)?r.conclusion:null,branch:clean(r.headBranch),
      sha:typeof r.headSha==='string'&&/^[a-f0-9]{40,64}$/i.test(r.headSha)?r.headSha:null,
      event:clean(r.event,40),createdAt:stamp(r.createdAt),updatedAt:stamp(r.updatedAt),
      url:'https://github.com/'+repo+'/actions/runs/'+r.databaseId};
  });
  return {repository:repo,observedAt:new Date().toISOString(),runs,url:'https://github.com/'+repo+'/actions'};
}
