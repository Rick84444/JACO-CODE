import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callAuraMcpTool } from '../../runtime/src/server/mcp/auraAgentMcpCall.mjs';

test('chat MCP local write approved without per-action prompt, then revoked on next call',async t=>{
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'jaco-mcp-standing-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file = path.join(root,'.jaco','state','autonomy','mandates.json');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const save=state=>fs.writeFileSync(file,JSON.stringify([{
    id:'operator-level5-default',enabled:true,signedByOperator:true,validity:'STANDING',expiresAt:null,
    decisions:{READ:'ALLOW',LOCAL_MUTATION:state,EXTERNAL_MUTATION:'DENY',PUBLISH:'DENY',FINANCIAL:'REVIEW'}
  }]));
  let executions=0;
  const host={
    configFile:path.join(root,'.jaco','mcp','servers.json'),
    servers:()=>({shell:{id:'shell',agentAccess:'write',deny:[]}}),
    listTools:async()=>[{name:'shell_run',readOnly:false}],
    call:async()=>{executions++;return {isError:false}}
  };
  save('ALLOW');
  await callAuraMcpTool(host,{server:'shell',tool:'shell_run',mode:'write',args:{command:'npm',args:['install','axios']}});
  assert.equal(executions,1);
  save('DENY');
  await assert.rejects(callAuraMcpTool(host,{server:'shell',tool:'shell_run',mode:'write'}),/MCP_STANDING_MANDATE_DENY/);
  assert.equal(executions,1);
});

test('remote MCP writes require operator checkbox AND server write access',async t=>{
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'jaco-remote-standing-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=path.join(root,'.jaco','state','autonomy','mandates.json');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const set=decision=>fs.writeFileSync(file,JSON.stringify([{
    id:'operator-level5-default',enabled:true,signedByOperator:true,validity:'STANDING',expiresAt:null,
    decisions:{READ:'ALLOW',LOCAL_MUTATION:'ALLOW',EXTERNAL_MUTATION:decision,PUBLISH:'DENY',FINANCIAL:'REVIEW'}
  }]));
  let access='read',calls=0;
  const host={
    configFile:path.join(root,'.jaco','mcp','servers.json'),
    servers:()=>({service:{id:'service',transport:'http',agentAccess:access,deny:[]}}),
    listTools:async()=>[{name:'service_update',readOnly:false}],
    call:async()=>{calls++;return {isError:false}}
  };
  set('ALLOW');
  await assert.rejects(callAuraMcpTool(host,{server:'service',tool:'service_update',mode:'write'}),/MCP_TOOL_NOT_READ_ONLY/);
  access='write';
  await callAuraMcpTool(host,{server:'service',tool:'service_update',mode:'write'});
  assert.equal(calls,1);
  set('DENY');
  await assert.rejects(callAuraMcpTool(host,{server:'service',tool:'service_update',mode:'write'}),/MCP_STANDING_MANDATE_DENY/);
  assert.equal(calls,1);
});
