import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SecretStore,hydrateEnvFromStore,isExportableSecret} from '../../agents/lib/secret-store.mjs';
import {HttpMcpClient,mcpCredential} from '../../runtime/src/server/mcp/httpMcpClient.mjs';
import {createGuidedMcpConnection} from '../../runtime/src/server/mcp/guidedMcpConnection.mjs';
import {guidedMcpPreset} from '../../runtime/src/lib/mcpIntegrationCatalog.mjs';
import {validateServerEntry} from '../../runtime/src/server/mcp/stdioMcpHost.mjs';

function fixture(t,id='github-remote',{reject=false,invalid=false,missing=false,reconnectFailure=false}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-guided-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const env={JACO_STATE_DIR:dir};
  const store=new SecretStore({env});
  const preset=guidedMcpPreset(id);
  const defs={},requests=[],records=[],resets=[];
  const fetchImpl=async(url,options)=>{
    assert.equal(url,preset.target);
    assert.equal(options.redirect,'error');
    assert.ok(['Bearer fixture-not-a-real-credential','Bearer fixture-replacement','Bearer fixture-rejected'].includes(options.headers.authorization));
    const rpc=JSON.parse(options.body);requests.push(rpc.method);
    if(reject||options.headers.authorization==='Bearer fixture-rejected')return new Response(null,{status:401});
    if(rpc.method==='notifications/initialized')return new Response(null,{status:204});
    let result;
    if(rpc.method==='initialize')result={protocolVersion:'2025-06-18'};
    else if(rpc.method==='tools/list')result={tools:missing?[]:[{name:preset.tool,inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:id==='github-remote'}}]};
    else if(rpc.method==='tools/call'){
      assert.deepEqual(rpc.params,{name:preset.tool,arguments:{}});
      result={content:[{type:'text',text:JSON.stringify(invalid?{message:'no proof'}:id==='render'?[{id:'workspace-fixture'}]:{login:'fixture-user',id:1})}]};
    }else throw Error('unexpected request');
    return Response.json({jsonrpc:'2.0',id:rpc.id,result});
  };
  const host={servers:()=>defs,saveServer:(id,def)=>{defs[id]=validateServerEntry(id,def);},start:async id=>{
    if(reconnectFailure)throw Error('MCP_TRANSPORT_DNS');
    assert.ok(['fixture-not-a-real-credential','fixture-replacement'].includes(mcpCredential(id,defs[id],env)));
    return [{name:preset.tool}];
  },resetConnection:id=>resets.push(id),record:(id,entry)=>records.push({id,...entry})};
  const connect=createGuidedMcpConnection({host,store,env,createClient:(id,def,probeEnv)=>new HttpMcpClient(id,def,{env:probeEnv,fetchImpl})});
  return {connect,defs,store,env,requests,records,resets,preset};
}
for(const id of ['github-remote','render']){
  test(id+' performs account read before persisting, with no environment export',async t=>{
    const f=fixture(t,id);
    const result=await f.connect(id,{token:'fixture-not-a-real-credential',allowOpenLogin:true});
    assert.equal(result.state,'READ_PROBE_VERIFIED');
    assert.equal(result.agentExecutionVerified,false);
    assert.deepEqual(f.requests,['initialize','notifications/initialized','tools/list','tools/call']);
    assert.equal(f.defs[id].agentAccess,'read');
    assert.equal(f.defs[id].allowOpenLogin,true);
    assert.equal(f.defs[id].tokenEnv,f.preset.credentialRef);
    assert.equal(isExportableSecret(f.preset.credentialRef),false);
    assert.deepEqual(hydrateEnvFromStore(f.env,f.store),[]);
    assert.equal(f.env[f.preset.credentialRef],undefined);
    assert.equal(mcpCredential(id,{...f.defs[id],url:'https://example.org/mcp'},f.env),'');
    assert.throws(()=>validateServerEntry(id,{...f.defs[id],url:'https://example.org/mcp'}),/MCP_CREDENTIAL_SCOPE_INVALID/);
    assert.equal(f.records.length,1);
    assert.doesNotMatch(JSON.stringify(result),/fixture-not-a-real-credential|fixture-user/);
    await assert.rejects(f.connect(id,{token:'replacement'}),/MCP_GUIDED_REPLACEMENT_NOT_SUPPORTED/);
    assert.equal((await f.connect(id,{})).state,'READ_PROBE_VERIFIED');
  });
}
for(const [mode,code] of [['reject','MCP_AUTH_REQUIRED'],['invalid','MCP_GUIDED_PROOF_INVALID'],['missing','MCP_GUIDED_PROBE_UNAVAILABLE']]){
  test('failed '+mode+' does not store or register credentials',async t=>{
    const f=fixture(t,'github-remote',{[mode]:true});
    await assert.rejects(f.connect('github-remote',{token:'fixture-not-a-real-credential'}),new RegExp(code));
    assert.deepEqual(f.defs,{});
    assert.deepEqual(f.store.list(),[]);
    assert.deepEqual(f.records,[]);
  });
}
test('configuration survives a verified probe followed by reconnect failure without false ready status',async t=>{
  const f=fixture(t,'render',{reconnectFailure:true});
  const r=await f.connect('render',{token:'fixture-not-a-real-credential'});
  assert.equal(r.state,'CONFIGURED_RECONNECT_REQUIRED');
  assert.equal(r.toolCount,null);
  assert.deepEqual(f.records,[]);
  assert.ok(f.defs.render);
});
test('directory entries and arbitrary URLs cannot use guided onboarding',async t=>{
  const f=fixture(t);
  await assert.rejects(f.connect('etsy',{token:'fixture-not-a-real-credential'}),/MCP_GUIDED_UNSUPPORTED/);
  await assert.rejects(f.connect('github-remote',{token:'fixture-not-a-real-credential',url:'https://example.org'}),/MCP_GUIDED_INPUT_INVALID/);
  assert.deepEqual(f.requests,[]);
});

test('scoped replacement is verified before retiring session and preserves connector permissions',async t=>{
  const f=fixture(t);
  const id='github-remote';
  await f.connect(id,{token:'fixture-not-a-real-credential',allowOpenLogin:true});
  f.defs[id].deny=['dangerous_tool'];
  const original=JSON.stringify(f.defs[id]);
  await assert.rejects(f.connect(id,{token:'fixture-rejected',replaceCredential:true}),/MCP_AUTH_REQUIRED/);
  assert.equal(f.store.get(f.preset.credentialRef),'fixture-not-a-real-credential');
  assert.deepEqual(f.resets,[]);
  const result=await f.connect(id,{token:'fixture-replacement',replaceCredential:true});
  assert.equal(result.credentialReplaced,true);
  assert.equal(result.state,'READ_PROBE_VERIFIED');
  assert.equal(f.store.get(f.preset.credentialRef),'fixture-replacement');
  assert.equal(JSON.stringify(f.defs[id]),original);
  assert.deepEqual(f.resets,[id]);
  f.defs[id].agentAccess='write';
  await assert.rejects(f.connect(id,{token:'fixture-not-a-real-credential',replaceCredential:true}),/MCP_GUIDED_REPLACEMENT_NOT_SUPPORTED/);
});
test('vault compare-and-set cannot overwrite a concurrent credential change',t=>{
  const f=fixture(t);
  const key=f.preset.credentialRef;
  f.store.set(key,'fixture-one');
  f.store.set(key,'fixture-two');
  assert.equal(f.store.replaceIfCurrent(key,'fixture-one','fixture-three'),false);
  assert.equal(f.store.get(key),'fixture-two');
  assert.equal(f.store.replaceIfCurrent(key,'fixture-two','fixture-three'),true);
  assert.equal(f.store.get(key),'fixture-three');
});
test('authentication loss retires tools and session without replaying the call',async()=>{
  let requests=0;
  const c=new HttpMcpClient('render',{transport:'http',url:'https://mcp.render.com/mcp',tokenEnv:'RENDER_API_KEY'},{env:{RENDER_API_KEY:'fixture'},fetchImpl:async()=>{requests++;return new Response(null,{status:401});}});
  c.initialized=true;c.session='old-session';c.tools=[{name:'list_services'}];
  await assert.rejects(c.request('tools/call',{name:'list_services',arguments:{}}),/MCP_AUTH_REQUIRED/);
  assert.equal(c.initialized,false);
  assert.equal(c.session,null);
  assert.deepEqual(c.tools,[]);
  assert.equal(c.error,'MCP_AUTH_REQUIRED');
  assert.equal(requests,1);
});
