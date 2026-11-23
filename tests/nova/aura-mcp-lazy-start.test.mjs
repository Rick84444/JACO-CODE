import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverAuraMcpTools, callAuraMcpTool, readGithubPullRequest, githubRepoFromRemote } from '../../runtime/src/server/mcp/auraAgentMcpCall.mjs';
import { cognitiveQuestionToolbox } from '../../runtime/src/server/connected/cognitiveQuestionToolbox.mjs';

function hostFixture(access='write',transport='stdio') {
  const calls=[],discovered=[];
  const def={id:'workspace',agentAccess:access,transport,deny:[]};
  const tools=[
    {name:'repo_read',readOnly:true,description:'Read a file'},
    {name:'workspace_write',readOnly:false,description:'Write under contract root'},
    {name:'external_publish',readOnly:false,description:'Public external effect'}
  ];
  const host={
    servers:()=>({workspace:def}),
    listTools:async(id)=>{discovered.push(id);return tools},
    call:async(id,name,args,options)=>{calls.push({id,name,args,options});return {content:[],isError:false}}
  };
  return {host,def,calls,discovered};
}

test('Aura can connect and execute a configured stopped MCP server without prior READY status',async()=>{
  const {host,calls,discovered}=hostFixture('write');
  // The host intentionally exposes no status method: discovery and call
  // must rely on its canonical lazy-start listTools and admission policy.
  const result=await callAuraMcpTool(host,{server:'workspace',tool:'repo_read',args:{path:'README.md'}});
  assert.equal(result.isError,false);
  assert.deepEqual(discovered,['workspace']);
  assert.deepEqual(calls[0].options,{actor:'agent',readOnly:true});
});

test('read-only operators cannot mutate through MCP, but discovery remains available',async()=>{
  const {host,calls}=hostFixture('read');
  const discovered=await discoverAuraMcpTools(host,'workspace');
  assert.equal(discovered.tools.length,3);
  assert.equal(discovered.tools[0].readOnly,true);
  await assert.rejects(callAuraMcpTool(host,{server:'workspace',tool:'workspace_write',mode:'write'}),/MCP_TOOL_NOT_READ_ONLY/);
  assert.equal(calls.length,0);
});

test('server off and per-tool deny are enforced before starting any MCP process',async()=>{
  const a=hostFixture('off');
  await assert.rejects(callAuraMcpTool(a.host,{server:'workspace',tool:'repo_read'}),/MCP_AGENT_ACCESS_OFF/);
  await assert.rejects(discoverAuraMcpTools(a.host,'workspace'),/MCP_AGENT_ACCESS_OFF/);
  assert.equal(a.discovered.length,0);
  const b=hostFixture('write');b.def.deny=['repo_read'];
  await assert.rejects(callAuraMcpTool(b.host,{server:'workspace',tool:'repo_read'}),/MCP_TOOL_DENIED/);
  assert.equal(b.discovered.length,0);
});

test('read mode never invokes a mutating tool even when write access is configured',async()=>{
  const a=hostFixture();
  await assert.rejects(callAuraMcpTool(a.host,{server:'workspace',tool:'workspace_write'}),/MCP_TOOL_WRITE_MODE_REQUIRED/);
  assert.equal(a.calls.length,0);
});

test('local mission-scoped writes remain autonomous; outward writes still require mission approval',async()=>{
  const a=hostFixture();
  await callAuraMcpTool(a.host,{server:'workspace',tool:'workspace_write',mode:'write',args:{path:'src/main.ts',content:'export {}'}});
  assert.equal(a.calls.length,1);
  assert.equal(a.calls[0].options.readOnly,false);
  await assert.rejects(callAuraMcpTool(a.host,{server:'workspace',tool:'external_publish',mode:'write'}),/MCP_MISSION_APPROVAL_REQUIRED/);
  await assert.rejects(callAuraMcpTool(a.host,{server:'workspace',tool:'workspace_write',mode:'write',args:{path:'.env'}}),/MCP_PROTECTED_PATH/);
  assert.equal(a.calls.length,1);
});

test('remote mutating MCP and malformed arguments are refused without executing the tool',async()=>{
  const a=hostFixture('write','http');
  await assert.rejects(callAuraMcpTool(a.host,{server:'workspace',tool:'workspace_write',mode:'write'}),/MCP_REMOTE_WRITE_REQUIRES_AUTHORITY/);
  await assert.rejects(callAuraMcpTool(a.host,{server:'workspace',tool:'repo_read',args:[]}),/MCP_ARGUMENTS_INVALID/);
  await assert.rejects(callAuraMcpTool(a.host,{server:'workspace',tool:'repo_read',mode:'unsafe'}),/MCP_MODE_INVALID/);
  assert.equal(a.calls.length,0);
});

test('question mode allows tool discovery but not actual MCP execution',async()=>{
  let executes=0;
  const toolbox=cognitiveQuestionToolbox({
    tools:{
      mcp_discover:{description:'read tool info',run:async()=>({server:'workspace',tools:[]})},
      mcp_tool:{description:'mutate',run:async()=>{executes++;}}
    }
  },()=>({events:[]}));
  assert.deepEqual(await toolbox.tools.mcp_discover.run({}),{server:'workspace',tools:[]});
  assert.equal(toolbox.tools.mcp_tool,undefined);
  assert.equal(executes,0);
});

test('qualified MCP aliases keep canonical deny and read/write checks',async()=>{
  const a=hostFixture();
  await callAuraMcpTool(a.host,{server:'workspace',tool:'workspace.repo_read'});
  assert.equal(a.calls[0].name,'repo_read');
  a.def.deny=['repo_read'];
  await assert.rejects(callAuraMcpTool(a.host,{server:'workspace',tool:'workspace.repo_read'}),/MCP_TOOL_DENIED/);
  await assert.rejects(callAuraMcpTool(a.host,{server:'workspace',tool:'workspace.workspace_write'}),/MCP_TOOL_WRITE_MODE_REQUIRED/);
  assert.equal(a.calls.length,1);
});
test('public PR reader uses the read-only fetch server with validated paths and no browser',async()=>{
  const calls=[];
  const host={servers:()=>({fetch:{id:'fetch',agentAccess:'read',deny:[]}}),listTools:async()=>[{name:'fetch',readOnly:true}],call:async(id,name,args,opts)=>{
    calls.push({id,name,args,opts});
    const data=args.url.includes('/files?')?[{filename:'src/a.js',patch:'+hello',status:'modified'}]:{number:301,head:{sha:'abc'},base:{sha:'def'},changed_files:1};
    return {content:[{type:'text',text:JSON.stringify(data)}]};
  }};
  assert.equal(githubRepoFromRemote('https://github.com/example/project.git'),'example/project');
  assert.equal(githubRepoFromRemote('git@github.com:example/project.git'),'example/project');
  assert.equal(githubRepoFromRemote('https://user:pass@github.com/example/project.git'),null);
  assert.equal((await readGithubPullRequest(host,{repository:'example/project',number:301})).headSha,'abc');
  assert.equal((await readGithubPullRequest(host,{repository:'example/project',number:301,section:'files',page:2})).records[0].filename,'src/a.js');
  assert.equal(calls[1].opts.readOnly,true);
  await assert.rejects(readGithubPullRequest(host,{repository:'../project',number:301}),/ARGUMENTS_INVALID/);
  assert.equal(calls.length,2);
});
