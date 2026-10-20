import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const editor=path.join(root,'runtime/tools/jaco-editor-mcp.mjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){for(let n=0;n<100;n++){const result=await check();if(result)return result;await pause(30);}throw Error('Timed out: '+label);}
async function stop(child){if(child.exitCode!==null || child.signalCode)return;const done=once(child,'exit');child.kill();await done;}

function client(env){
  const child=spawn(process.execPath,[editor],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let seq=0,stderr='';const pending=new Map();
  child.stderr.on('data',data=>{stderr+=data;});
  const lines=createInterface({input:child.stdout});
  lines.on('line',line=>{let value;try{value=JSON.parse(line);}catch{return;}const waiter=pending.get(value.id);if(waiter){pending.delete(value.id);clearTimeout(waiter.timer);waiter.resolve(value);}});
  child.on('exit',()=>{for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(Error('Editor exited: '+stderr));}pending.clear();});
  const rpc=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('MCP response timeout: '+method+' '+stderr));},10000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  const call=async(name,args={})=>{const response=await rpc('tools/call',{name,arguments:args});assert.equal(response.error,undefined);const text=response.result.content[0].text;if(response.result.isError)return {error:text};return JSON.parse(text);};
  return {child,rpc,call,async close(){if(child.exitCode!==null)return;const done=once(child,'exit');child.stdin.end();await done;}};
}

test('two actual editor MCP processes coordinate over real Workplace HTTP and fail closed after disconnect',{timeout:30000},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-team-live-'));
  let project=path.join(dir,'project-a'),toolCalls=0;
  // This stand-in verifies MCP transport and routing only; it does not claim production tool execution.
  const workbench=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const reply=(status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname.endsWith('/project'))return reply(200,{success:true,root:project});
    if(req.headers['x-jaco-project-root'] && req.headers['x-jaco-project-root']!==project)return reply(409,{success:false,error:'WORKBENCH_PROJECT_CHANGED'});
    if(url.pathname.endsWith('/mcp'))return reply(200,{providers:[{id:'test-local',tools:[{name:'read_summary',readOnly:true},{name:'mutate',readOnly:false}]}]});
    if(url.pathname.endsWith('/mcp/call')){toolCalls++;return reply(200,{success:true,observed:JSON.parse(raw)});}
    if(url.pathname.endsWith('/file') && req.method==='GET')return reply(200,{success:true,path:'README.md',content:'temporary project',hash:'test-hash'});
    return reply(404,{success:false,error:'TEST_ROUTE_NOT_FOUND'});
  });
  workbench.listen(0,'127.0.0.1');await once(workbench,'listening');
  const token='test-only-team-live-bearer-123456789';
  const env={...process.env,JACO_WORKSPACE_ROOT:dir,JACO_WORKPLACE_HOST:'127.0.0.1',JACO_WORKPLACE_PORT:'0',JACO_WORKPLACE_TOKEN:token,JACO_WORKPLACE_SUPERVISE_NOVA:'0',JACO_WORKPLACE_SUPERVISE_SEER:'0',JACO_CHATGPT_RELAY_ENABLED:'0'};
  const hub=spawn(process.execPath,['gateway/src/workplace/workplace-server.mjs'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';hub.stdout.on('data',data=>{output+=data;});hub.stderr.on('data',data=>{output+=data;});
  const clients=[];
  t.after(async()=>{for(const c of clients)await stop(c.child);await stop(hub);workbench.closeAllConnections();await new Promise(resolve=>workbench.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
  const base=await until(()=>output.match(/READY (http:\/\/127\.0\.0\.1:\d+)/)?.[1],'temporary Workplace startup');
  const clientEnv={...env,JACO_WORKPLACE_URL:base,JACO_RUNTIME_URL:'http://127.0.0.1:'+workbench.address().port,JACO_WORKPLACE_SYNC_MS:'250',JACO_HUB_URL:'',JACO_DEVICE_KEY:''};
  const a=client(clientEnv),b=client(clientEnv);clients.push(a,b);
  for(const [c,name] of [[a,'Team Test Alpha'],[b,'Team Test Beta']]){
    const init=await c.rpc('initialize',{protocolVersion:'2025-06-18',clientInfo:{name,version:'test'}});assert.equal(init.result.serverInfo.name,'jaco-editor');
  }
  const alpha=await a.call('team_status'),beta=await b.call('team_status');
  assert.equal(alpha.state,'READY');assert.equal(beta.state,'READY');assert.notEqual(alpha.agentId,beta.agentId);
  assert.ok(beta.agents.agents.some(agent=>agent.requestedName==='Team Test Alpha'));
  // A live sync can temporarily refuse the call after team_status. Retry only
  // that explicit pre-execution refusal, retaining the same idempotent event ID.
  const posted=await until(async()=>{const result=await a.call('team_post',{kind:'MESSAGE',body:'Review the temporary fixture',targets:[beta.agentId],eventId:'team-test-message'});return result.error!=='DEGRADED_UNSYNCED'&&result;},'first session synced before posting');
  assert.equal(posted.error,undefined);
  const inbox=await until(async()=>{const page=await b.call('team_inbox');return page.events.some(entry=>entry.event.body==='Review the temporary fixture')&&page;},'targeted team delivery');
  assert.equal(inbox.overflow,false);
  const resource='file:'+path.join(project,'README.md');
  const lease=await until(async()=>{const r=await a.call('team_claim',{resource,intent:'edit temporary fixture'});return r.error!=='DEGRADED_UNSYNCED'&&r;},'first session synced before claiming');
  assert.ok(lease.claimId,JSON.stringify(lease));
  // A session that has not finished its first sync answers DEGRADED_UNSYNCED, which is correct and transient (it showed on a
  // loaded CI runner). Wait that state out; the answer that finally comes must still be the conflict.
  const conflict=await until(async()=>{const r=await b.call('team_claim',{resource,intent:'conflicting edit'});return r.error!=='DEGRADED_UNSYNCED'&&r;},'second session synced');
  assert.match(conflict.error,/RESOURCE_ALREADY_CLAIMED/);
  assert.equal((await a.call('read_file',{path:'README.md'})).content,'temporary project');
  assert.equal((await a.call('local_tool_call',{providerId:'test-local',toolName:'read_summary'})).observed.toolName,'read_summary');
  assert.match((await a.call('local_tool_call',{providerId:'test-local',toolName:'mutate'})).error,/MCP_READ_ONLY_TOOL_REQUIRED/);assert.equal(toolCalls,1);
  project=path.join(dir,'project-b');
  assert.match((await a.call('read_file',{path:'README.md'})).error,/WORKBENCH_PROJECT_CHANGED/);
  await a.close();
  const afterExit=await until(async()=>{const r=await b.call('team_claim',{resource,intent:'resume released work'});return r.error!=='DEGRADED_UNSYNCED'&&r;},'claim after the first session left');
  assert.ok(afterExit.claimId,'disconnect releases the first session lease');
  await stop(hub);
  assert.match((await b.call('team_post',{kind:'FINDING',body:'must not publish while disconnected'})).error,/DEGRADED_UNSYNCED/);
});
