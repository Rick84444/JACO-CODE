import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HttpMcpClient } from '../../runtime/src/server/mcp/httpMcpClient.mjs';
import { StdioMcpHost } from '../../runtime/src/server/mcp/stdioMcpHost.mjs';
import { createGithubAuth } from '../../runtime/src/server/github/githubAuth.mjs';

test('GitHub login returns after process spawn, prevents duplicates, and checks stored accounts separately',async()=>{
  const child=new EventEmitter(); let launches=0;
  const auth=createGithubAuth({run:async()=>({stdout:'operator\nsecret=value\n'}),launch:(command,args)=>{ launches++;assert.equal(command,'git');assert.deepEqual(args,['credential-manager','github','login','--browser']);queueMicrotask(()=>child.emit('spawn'));return child; }});
  assert.equal((await auth.startLogin()).started,true);
  assert.equal((await auth.startLogin()).started,false);assert.equal(launches,1);
  child.emit('exit',0); const status=await auth.status();assert.deepEqual(status.accounts,['operator']);assert.equal(status.loginInProgress,false);
});
test('GitHub launch failure is not reported as a successful login start',async()=>{
  const auth=createGithubAuth({launch:()=>{const child=new EventEmitter();queueMicrotask(()=>child.emit('error',Object.assign(Error('failed'),{code:'ENOENT'})));return child;}});
  await assert.rejects(()=>auth.startLogin(),/LAUNCH_FAILED:ENOENT/);
});
test('HTTP MCP initializes, carries session, discovers paginated tools and parses SSE',async()=>{
  const calls=[];
  const client=new HttpMcpClient('fixture',{url:'https://example.org/mcp',tokenEnv:'HF_TOKEN'},{env:{HF_TOKEN:'test-token'},fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body);calls.push(body.method);
    assert.equal(options.headers.authorization,'Bearer test-token');assert.equal(options.redirect,'error');
    if(body.method==='notifications/initialized')return new Response(null,{status:202});
    if(body.method==='initialize')return Response.json({jsonrpc:'2.0',id:body.id,result:{protocolVersion:'2025-06-18'}},{headers:{'mcp-session-id':'private-session'}});
    assert.equal(options.headers['Mcp-Session-Id'],'private-session');
    const result=body.params.cursor?{tools:[{name:'second',annotations:{readOnlyHint:true}}]}:{tools:[{name:'first'}],nextCursor:'next'};
    return new Response(`data: ${JSON.stringify({jsonrpc:'2.0',id:body.id,result})}\n\n`,{headers:{'content-type':'text/event-stream'}});
  }});
  await client.start(); assert.equal(client.initialized,true);assert.equal(client.tools.length,2);assert.equal(client.tools[0].readOnly,false);
  assert.deepEqual(calls,['initialize','notifications/initialized','tools/list','tools/list']);
});
test('HTTP MCP refuses missing credentials and does not expose remote error bodies',async()=>{
  let calls=0; const def={url:'https://example.org/mcp',tokenEnv:'HF_TOKEN'};
  const client=new HttpMcpClient('fixture',def,{env:{},fetchImpl:async()=>{calls++;throw Error('secret');}});
  await assert.rejects(()=>client.start(),/MCP_CREDENTIAL_REQUIRED/);assert.equal(calls,0);
  const denied=new HttpMcpClient('fixture',{url:def.url},{env:{},fetchImpl:async()=>new Response('private credential',{status:401})});
  await assert.rejects(()=>denied.start(),/MCP_AUTH_REQUIRED/);assert.equal(denied.initialized,false);
});
test('Hugging Face setup preserves other servers, persists only a credential reference, and can disconnect',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-mcp-integration-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const configFile=path.join(dir,'servers.json');fs.writeFileSync(configFile,JSON.stringify({servers:{custom:{command:'node',args:['server.mjs']}}}));
  const host=new StdioMcpHost({configFile,repoRoot:dir,runtimeRoot:dir});
  host.configureHuggingFace({tokenEnv:'HF_TOKEN'});assert.ok(host.servers().custom);assert.equal(host.servers().huggingface.transport,'http');
  assert.throws(()=>host.configureHuggingFace({tokenEnv:'GATEWAY_TOKEN'}),/TOKEN_ENV_INVALID/);
  host.configureHuggingFace({enabled:false});assert.equal(host.servers().huggingface,undefined);
});
test('remote tools without read-only annotation do not obtain write authority',async()=>{
  const host=new StdioMcpHost({});host.client=()=>({def:{transport:'http'},start:async()=>{},tools:[{name:'create_job',readOnly:false}],request:()=>{throw Error('must not dispatch');}});
  await assert.rejects(()=>host.call('hf','create_job'),/REMOTE_WRITE_REQUIRES_AUTHORITY/);
});
test('invalid remote config is isolated from other MCP servers',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-mcp-config-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const configFile=path.join(dir,'servers.json');fs.writeFileSync(configFile,JSON.stringify({servers:{invalid:{transport:'http',url:'https://user:secret@example.org/mcp'}}}));
  const host=new StdioMcpHost({configFile,repoRoot:dir,runtimeRoot:dir});
  assert.ok(host.servers().git);const status=host.status().find(s=>s.id==='invalid');assert.equal(status.status,'FAILED');assert.ok(!JSON.stringify(status).includes('secret'));
});
test('remote MCP requires TLS verification before dispatch',async()=>{
  const client=new HttpMcpClient('fixture',{url:'https://example.org/mcp'},{env:{NODE_TLS_REJECT_UNAUTHORIZED:'0'},fetchImpl:()=>{throw Error('must not dispatch');}});
  await assert.rejects(()=>client.start(),/MCP_TLS_VERIFICATION_REQUIRED/);
});
