import fs from 'node:fs';
import path from 'node:path';

const ISSUE_MARKER='<!-- jaco-chatgpt-workplace-bridge:v1 -->';
const IN_MARKER='<!-- jaco-chatgpt-workplace-in:v1 -->';
const OUT_MARKER='<!-- jaco-chatgpt-workplace-out:v1 -->';
const ALLOWED_IN=new Set(['MESSAGE','QUESTION','ANSWER','HANDOFF','FINDING']);
const ALLOWED_OUT=new Set(['MESSAGE','QUESTION','ANSWER','HANDOFF','FINDING','RESULT','ERROR','WARNING']);

const clip=(value,max=12000)=>String(value??'').slice(0,max);
const nowIso=()=>new Date().toISOString();

function jsonBlock(marker,value){
  return `${marker}\n\n\`\`\`json\n${JSON.stringify(value,null,2)}\n\`\`\``;
}
function safeObject(value,depth=0){
  if(depth>5)return '[depth-limit]';
  if(Array.isArray(value))return value.slice(0,40).map(v=>safeObject(v,depth+1));
  if(!value||typeof value!=='object')return typeof value==='string'?clip(value,4000):value;
  const out={};
  for(const [key,item] of Object.entries(value)){
    if(/token|secret|password|authorization|api.?key|credential/i.test(key)){out[key]='[REDACTED]';continue;}
    out[key]=safeObject(item,depth+1);
  }
  return out;
}
function agentCard(env){
  return {
    schema:'jaco.agent-card/v1',
    identity:{
      stable_id:'chatgpt-jaco-relay',
      requested_name:'ChatGPT',
      provider:'openai',
      model:env.JACO_CHATGPT_MODEL||'gpt-5.6-sol',
      agent_type:'chat',
    },
    session:{environment:'chatgpt-github-relay',persistent:false,sandboxed:true},
    role:{
      primary:'collaborating-intelligence-relay',
      description:'Transport identity for ChatGPT collaboration with JACO Workplace. The relay persists messages; it does not imply continuous background cognition.',
    },
    capabilities:{
      reasoning:true,
      code_generation:true,
      code_edit:true,
      filesystem_read:false,
      filesystem_write:false,
      terminal:false,
      git_read:true,
      git_write:true,
      git_push:true,
      web:true,
      browser_control:false,
      desktop_control:false,
      image_understanding:true,
      database:false,
      testing:true,
      deployment:false,
      tools:['github','web','workplace-relay'],
    },
    constraints:[
      'No direct access to target-host localhost through the ChatGPT conversation.',
      'The relay transports communication only; it cannot create missions, decisions, claims, permissions or execute target-host actions.',
      'No continuous/background cognition is implied by the relay process being online.',
    ],
    preferred_tasks:['architecture','implementation','verification','code-review','cross-agent-coordination'],
    communication:{can_receive_messages:true,can_receive_missions:false,can_be_mentioned:true},
    runtime:{started_at:nowIso(),version:'chatgpt-github-relay-v1'},
  };
}

function readState(file){
  try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return {issueNumber:null,lastMirroredSeq:0,lastGithubAt:null};}
}
function writeState(file,state){
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const tmp=`${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp,JSON.stringify(state,null,2),{mode:0o600});
  fs.renameSync(tmp,file);
  try{fs.chmodSync(file,0o600);}catch{}
}
function parseInbound(comment,actor){
  if(comment?.user?.login!==actor)return null;
  const raw=String(comment?.body||'');
  if(!raw.includes(IN_MARKER))return null;
  const fenced=raw.match(/```json\s*([\s\S]*?)\s*```/i);
  if(!fenced)throw new Error('CHATGPT_RELAY_JSON_REQUIRED');
  const payload=JSON.parse(fenced[1]);
  if(payload?.schema!=='jaco.chatgpt-workplace/v1')throw new Error('CHATGPT_RELAY_SCHEMA_UNSUPPORTED');
  const messageId=String(payload.messageId||'').trim();
  if(!/^[A-Za-z0-9._:-]{6,160}$/.test(messageId))throw new Error('CHATGPT_RELAY_MESSAGE_ID_INVALID');
  const kind=String(payload.kind||'MESSAGE').toUpperCase();
  if(!ALLOWED_IN.has(kind))throw new Error('CHATGPT_RELAY_KIND_UNSUPPORTED');
  const body=String(payload.body||'').trim();
  if(!body||body.length>12000)throw new Error('CHATGPT_RELAY_BODY_INVALID');
  const thread=clip(payload.thread||'general',120)||'general';
  const targets=Array.isArray(payload.targets)&&payload.targets.length?[...new Set(payload.targets.map(String))].slice(0,16):['*'];
  return {messageId,kind,body,thread,targets,references:safeObject(payload.references||{})};
}

export function createChatGptGithubRelay({
  store,
  root=process.cwd(),
  env=process.env,
  fetchImpl=globalThis.fetch,
  log=(level,message)=>console.log(`[JACO Workplace] [chatgpt-relay] ${level.toUpperCase()} ${message}`),
}={}){
  if(!store)throw new Error('CHATGPT_RELAY_STORE_REQUIRED');
  const repo=env.JACO_CHATGPT_WORKPLACE_REPO||env.JACO_GITHUB_CONTROL_REPO||'Rick84444/jaco-code';
  const token=env.JACO_CHATGPT_WORKPLACE_TOKEN||env.JACO_GITHUB_CONTROL_TOKEN||env.GH_TOKEN||env.GITHUB_TOKEN||'';
  const actor=env.JACO_CHATGPT_WORKPLACE_ACTOR||String(repo).split('/')[0];
  const [owner,name]=String(repo).split('/');
  const pollMs=Math.max(5000,Number(env.JACO_CHATGPT_WORKPLACE_POLL_MS||10000));
  const stateFile=path.join(root,'.jaco','workplace','chatgpt-github-relay.json');
  const persisted=readState(stateFile);
  let registration=null;
  let timer=null;
  let heartbeatTimer=null;
  let polling=false;
  let lastError=null;
  let started=false;
  const enabled=Boolean(owner&&name&&token&&actor);
  let relayState=enabled?'REGISTERING':'DISABLED';

  async function api(apiPath,{method='GET',body=null}={}){
    const res=await fetchImpl('https://api.github.com'+apiPath,{
      method,
      headers:{
        accept:'application/vnd.github+json',
        authorization:`Bearer ${token}`,
        'content-type':'application/json',
        'user-agent':'jaco-chatgpt-workplace-relay/1',
        'x-github-api-version':'2022-11-28',
      },
      ...(body?{body:JSON.stringify(body)}:{}),
      signal:AbortSignal.timeout(15000),
    });
    const text=await res.text();
    let data={};try{data=text?JSON.parse(text):{};}catch{data={message:clip(text,500)};}
    if(!res.ok)throw new Error(`CHATGPT_RELAY_GITHUB_HTTP_${res.status}:${data?.message||'request failed'}`);
    return data;
  }
  async function findIssue(){
    if(Number(persisted.issueNumber)>0)return Number(persisted.issueNumber);
    const issues=await api(`/repos/${owner}/${name}/issues?state=open&creator=${encodeURIComponent(actor)}&per_page=100`);
    const match=(Array.isArray(issues)?issues:[]).find(issue=>!issue.pull_request&&String(issue.title||'')==='[JACO CHATGPT] Workplace bridge'&&String(issue.body||'').includes(ISSUE_MARKER));
    if(!match)throw new Error('CHATGPT_RELAY_ISSUE_NOT_FOUND');
    persisted.issueNumber=Number(match.number);
    writeState(stateFile,persisted);
    return persisted.issueNumber;
  }
  async function comments(issueNumber){
    const since=persisted.lastGithubAt?`&since=${encodeURIComponent(persisted.lastGithubAt)}`:'';
    return await api(`/repos/${owner}/${name}/issues/${issueNumber}/comments?per_page=100${since}`);
  }
  async function postComment(issueNumber,body){
    return await api(`/repos/${owner}/${name}/issues/${issueNumber}/comments`,{method:'POST',body:{body}});
  }
  function isForRelay(event){
    if(!event||event.sender?.agentId===registration?.agentId)return false;
    if(!ALLOWED_OUT.has(String(event.kind||'').toUpperCase()))return false;
    const targets=Array.isArray(event.targets)?event.targets:['*'];
    if(targets.includes(registration?.agentId))return true;
    return ['claude-codex','chatgpt','chatgpt-codex','chatgpt-claude'].includes(String(event.thread||''));
  }
  async function ingestGithub(issueNumber){
    const items=await comments(issueNumber);
    let latest=persisted.lastGithubAt;
    for(const comment of Array.isArray(items)?items:[]){
      if(comment?.created_at&&(!latest||comment.created_at>latest))latest=comment.created_at;
      let msg=null;
      try{msg=parseInbound(comment,actor);}catch(error){
        log('warn',`Rejected GitHub comment ${comment?.id||'?'}: ${clip(error?.message||error,220)}`);
        continue;
      }
      if(!msg)continue;
      store.postEvent({
        sessionId:registration.sessionId,
        sessionToken:registration.sessionToken,
        workspace:'JACO',
        thread:msg.thread,
        kind:msg.kind,
        targets:msg.targets,
        body:msg.body,
        payload:{transport:'github',messageId:msg.messageId,githubCommentId:comment.id},
        references:msg.references,
        eventId:`chatgpt-github:${msg.messageId}`,
      });
    }
    if(latest){persisted.lastGithubAt=latest;writeState(stateFile,persisted);}
  }
  async function mirrorWorkplace(issueNumber){
    const page=store.sync({
      sessionId:registration.sessionId,
      sessionToken:registration.sessionToken,
      workspace:'JACO',
      after:Number(persisted.lastMirroredSeq||0),
      limit:500,
    });
    for(const event of page.events||[]){
      if(!isForRelay(event))continue;
      await postComment(issueNumber,jsonBlock(OUT_MARKER,{
        schema:'jaco.chatgpt-workplace-event/v1',
        seq:event.seq,
        eventId:event.eventId,
        kind:event.kind,
        thread:event.thread,
        sender:event.sender,
        targets:event.targets,
        body:clip(event.body,12000),
        references:safeObject(event.references||{}),
        missionId:event.missionId||null,
        createdAt:event.createdAt,
      }));
    }
    persisted.lastMirroredSeq=Number(page.scannedCursor||persisted.lastMirroredSeq||0);
    store.ack({sessionId:registration.sessionId,sessionToken:registration.sessionToken,workspace:'JACO',cursor:persisted.lastMirroredSeq});
    writeState(stateFile,persisted);
  }
  async function poll(){
    if(!enabled||!registration||polling)return;
    polling=true;
    try{
      const issueNumber=await findIssue();
      await ingestGithub(issueNumber);
      await mirrorWorkplace(issueNumber);
      lastError=null;
      relayState='READY';
    }catch(error){
      lastError=clip(error?.message||error,500);
      relayState='DEGRADED_UNSYNCED';
      log('warn',lastError);
    }finally{polling=false;}
  }

  return {
    get enabled(){return enabled;},
    status(){
      return {
        enabled,started,state:relayState,
        agentId:registration?.agentId||null,
        sessionId:registration?.sessionId||null,
        issueNumber:persisted.issueNumber||null,
        lastMirroredSeq:Number(persisted.lastMirroredSeq||0),
        lastGithubAt:persisted.lastGithubAt||null,
        lastError,
      };
    },
    async start(){
      if(started)return this.status();
      started=true;
      if(!enabled){relayState='DISABLED';log('info','disabled: no GitHub token configured');return this.status();}
      try{
        relayState='REGISTERING';
        registration=store.registerAgent(agentCard(env),{workspace:'JACO'});
        const initialSeq=Number(registration.latestSeq||0);
        // A new relay session starts at the current Workplace head; historical
        // conversation remains in Workplace but is not bulk-exported to GitHub.
        store.ack({sessionId:registration.sessionId,sessionToken:registration.sessionToken,workspace:'JACO',cursor:initialSeq});
        store.postEvent({
          sessionId:registration.sessionId,sessionToken:registration.sessionToken,workspace:'JACO',
          kind:'STATUS',thread:'agent-status',body:'ChatGPT GitHub relay READY',
          payload:{status:'READY',transport:'github',issueNumber:persisted.issueNumber||null},
        });
        if(!persisted.lastMirroredSeq || Number(persisted.lastMirroredSeq)>initialSeq) persisted.lastMirroredSeq=initialSeq;
        writeState(stateFile,persisted);
        relayState='READY';
        await poll();
        timer=setInterval(()=>{void poll();},pollMs);timer.unref?.();
        heartbeatTimer=setInterval(()=>{
          try{store.heartbeat({sessionId:registration.sessionId,sessionToken:registration.sessionToken,workspace:'JACO',status:'READY'});}
          catch(error){lastError=clip(error?.message||error,500);}
        },60000);heartbeatTimer.unref?.();
        log('info',`READY as ${registration.agentId}`);
      }catch(error){
        lastError=clip(error?.message||error,500);
        relayState='DEGRADED_UNSYNCED';
        log('warn',lastError);
      }
      return this.status();
    },
    async poll(){await poll();return this.status();},
    async stop(){
      clearInterval(timer);clearInterval(heartbeatTimer);
      if(registration){
        try{store.endSession({sessionId:registration.sessionId,sessionToken:registration.sessionToken,workspace:'JACO',handoff:{thread:'handoff',body:'ChatGPT relay stopped'}});}catch{}
      }
      registration=null;started=false;relayState='OFFLINE';
    },
  };
}

export const CHATGPT_WORKPLACE_ISSUE_MARKER=ISSUE_MARKER;
export const CHATGPT_WORKPLACE_IN_MARKER=IN_MARKER;
export const CHATGPT_WORKPLACE_OUT_MARKER=OUT_MARKER;
