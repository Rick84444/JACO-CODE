import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {SecretStore,isExportableSecret} from '../../agents/lib/secret-store.mjs';
import {LINEAR_OAUTH as p,guidedCredentialMatches} from '../../runtime/src/lib/mcpIntegrationCatalog.mjs';
import {beginLinearOAuth,exchangeLinearOAuth,linearOAuthAccess,linearOAuthStatus,parseLinearOAuth} from '../../runtime/src/server/mcp/mcpOAuthTransport.mjs';
import {McpOAuthSession} from '../../runtime/src/server/mcp/mcpOAuthSession.mjs';
import {validateServerEntry} from '../../runtime/src/server/mcp/stdioMcpHost.mjs';

const origin=p.issuer,redirect='http://127.0.0.1:39123/mcp/oauth/callback';
const now=()=>1_800_000_000_000;
const metadata={issuer:origin,authorization_endpoint:origin+'/authorize',token_endpoint:origin+'/token',registration_endpoint:origin+'/register',code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],authorization_response_iss_parameter_supported:true};
const issued={access_token:'fixture-access',token_type:'Bearer',scope:'read',refresh_token:'fixture-refresh',expires_in:3600};
function fixture({resource=p.resource,asm=metadata,token=issued,badRead=false,refreshGate=null}={}){
  const calls=[];
  const fetchImpl=async(url,init={})=>{
    assert.equal(init.redirect,'error');
    calls.push({url,method:init.method,body:init.body});
    if(url===origin+'/.well-known/oauth-protected-resource/mcp')return Response.json({resource,authorization_servers:[origin],scopes_supported:['read']});
    if(url===origin+'/.well-known/oauth-authorization-server')return Response.json(asm);
    if(url===origin+'/register'){
      const d=JSON.parse(init.body);
      assert.equal(d.application_type,'native');assert.equal(d.token_endpoint_auth_method,'none');assert.equal(d.scope,'read');
      return Response.json({client_id:'fixture-client',redirect_uris:d.redirect_uris,token_endpoint_auth_method:'none'});
    }
    if(url===origin+'/token'){
      const body=init.body;
      assert.equal(body.get('resource'),p.resource);
      assert.equal(body.get('client_id'),'fixture-client');
      if(body.get('grant_type')==='refresh_token'){
        assert.equal(body.get('scope'),'read');
        if(refreshGate)await refreshGate;
        return Response.json({...token,access_token:'fixture-access-new',refresh_token:'fixture-refresh-new'});
      }
      return Response.json(token);
    }
    if(url===p.resource){
      assert.equal(init.headers.authorization,'Bearer fixture-access');
      const rpc=JSON.parse(init.body);
      if(rpc.method==='notifications/initialized')return new Response(null,{status:204});
      let result;
      if(rpc.method==='initialize')result={protocolVersion:'2025-06-18'};
      else if(rpc.method==='tools/list')result={tools:[{name:'list_teams',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}},{name:'save_issue',inputSchema:{type:'object'},annotations:{readOnlyHint:false}}]};
      else if(rpc.method==='tools/call'){
        assert.deepEqual(rpc.params,{name:'list_teams',arguments:{}});
        result={content:[{type:'text',text:JSON.stringify(badRead?{error:'fixture'}:{teams:[{id:'team-fixture'}]})}]};
      }else throw Error('unexpected RPC');
      return Response.json({jsonrpc:'2.0',id:rpc.id,result});
    }
    throw Error('unexpected network URL');
  };
  return {calls,fetchImpl};
}
function callback(attempt,extra={}){
  return attempt.redirectUri+'?'+new URLSearchParams({state:attempt.state,code:'fixture-code',iss:origin,...extra});
}
function storeFixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-oauth-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return new SecretStore({dir,env:{}});
}
test('Linear OAuth binds PKCE, read scope, resource and registered callback',async()=>{
  const f=fixture();
  const a=await beginLinearOAuth(redirect,{fetchImpl:f.fetchImpl,now});
  const u=new URL(a.url);
  assert.equal(u.origin,origin);assert.equal(u.pathname,'/authorize');
  assert.equal(u.searchParams.get('scope'),'read');
  assert.equal(u.searchParams.get('resource'),p.resource);
  assert.equal(u.searchParams.get('code_challenge'),createHash('sha256').update(a.verifier).digest('base64url'));
  const r=await exchangeLinearOAuth(a,callback(a),{fetchImpl:f.fetchImpl,now});
  const body=f.calls.at(-1).body;
  assert.equal(body.get('code_verifier'),a.verifier);assert.equal(body.get('redirect_uri'),redirect);
  assert.equal(r.scope,'read');assert.equal(r.expiresAt,now()+3600000);
  assert.equal(parseLinearOAuth(JSON.stringify(r)).clientId,'fixture-client');
  await assert.rejects(exchangeLinearOAuth(a,callback(a),{fetchImpl:f.fetchImpl,now}),/MCP_OAUTH_ATTEMPT_EXPIRED/);
});
test('wrong resource, issuer or PKCE metadata prevents registration',async()=>{
  for(const [options,error] of [[{resource:'https://example.org/mcp'},'MCP_OAUTH_RESOURCE_MISMATCH'],[{asm:{...metadata,token_endpoint:'https://example.org/token'}},'MCP_OAUTH_ISSUER_MISMATCH'],[{asm:{...metadata,code_challenge_methods_supported:['plain']}},'MCP_OAUTH_METADATA_UNSUPPORTED']]){
    const f=fixture(options);
    await assert.rejects(beginLinearOAuth(redirect,{fetchImpl:f.fetchImpl,now}),new RegExp(error));
    assert.ok(!f.calls.some(c=>c.method==='POST'));
  }
});
test('callback mismatch, missing issuer and duplicated state never exchange a code',async()=>{
  const f=fixture();const a=await beginLinearOAuth(redirect,{fetchImpl:f.fetchImpl,now});
  await assert.rejects(exchangeLinearOAuth(a,callback(a,{state:'wrong'}),{fetchImpl:f.fetchImpl,now}),/MCP_OAUTH_STATE_MISMATCH/);
  await assert.rejects(exchangeLinearOAuth(a,callback(a,{iss:'https://example.org'}),{fetchImpl:f.fetchImpl,now}),/MCP_OAUTH_ISSUER_MISMATCH/);
  const u=new URL(callback(a));u.searchParams.delete('iss');
  await assert.rejects(exchangeLinearOAuth(a,u.href,{fetchImpl:f.fetchImpl,now}),/MCP_OAUTH_ISSUER_MISMATCH/);
  await assert.rejects(exchangeLinearOAuth(a,callback(a)+'&state=duplicate',{fetchImpl:f.fetchImpl,now}),/MCP_OAUTH_CALLBACK_INVALID/);
  assert.equal(f.calls.filter(c=>c.url===origin+'/token').length,0);
});
test('scope expansion is refused even when provider returns a bearer token',async()=>{
  const f=fixture({token:{...issued,scope:'read write'}});
  const a=await beginLinearOAuth(redirect,{fetchImpl:f.fetchImpl,now});
  await assert.rejects(exchangeLinearOAuth(a,callback(a),{fetchImpl:f.fetchImpl,now}),/MCP_OAUTH_SCOPE_MISMATCH/);
});
test('refresh is singleflight, persists rotation and keeps credential scoped',async t=>{
  const store=storeFixture(t),f=fixture();
  const a=await beginLinearOAuth(redirect,{fetchImpl:f.fetchImpl,now});
  const r=await exchangeLinearOAuth(a,callback(a),{fetchImpl:f.fetchImpl,now});
  r.expiresAt=now()-1;store.set(p.credentialRef,JSON.stringify(r));
  const results=await Promise.all([linearOAuthAccess({store,fetchImpl:f.fetchImpl,now}),linearOAuthAccess({store,fetchImpl:f.fetchImpl,now})]);
  assert.deepEqual(results,['fixture-access-new','fixture-access-new']);
  assert.equal(f.calls.filter(c=>c.body instanceof URLSearchParams&&c.body.get('grant_type')==='refresh_token').length,1);
  assert.equal(parseLinearOAuth(store.get(p.credentialRef)).refreshToken,'fixture-refresh-new');
  assert.equal(linearOAuthStatus({store,now}).configured,true);
  assert.equal(isExportableSecret(p.credentialRef),false);
  assert.equal(guidedCredentialMatches(p.id,{transport:'http',url:p.resource,tokenEnv:p.credentialRef}),true);
  assert.throws(()=>validateServerEntry('other',{transport:'http',url:p.resource,tokenEnv:p.credentialRef}),/MCP_CREDENTIAL_SCOPE_INVALID/);
});
test('in-flight refresh cannot restore a credential after local disconnect',async t=>{
  const store=storeFixture(t);let release;const gate=new Promise(r=>{release=r;});
  const f=fixture({refreshGate:gate});
  const a=await beginLinearOAuth(redirect,{fetchImpl:f.fetchImpl,now});
  const r=await exchangeLinearOAuth(a,callback(a),{fetchImpl:f.fetchImpl,now});r.expiresAt=now()-1;
  store.set(p.credentialRef,JSON.stringify(r));
  const pending=linearOAuthAccess({store,fetchImpl:f.fetchImpl,now});
  store.delete(p.credentialRef);release();
  await assert.rejects(pending,/MCP_OAUTH_CREDENTIAL_CHANGED/);
  assert.equal(store.has(p.credentialRef),false);
});
for(const badRead of [false,true]){
  test('actual loopback callback '+(badRead?'rejects invalid proof without saving':'persists only after MCP account read'),async t=>{
    const f=fixture({badRead}),store=storeFixture(t),defs={};
    const host={servers:()=>defs,saveServer:(id,def)=>{defs[id]=validateServerEntry(id,def);},start:async()=>[],resetConnection:()=>{},removeServer:id=>{delete defs[id];}};
    const session=new McpOAuthSession({host,store,fetchImpl:f.fetchImpl,now});
    t.after(()=>session.cancel());
    const started=await session.start(),u=new URL(started.url);
    const cb=u.searchParams.get('redirect_uri')+'?'+new URLSearchParams({state:u.searchParams.get('state'),iss:origin,code:'fixture-code'});
    assert.equal(store.has(p.credentialRef),false);
    const response=await fetch(cb);
    assert.equal(response.status,badRead?400:200);await response.text();
    assert.equal(store.has(p.credentialRef),!badRead);
    if(badRead){assert.deepEqual(defs,{});assert.equal(session.status().state,'ERROR');}
    else{
      assert.equal(session.status().state,'READ_VERIFIED');
      assert.deepEqual(session.status().proof,{teamCount:1});
      assert.equal(session.status().agentExecutionVerified,false);
      assert.equal(defs[p.id].agentAccess,'read');
      assert.doesNotMatch(JSON.stringify(session.status()),/fixture-access|fixture-refresh|team-fixture/);
      assert.equal(session.disconnect().remoteRevocationVerified,false);
      assert.equal(store.has(p.credentialRef),false);assert.deepEqual(defs,{});
    }
  });
}
