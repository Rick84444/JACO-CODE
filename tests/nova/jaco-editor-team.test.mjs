import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditorServer} from '../../runtime/tools/jaco-editor-mcp.mjs';
function fixture({degraded=false}={}) {
  const requests=[],activities=[];
  let onEvents,card,ended=false;
  const session={state:degraded?'DEGRADED_UNSYNCED':'READY',client:{agentId:'agent:test',sessionId:'session:test',sessionToken:'wps_private',agents:async()=>({agents:[],sessionToken:'wps_private'}),post:async(kind,body)=>({kind,body}),claim:async resource=>({resource}),releaseClaim:async claimId=>({claimId})},syncNow:async()=>({events:[]}),setActivity:async status=>activities.push(status),end:async()=>{ended=true;}};
  const server=createEditorServer({env:{},join:async options=>{onEvents=options.onEvents;card=options.card;return session;},fetchImpl:async(url,options)=>{
    requests.push({url,options});
    const data=url.endsWith('/project')?{root:'C:/project'}:url.endsWith('/mcp')?{providers:[{id:'local',tools:[{name:'read',readOnly:true},{name:'write',readOnly:false},{name:'unknown'}]}]}:{success:true,path:'x',hash:'hash'};
    return {ok:true,json:async()=>data};
  }});
  const call=(name,args={})=>server.handle({id:2,method:'tools/call',params:{name,arguments:args}});
  const init=()=>server.handle({id:1,method:'initialize',params:{clientInfo:{name:'Claude Code'}}});
  return {server,call,init,requests,activities,session,get card(){return card;},receive:events=>onEvents(events),get ended(){return ended;}};
}
test('MCP initialization reports client name, binds project and closes canonical session',async()=>{
 const f=fixture();await f.init();assert.equal(f.card.identity.requested_name,'Claude Code');assert.equal(f.card.identity.model,'unknown');
 await f.call('read_file',{path:'x'});assert.equal(f.requests.at(-1).options.headers['x-jaco-project-root'],'C:/project');
 await f.server.close();assert.equal(f.ended,true);
});
test('mutation is fail closed while unsynchronized and uses BUSY/READY when synchronized',async()=>{
 const f=fixture({degraded:true});await f.init();const before=f.requests.length;
 assert.match(JSON.stringify(await f.call('write_file',{path:'x',content:'text'})),/DEGRADED_UNSYNCED/);assert.equal(f.requests.length,before);
 f.session.state='READY';await f.call('write_file',{path:'x',content:'text'});assert.deepEqual(f.activities,['BUSY','READY']);
 f.session.syncNow=async()=>null;assert.match(JSON.stringify(await f.call('write_file',{path:'x',content:'text'})),/DEGRADED_UNSYNCED/);
});
test('local tools require exact advertisement and explicit readOnly',async()=>{
 const f=fixture();await f.init();
 for(const toolName of ['write','unknown','missing']) {const r=await f.call('local_tool_call',{providerId:'local',toolName});assert.match(JSON.stringify(r),/MCP_READ_ONLY_TOOL_REQUIRED/);}
 assert.equal(f.requests.some(r=>r.url.endsWith('/mcp/call')),false);
 await f.call('local_tool_call',{providerId:'local',toolName:'read'});assert.equal(f.requests.at(-1).url.endsWith('/mcp/call'),true);
});
test('inbox has explicit consumption cursor, bounds, overflow and removes credentials',async()=>{
 const f=fixture();await f.init();f.receive(Array.from({length:205},(_,i)=>({eventId:String(i),sessionToken:'wps_private',body:'wps_private'})));
 const result=await f.call('team_inbox',{after:0,limit:2});const data=JSON.parse(result.result.content[0].text);
 assert.equal(data.events.length,2);assert.equal(data.overflow,true);assert.equal(data.droppedThrough,5);assert.equal(data.nextCursor,7);assert.doesNotMatch(JSON.stringify(result),/wps_private|sessionToken/);
});
test('team publication cannot elevate kind or leak a session secret',async()=>{
 const f=fixture();await f.init();assert.match(JSON.stringify(await f.call('team_post',{kind:'MISSION',body:'x'})),/TEAM_EVENT_KIND_DENIED/);
 assert.match(JSON.stringify(await f.call('team_post',{kind:'MESSAGE',body:'wps_private'})),/TEAM_SECRET_DENIED/);
 assert.doesNotMatch(JSON.stringify(await f.call('team_status')),/wps_private|sessionToken/);
});
