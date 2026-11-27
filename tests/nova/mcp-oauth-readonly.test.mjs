import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {LINEAR_OAUTH as p,beginLinearOAuth,completeLinearOAuth,refreshLinearOAuth,createReadonlyOAuthClient} from '../../runtime/src/server/mcp/oauthReadonly.mjs';
import {ReadonlyMcpOAuthSession} from '../../runtime/src/server/mcp/oauthReadonlySession.mjs';

const redirectUri='http://127.0.0.1:43210/mcp/oauth/callback';
function fixture({resource={},metadata={},registration={},token={},rejectNetwork=false,provider=p}={}){
  const p=provider;
  const calls=[];
  const fetchImpl=async(url,init)=>{
    assert.equal(init.redirect,'error');
    calls.push({url,init});
    if(rejectNetwork)throw Error('private data must never leak');
    if(url===p.protectedResource)return Response.json({resource:p.resource,authorization_servers:[p.issuer],...resource});
    if(url===p.metadata)return Response.json({issuer:p.issuer,authorization_endpoint:p.authorize,token_endpoint:p.token,registration_endpoint:p.register,scopes_supported:['read','write'],response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],authorization_response_iss_parameter_supported:true,...metadata});
    if(url===p.register){
      const body=JSON.parse(init.body);
      assert.equal(body.client_name,'JACO');
      assert.equal(body.scope,'read');
      assert.equal(body.token_endpoint_auth_method,'none');
      assert.deepEqual(body.grant_types,['authorization_code','refresh_token']);
      return Response.json({client_id:'fixture-client',redirect_uris:body.redirect_uris,token_endpoint_auth_method:'none',scope:'read',...registration});
    }
    if(url===p.token)return Response.json({access_token:'fixture-access',token_type:'Bearer',refresh_token:'fixture-refresh',expires_in:3600,scope:'read',...token});
    throw Error('unexpected network destination');
  };
  return {fetchImpl,calls};
}
const callback=(a,overrides={})=>a.redirectUri+'?'+new URLSearchParams({state:a.state,iss:p.issuer,code:'fixture-code',...overrides});

test('native read-only OAuth uses state, S256, public registration and pinned resource',async()=>{
  const f=fixture(),a=await beginLinearOAuth({redirectUri,fetchImpl:f.fetchImpl,now:()=>1000});
  const u=new URL(a.url);
  assert.equal(u.origin+u.pathname,p.authorize);
  assert.equal(u.searchParams.get('scope'),'read');
  assert.equal(u.searchParams.get('resource'),p.resource);
  assert.equal(u.searchParams.get('code_challenge'),createHash('sha256').update(a.verifier).digest('base64url'));
  assert.ok(!a.url.includes(a.verifier));
  const s=await completeLinearOAuth(a,callback(a),{fetchImpl:f.fetchImpl,now:()=>2000});
  assert.equal(s.expiresAt,3602000);
  assert.equal(s.scope,'read');
  const body=f.calls.at(-1).init.body;
  assert.equal(body.get('code_verifier'),a.verifier);
  assert.equal(body.get('resource'),p.resource);
  assert.equal(body.get('client_secret'),null);
  await assert.rejects(completeLinearOAuth(a,callback(a),{fetchImpl:f.fetchImpl,now:()=>2000}),/MCP_OAUTH_ATTEMPT_INVALID/);
  assert.equal(f.calls.length,4);
  const refreshed=await refreshLinearOAuth(s,{fetchImpl:f.fetchImpl,now:()=>3000});
  assert.equal(refreshed.scope,'read');
  assert.equal(f.calls.at(-1).init.body.get('grant_type'),'refresh_token');
  assert.equal(f.calls.at(-1).init.body.get('refresh_token'),'fixture-refresh');
});
test('wrong resource, issuer, endpoints and absent S256 cannot register a client',async()=>{
  for(const [options,code] of [
    [{resource:{resource:'https://example.org/mcp'}},'RESOURCE_MISMATCH'],
    [{resource:{authorization_servers:[p.issuer,'https://example.org']}},'RESOURCE_MISMATCH'],
    [{metadata:{issuer:'https://example.org'}},'METADATA_MISMATCH'],
    [{metadata:{token_endpoint:'https://example.org/token'}},'METADATA_MISMATCH'],
    [{metadata:{code_challenge_methods_supported:['plain']}},'CONTRACT_UNSUPPORTED']
  ]){
    const f=fixture(options);
    await assert.rejects(beginLinearOAuth({redirectUri,fetchImpl:f.fetchImpl}),new RegExp(code));
    assert.ok(!f.calls.some(c=>c.url===p.register));
  }
});
test('wrong state, issuer, callback, replay and expired attempts cannot exchange code',async()=>{
  const f=fixture(),a=await beginLinearOAuth({redirectUri,fetchImpl:f.fetchImpl,now:()=>1000});
  for(const u of [callback(a,{state:'wrong'}),callback(a,{iss:'https://example.org'}),callback(a)+'&state=duplicate',callback(a).replace('127.0.0.1','localhost')]){
    await assert.rejects(completeLinearOAuth(a,u,{fetchImpl:f.fetchImpl,now:()=>2000}),/MCP_OAUTH_CALLBACK/);
  }
  await assert.rejects(completeLinearOAuth(a,callback(a),{fetchImpl:f.fetchImpl,now:()=>400000}),/MCP_OAUTH_ATTEMPT_INVALID/);
  assert.equal(f.calls.length,3);
  await assert.rejects(beginLinearOAuth({redirectUri:'https://example.org/mcp/oauth/callback',fetchImpl:f.fetchImpl}),/CALLBACK_INVALID/);
});
test('rejects confidential registration, expanded scopes, and invalid refresh binding',async()=>{
  const f=fixture({registration:{client_secret:'fixture-secret'}});
  await assert.rejects(beginLinearOAuth({redirectUri,fetchImpl:f.fetchImpl}),/REGISTRATION_INVALID/);
  const g=fixture({token:{scope:'read write'}});
  const a=await beginLinearOAuth({redirectUri,fetchImpl:g.fetchImpl});
  await assert.rejects(completeLinearOAuth(a,callback(a),{fetchImpl:g.fetchImpl}),/SCOPE_MISMATCH/);
  await assert.rejects(refreshLinearOAuth({issuer:'https://example.org',resource:p.resource,scope:'read',clientId:'fixture-client',refreshToken:'fixture-refresh'},{fetchImpl:g.fetchImpl}),/REFRESH_INVALID/);
});
test('loopback callback authorizes once and never returns token to browser or status',async t=>{
  const f=fixture();let internal;
  const session=new ReadonlyMcpOAuthSession({fetchImpl:f.fetchImpl,onAuthorized:async value=>{internal=value;}});
  t.after(()=>session.cancel());
  const started=await session.start();
  const u=new URL(started.url);
  const uri=u.searchParams.get('redirect_uri');
  const state=u.searchParams.get('state');
  assert.equal(new URL(uri).hostname,'127.0.0.1');
  const wrong=await fetch(uri+'?'+new URLSearchParams({state:'wrong',iss:p.issuer,code:'fixture-code'}));
  assert.equal(wrong.status,400);
  assert.equal(internal,undefined);
  const response=await fetch(uri+'?'+new URLSearchParams({state,iss:p.issuer,code:'fixture-code'}));
  assert.equal(response.status,200);
  assert.doesNotMatch(await response.text(),/fixture-access|fixture-refresh/);
  assert.equal(internal.accessToken,'fixture-access');
  assert.equal(session.status().state,'authorized');
  assert.equal(session.status().accountVerified,false);
  assert.doesNotMatch(JSON.stringify(session.status()),/fixture-access|fixture-refresh/);
});

const secondProvider=Object.freeze({
  issuer:'https://auth.example.invalid',
  resource:'https://mcp.example.invalid/tools',
  metadata:'https://auth.example.invalid/.well-known/oauth-authorization-server',
  protectedResource:'https://mcp.example.invalid/.well-known/oauth-protected-resource/tools',
  authorize:'https://auth.example.invalid/authorize',
  token:'https://auth.example.invalid/token',
  register:'https://auth.example.invalid/register',
  scope:'read'
});

test('same OAuth engine works with a separate reviewed provider contract',async()=>{
  const contract={...secondProvider};
  const client=createReadonlyOAuthClient(contract);
  contract.token='https://untrusted.example.invalid/token';
  const f=fixture({provider:secondProvider});
  const a=await client.begin({redirectUri,fetchImpl:f.fetchImpl});
  assert.equal(new URL(a.url).origin,secondProvider.issuer);
  const cb=callback(a,{iss:secondProvider.issuer});
  const auth=await client.complete(a,cb,{fetchImpl:f.fetchImpl});
  assert.equal(auth.issuer,secondProvider.issuer);
  assert.equal(auth.resource,secondProvider.resource);
  const rotated=await client.refresh(auth,{fetchImpl:f.fetchImpl});
  assert.equal(rotated.issuer,secondProvider.issuer);
  assert.deepEqual(f.calls.map(c=>c.url),[secondProvider.protectedResource,secondProvider.metadata,secondProvider.register,secondProvider.token,secondProvider.token]);
});

test('authorization attempts and credentials cannot cross provider engines',async()=>{
  const client=createReadonlyOAuthClient(secondProvider);
  const f=fixture({provider:secondProvider});
  const a=await client.begin({redirectUri,fetchImpl:f.fetchImpl});
  await assert.rejects(completeLinearOAuth(a,callback(a),{fetchImpl:f.fetchImpl}),/ATTEMPT_INVALID/);
  await assert.rejects(client.complete({...a},callback(a,{iss:secondProvider.issuer}),{fetchImpl:f.fetchImpl}),/ATTEMPT_INVALID/);
  const auth=await client.complete(a,callback(a,{iss:secondProvider.issuer}),{fetchImpl:f.fetchImpl});
  await assert.rejects(refreshLinearOAuth(auth,{fetchImpl:f.fetchImpl}),/REFRESH_INVALID/);
  assert.equal(f.calls.length,4);
});

test('generic client remains fail-closed on unreviewed destinations and scopes',async()=>{
  for(const patch of [{token:'http://example.invalid/token'},{token:'https://user@example.invalid/token'},{scope:'write'},{extra:'unknown'}]){
    assert.throws(()=>createReadonlyOAuthClient({...secondProvider,...patch}),/PROVIDER_CONTRACT_INVALID/);
  }
  const client=createReadonlyOAuthClient(secondProvider);
  const f=fixture({provider:secondProvider,metadata:{token_endpoint:'https://untrusted.example.invalid/token'}});
  await assert.rejects(client.begin({redirectUri,fetchImpl:f.fetchImpl}),/METADATA_MISMATCH/);
  assert.equal(f.calls.length,2);
});

test('loopback session accepts a reviewed OAuth engine without Linear-specific network calls',async t=>{
  const f=fixture({provider:secondProvider});
  const client=createReadonlyOAuthClient(secondProvider);
  let internal;
  const session=new ReadonlyMcpOAuthSession({fetchImpl:f.fetchImpl,oauthClient:client,onAuthorized:async value=>{internal=value;}});
  t.after(()=>session.cancel());
  const {url}=await session.start();
  const u=new URL(url);
  const uri=u.searchParams.get('redirect_uri');
  const response=await fetch(uri+'?'+new URLSearchParams({state:u.searchParams.get('state'),iss:secondProvider.issuer,code:'fixture-code'}));
  assert.equal(response.status,200);
  assert.equal(internal.issuer,secondProvider.issuer);
  assert.doesNotMatch(await response.text(),/fixture-access|fixture-refresh/);
});
