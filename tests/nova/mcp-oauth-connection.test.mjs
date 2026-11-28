import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SecretStore,credential,hydrateEnvFromStore,isExportableSecret} from '../../agents/lib/secret-store.mjs';
import {getVaultSecret,saveVaultSecret} from '../../agents/lib/vault-tools.mjs';
import {LINEAR_OAUTH as p} from '../../runtime/src/server/mcp/oauthReadonly.mjs';
import {LINEAR_OAUTH_REF as ref,ReadonlyOAuthCredentials} from '../../runtime/src/server/mcp/oauthReadonlyCredentials.mjs';
import {HttpMcpClient} from '../../runtime/src/server/mcp/httpMcpClient.mjs';
import {StdioMcpHost,validateServerEntry} from '../../runtime/src/server/mcp/stdioMcpHost.mjs';
import {createReadonlyOAuthConnection} from '../../runtime/src/server/mcp/oauthReadonlyConnection.mjs';

const definition={transport:'http',url:p.resource,tokenEnv:ref,agentAccess:'read'};
const account=(expiresAt)=>({issuer:p.issuer,resource:p.resource,scope:'read',clientId:'fixture-client',accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt});
const proof=new Date(1000).toISOString();
function fixture(t,fetchImpl,now=()=>1000){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-oauth-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const env={JACO_STATE_DIR:path.join(root,'vault')};
  const store=new SecretStore({env});
  const credentials=new ReadonlyOAuthCredentials({store,fetchImpl,now});
  return {root,store,env,credentials};
}
const tokenResponse=(access='fixture-rotated',refresh='fixture-rotated-refresh')=>Response.json({access_token:access,refresh_token:refresh,token_type:'Bearer',scope:'read',expires_in:3600});

test('verified OAuth session stays encrypted and cannot be retrieved by generic vault methods',async t=>{
  const f=fixture(t);
  f.credentials.installVerified(account(100000),proof);
  assert.equal(f.credentials.status().state,'AUTHORIZED');
  assert.equal(await f.credentials.access('linear',definition),'fixture-access');
  assert.equal(credential(ref,{store:f.store,env:{[ref]:'fixture-wrong'}}),'');
  assert.deepEqual(hydrateEnvFromStore(f.env,f.store),[]);
  assert.equal(f.env[ref],undefined);
  assert.doesNotMatch(fs.readFileSync(f.store.file,'utf8'),/fixture-access|fixture-refresh/);
  assert.doesNotMatch(JSON.stringify(f.credentials.status()),/fixture-access|fixture-refresh/);
  assert.equal((await getVaultSecret({key:ref})).error,'VAULT_CONNECTOR_CREDENTIAL_SCOPED');
  assert.equal((await saveVaultSecret({key:ref,value:'not-a-real-credential'})).error,'VAULT_CONNECTOR_CREDENTIAL_SCOPED');
  await assert.rejects(f.credentials.access('other',definition),/SCOPE_INVALID/);
  await assert.rejects(f.credentials.access('linear',{...definition,url:'https://example.org/mcp'}),/SCOPE_INVALID/);
  assert.throws(()=>f.credentials.installVerified(account(100000),proof),/CREDENTIAL_EXISTS/);
});
test('refresh is single flight and a second vault reader cannot replay a claimed refresh',async t=>{
  let finish,calls=0,clock=1000;
  const f=fixture(t,async(url,init)=>{
    assert.equal(url,p.token);
    assert.equal(init.body.get('refresh_token'),'fixture-refresh');
    calls++;
    return new Promise(resolve=>{finish=resolve;});
  },()=>clock);
  f.credentials.installVerified(account(100000),proof);
  clock=100001;
  const a=f.credentials.access('linear',definition),b=f.credentials.access('linear',definition);
  assert.equal(calls,1);
  assert.equal(f.credentials.status().state,'REFRESHING');
  const second=new ReadonlyOAuthCredentials({store:new SecretStore({env:f.env}),now:()=>clock,fetchImpl:async()=>{throw Error('must not dispatch');}});
  await assert.rejects(second.access('linear',definition),/REFRESH_IN_PROGRESS/);
  finish(tokenResponse());
  assert.deepEqual(await Promise.all([a,b]),['fixture-rotated','fixture-rotated']);
  assert.equal(await second.access('linear',definition),'fixture-rotated');
  assert.equal(calls,1);
  assert.equal(f.credentials.invalidate('fixture-access'),false,'stale rejection must not revoke new session');
});
test('ambiguous refresh failure requires new consent and cannot retry old token',async t=>{
  let clock=1000,calls=0;
  const f=fixture(t,async()=>{calls++;throw Error('network lost');},()=>clock);
  f.credentials.installVerified(account(100000),proof);
  clock=100001;
  await assert.rejects(f.credentials.access('linear',definition),/REAUTH_REQUIRED/);
  await assert.rejects(f.credentials.access('linear',definition),/REAUTH_REQUIRED/);
  assert.equal(calls,1);
  assert.equal(f.credentials.status().credentialConfigured,false);
  assert.doesNotMatch(f.store.get(ref),/fixture-refresh/);
});
test('disconnect during refresh cannot resurrect a removed session',async t=>{
  let finish,clock=1000;
  const f=fixture(t,async()=>new Promise(resolve=>{finish=resolve;}),()=>clock);
  f.credentials.installVerified(account(100000),proof);clock=100001;
  const pending=f.credentials.access('linear',definition);
  f.store.delete(ref);
  finish(tokenResponse());
  await assert.rejects(pending,/REAUTH_REQUIRED/);
  assert.equal(f.credentials.status().state,'NOT_CONFIGURED');
});

function provider({invalid=false}={}){
  const calls=[];
  let reject=false;
  const fetchImpl=async(url,init={})=>{
    calls.push(url);
    assert.equal(init.redirect,'error');
    if(url===p.protectedResource)return Response.json({resource:p.resource,authorization_servers:[p.issuer]});
    if(url===p.metadata)return Response.json({issuer:p.issuer,authorization_endpoint:p.authorize,token_endpoint:p.token,registration_endpoint:p.register,scopes_supported:['read'],response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],authorization_response_iss_parameter_supported:true});
    if(url===p.register)return Response.json({client_id:'fixture-client',redirect_uris:JSON.parse(init.body).redirect_uris,token_endpoint_auth_method:'none',scope:'read'});
    if(url===p.token)return tokenResponse('fixture-access','fixture-refresh');
    assert.equal(url,p.resource);
    assert.equal(init.headers.authorization,'Bearer fixture-access');
    if(reject)return new Response(null,{status:401});
    const rpc=JSON.parse(init.body);
    if(rpc.method==='notifications/initialized')return new Response(null,{status:204});
    let result;
    if(rpc.method==='initialize')result={protocolVersion:'2025-06-18'};
    else if(rpc.method==='tools/list')result={tools:[{name:'get_user',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']},annotations:{readOnlyHint:true}},{name:'save_issue',inputSchema:{type:'object'},annotations:{readOnlyHint:false}}]};
    else if(rpc.method==='tools/call'){
      assert.deepEqual(rpc.params,{name:'get_user',arguments:{query:'me'}});
      result={content:[{type:'text',text:JSON.stringify(invalid?{message:'no identity'}:{id:'fixture-account',name:'Fixture User'})}]};
    }else throw Error('unexpected RPC');
    return Response.json({jsonrpc:'2.0',id:rpc.id,result});
  };
  return {fetchImpl,calls,reject:()=>{reject=true;}};
}
async function callback(flow,fetchLocal){
  const start=await flow.start();
  const url=new URL(start.url);
  const target=url.searchParams.get('redirect_uri');
  return fetchLocal(target+'?'+new URLSearchParams({state:url.searchParams.get('state'),iss:p.issuer,code:'fixture-code'}));
}

test('canonical host registers after account proof, restores credential after restart and enforces denial',async t=>{
  const v=provider(),f=fixture(t,v.fetchImpl,Date.now);
  const configFile=path.join(f.root,'.jaco','mcp','servers.json');
  const realFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',v.fetchImpl);
  const host=new StdioMcpHost({configFile,repoRoot:f.root,runtimeRoot:f.root,oauthCredentials:f.credentials});
  const flow=createReadonlyOAuthConnection({host,credentials:f.credentials,fetchImpl:v.fetchImpl});
  t.after(()=>{flow.cancel();host.stopAll();});
  assert.equal(flow.status().configured,false);
  const response=await callback(flow,realFetch);
  assert.equal(response.status,200);
  assert.doesNotMatch(await response.text(),/fixture-access|fixture-account/);
  assert.equal(flow.status().accountVerified,true);
  assert.equal(flow.status().runtimeReady,true);
  assert.equal(flow.status().agentExecutionVerified,false);
  assert.deepEqual(host.status().find(x=>x.id==='linear').tools.map(x=>x.name),['get_user']);
  assert.doesNotMatch(fs.readFileSync(configFile,'utf8'),/fixture-access|fixture-refresh|fixture-account/);
  assert.throws(()=>host.setAccess('linear',{agentAccess:'write'}),/MCP_OAUTH_READ_ONLY/);
  await assert.rejects(flow.start(),/MCP_OAUTH_EXISTING_CONFIGURATION/);
  host.stopAll();
  const restoredCredentials=new ReadonlyOAuthCredentials({store:new SecretStore({env:f.env}),fetchImpl:v.fetchImpl});
  const restarted=new StdioMcpHost({configFile,repoRoot:f.root,runtimeRoot:f.root,oauthCredentials:restoredCredentials});
  t.after(()=>restarted.stopAll());
  const result=await restarted.call('linear','get_user',{query:'me'},{actor:'agent',readOnly:true});
  assert.equal(JSON.parse(result.content[0].text).id,'fixture-account');
  const count=v.calls.length;
  await assert.rejects(restarted.call('linear','save_issue',{}, {actor:'agent'}),/MCP_TOOL_UNKNOWN/);
  restarted.setAccess('linear',{deny:['get_user']});
  await assert.rejects(restarted.call('linear','get_user',{query:'me'},{actor:'agent',readOnly:true}),/MCP_TOOL_DENIED/);
  assert.equal(v.calls.length,count);
  restarted.setAccess('linear',{deny:[]});
  v.reject();
  await assert.rejects(restarted.call('linear','get_user',{query:'me'},{actor:'agent',readOnly:true}),/MCP_AUTH_REQUIRED/);
  assert.equal(v.calls.length,count+1,'rejected MCP call is never replayed');
  assert.equal(restoredCredentials.status().state,'REAUTH_REQUIRED');
  assert.equal(restarted.status().find(x=>x.id==='linear').tools.length,0);
  assert.equal(flow.disconnect().configured,false);
  assert.equal(f.store.has(ref),false);
});
test('invalid account proof never writes credentials or changes a configured provider',async t=>{
  const v=provider({invalid:true}),f=fixture(t,v.fetchImpl,Date.now);
  const configFile=path.join(f.root,'.jaco','mcp','servers.json');
  const host=new StdioMcpHost({configFile,repoRoot:f.root,runtimeRoot:f.root,oauthCredentials:f.credentials});
  const flow=createReadonlyOAuthConnection({host,credentials:f.credentials,fetchImpl:v.fetchImpl});
  t.after(()=>{flow.cancel();host.stopAll();});
  const response=await callback(flow,fetch);
  assert.equal(response.status,400);
  assert.equal(f.store.has(ref),false);
  assert.equal(host.servers().linear,undefined);
  host.saveServer('linear',{...definition,tokenEnv:'LINEAR_API_KEY'});
  await assert.rejects(flow.start(),/MCP_OAUTH_EXISTING_CONFIGURATION/);
  assert.equal(host.servers().linear.tokenEnv,'LINEAR_API_KEY');
  assert.throws(()=>flow.disconnect(),/MCP_OAUTH_EXISTING_CONFIGURATION/);
});
test('host rejects incorrect provider, endpoint and write authority for OAuth reference',()=>{
  assert.throws(()=>validateServerEntry('other',definition),/SCOPE_INVALID/);
  assert.throws(()=>validateServerEntry('linear',{...definition,url:'https://example.org/mcp'}),/SCOPE_INVALID/);
  assert.throws(()=>validateServerEntry('linear',{...definition,agentAccess:'write'}),/SCOPE_INVALID/);
});

test('reserved connector namespaces cannot export secrets even with ordinary key suffixes',t=>{
  const f=fixture(t);
  const names=['JACO_MCP_OAUTH_FIXTURE_TOKEN','JACO_MCP_GUIDED_FIXTURE_API_KEY','JACO_MCP_OAUTH_FIXTURE_SECRET'];
  for(const name of names){
    f.store.set(name,'fixture-scoped-secret');
    assert.equal(isExportableSecret(name),false);
    assert.equal(credential(name,{env:f.env,store:f.store}),'');
  }
  f.store.set('FIXTURE_API_KEY','ordinary-fixture');
  assert.deepEqual(hydrateEnvFromStore(f.env,f.store),['FIXTURE_API_KEY']);
  assert.equal(f.env.FIXTURE_API_KEY,'ordinary-fixture');
  for(const name of names)assert.equal(f.env[name],undefined);
});
