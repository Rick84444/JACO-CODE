// Bounded first-provider OAuth adapter, not general discovery of arbitrary URLs.
// Linear documents DCR and a read-only OAuth scope on its canonical /mcp endpoint.
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {SecretStore} from '../../../../agents/lib/secret-store.mjs';
import {LINEAR_OAUTH as provider} from '../../lib/mcpIntegrationCatalog.mjs';

const origin=provider.issuer,resource=provider.resource;
const REF=provider.credentialRef;
const fail=code=>{throw Error(code);};
const string=(v,max=8192)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x20\x7f]/.test(v);
const random=()=>randomBytes(32).toString('base64url');
const has=(values,item)=>Array.isArray(values)&&values.includes(item);
const fingerprint=raw=>createHash('sha256').update(raw).digest('hex');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const endpoints=Object.freeze({
  metadata:origin+'/.well-known/oauth-protected-resource/mcp',
  server:origin+'/.well-known/oauth-authorization-server',
  authorize:origin+'/authorize',token:origin+'/token',register:origin+'/register'
});
async function json(url,init,fetchImpl){
  if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')fail('MCP_OAUTH_TLS_REQUIRED');
  if(!Object.values(endpoints).includes(url))fail('MCP_OAUTH_ENDPOINT_INVALID');
  let r;
  try{r=await fetchImpl(url,{...init,redirect:'error',signal:AbortSignal.timeout(15000)});}
  catch{fail('MCP_OAUTH_NETWORK_FAILED');}
  if(!r.ok){void r.body?.cancel().catch(()=>{});fail(r.status===400||r.status===401||r.status===403?'MCP_OAUTH_REJECTED':'MCP_OAUTH_HTTP_'+r.status);}
  const reader=r.body?.getReader();
  if(!reader)fail('MCP_OAUTH_RESPONSE_INVALID');
  let bytes=0,raw='';const decoder=new TextDecoder();
  try{
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>65536)fail('MCP_OAUTH_RESPONSE_TOO_LARGE');raw+=decoder.decode(value,{stream:true});}
    raw+=decoder.decode();
    const result=JSON.parse(raw);
    if(!result||typeof result!=='object'||Array.isArray(result))fail('MCP_OAUTH_RESPONSE_INVALID');
    return result;
  }catch(e){if(/^MCP_OAUTH_[A-Z0-9_]+$/.test(e?.message||''))throw e;fail('MCP_OAUTH_RESPONSE_INVALID');}
  finally{await reader.cancel().catch(()=>{});}
}
const post=(url,body,fetchImpl,form=false)=>json(url,{method:'POST',headers:{'content-type':form?'application/x-www-form-urlencoded':'application/json'},body:form?new URLSearchParams(body):JSON.stringify(body)},fetchImpl);
export async function discoverLinearOAuth({fetchImpl=fetch}={}){
  const prm=await json(endpoints.metadata,{},fetchImpl);
  if(prm.resource!==resource||!Array.isArray(prm.authorization_servers)||!prm.authorization_servers.includes(origin))fail('MCP_OAUTH_RESOURCE_MISMATCH');
  if(prm.scopes_supported!==undefined&&(!Array.isArray(prm.scopes_supported)||!prm.scopes_supported.includes('read')))fail('MCP_OAUTH_READ_SCOPE_UNAVAILABLE');
  const asm=await json(endpoints.server,{},fetchImpl);
  if(asm.issuer!==origin||asm.authorization_endpoint!==endpoints.authorize||asm.token_endpoint!==endpoints.token||asm.registration_endpoint!==endpoints.register)fail('MCP_OAUTH_ISSUER_MISMATCH');
  if(!has(asm.code_challenge_methods_supported,'S256')||!has(asm.token_endpoint_auth_methods_supported,'none')||!has(asm.response_types_supported,'code')||!has(asm.grant_types_supported,'authorization_code'))fail('MCP_OAUTH_METADATA_UNSUPPORTED');
  return {issuer:origin,resource,issRequired:asm.authorization_response_iss_parameter_supported===true,refreshSupported:asm.grant_types_supported.includes('refresh_token')};
}
export async function beginLinearOAuth(redirectUri,{fetchImpl=fetch,now=Date.now}={}){
  if(!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/mcp\/oauth\/callback$/.test(redirectUri)||Number(new URL(redirectUri).port)>65535)fail('MCP_OAUTH_CALLBACK_INVALID');
  const meta=await discoverLinearOAuth({fetchImpl});
  const registration={client_name:'JACO CODE',application_type:'native',redirect_uris:[redirectUri],token_endpoint_auth_method:'none',grant_types:['authorization_code',...(meta.refreshSupported?['refresh_token']:[])],response_types:['code'],scope:'read'};
  const client=await post(endpoints.register,registration,fetchImpl);
  if(!string(client.client_id,2048)||client.client_secret||client.token_endpoint_auth_method&&client.token_endpoint_auth_method!=='none'||!Array.isArray(client.redirect_uris)||client.redirect_uris.length!==1||client.redirect_uris[0]!==redirectUri)fail('MCP_OAUTH_CLIENT_INVALID');
  const verifier=random(),state=random();
  const url=endpoints.authorize+'?'+new URLSearchParams({response_type:'code',client_id:client.client_id,redirect_uri:redirectUri,resource,scope:'read',state,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')});
  return {url,state,verifier,redirectUri,clientId:client.client_id,issuer:meta.issuer,issRequired:meta.issRequired,refreshSupported:meta.refreshSupported,expiresAt:now()+300000,consumed:false};
}
function tokens(data,clientId,now,previousRefresh=null){
  if(!string(data.access_token)||String(data.token_type).toLowerCase()!=='bearer'||!Number.isFinite(data.expires_in)||data.expires_in<=0||data.expires_in>2592000)fail('MCP_OAUTH_TOKEN_INVALID');
  // RFC 6749: omitted scope means the requested scope was granted.
  if(data.scope!==undefined&&data.scope!=='read')fail('MCP_OAUTH_SCOPE_MISMATCH');
  if(data.refresh_token!==undefined&&!string(data.refresh_token))fail('MCP_OAUTH_TOKEN_INVALID');
  const record={schema:'jaco.linear-oauth/v1',issuer:origin,resource,clientId,scope:'read',accessToken:data.access_token,refreshToken:data.refresh_token??previousRefresh,expiresAt:now()+data.expires_in*1000};
  if(JSON.stringify(record).length>16000)fail('MCP_OAUTH_TOKEN_INVALID');
  return record;
}
export async function exchangeLinearOAuth(attempt,callbackUrl,{fetchImpl=fetch,now=Date.now}={}){
  if(!attempt||attempt.consumed||now()>=attempt.expiresAt||attempt.issuer!==origin)fail('MCP_OAUTH_ATTEMPT_EXPIRED');
  let u;try{u=new URL(callbackUrl);}catch{fail('MCP_OAUTH_CALLBACK_INVALID');}
  if(u.origin+u.pathname!==attempt.redirectUri||u.hash||u.username||u.password)fail('MCP_OAUTH_CALLBACK_INVALID');
  for(const key of ['state','iss','code','error'])if(u.searchParams.getAll(key).length>1)fail('MCP_OAUTH_CALLBACK_INVALID');
  if(!same(attempt.state,u.searchParams.get('state')))fail('MCP_OAUTH_STATE_MISMATCH');
  const issuer=u.searchParams.get('iss');
  if((attempt.issRequired||issuer!==null)&&issuer!==origin)fail('MCP_OAUTH_ISSUER_MISMATCH');
  attempt.consumed=true;
  if(u.searchParams.has('error'))fail('MCP_OAUTH_DENIED');
  const code=u.searchParams.get('code');
  if(!string(code))fail('MCP_OAUTH_CODE_INVALID');
  const data=await post(endpoints.token,{grant_type:'authorization_code',client_id:attempt.clientId,code,redirect_uri:attempt.redirectUri,code_verifier:attempt.verifier,resource},fetchImpl,true);
  return tokens(data,attempt.clientId,now);
}
export function parseLinearOAuth(raw){
  try{
    const r=JSON.parse(raw||'null');
    if(r?.schema!=='jaco.linear-oauth/v1'||r.issuer!==origin||r.resource!==resource||r.scope!=='read'||!string(r.clientId,2048)||!string(r.accessToken)||!Number.isFinite(r.expiresAt)||!(r.refreshToken===null||string(r.refreshToken)))return null;
    return r;
  }catch{return null;}
}
export function linearOAuthStatus({store=new SecretStore(),now=Date.now}={}){
  let raw,r;try{raw=store.get(REF);r=parseLinearOAuth(raw);}catch{return {configured:false,expiresAt:null,refreshAvailable:false};}
  const refreshAvailable=Boolean(r?.refreshToken&&rejected.get(store.file)!==fingerprint(raw));
  return {configured:Boolean(r&&(r.expiresAt>now()||refreshAvailable)),expiresAt:r?.expiresAt||null,refreshAvailable};
}
const refreshes=new Map();
const rejected=new Map();
// No tool retries. Refresh only before a new transport request. A CAS prevents
// an in-flight refresh from overwriting an operator's replacement or disconnect.
export async function linearOAuthAccess({store=new SecretStore(),fetchImpl=fetch,now=Date.now}={}){
  const raw=store.get(REF),record=parseLinearOAuth(raw);
  if(!record)fail('MCP_CREDENTIAL_REQUIRED');
  if(record.expiresAt>now()+30000||record.expiresAt>now()&&!record.refreshToken)return record.accessToken;
  if(!record.refreshToken)fail('MCP_AUTH_REQUIRED');
  const key=store.file;
  const stamp=fingerprint(raw);
  if(rejected.get(key)===stamp)fail('MCP_AUTH_REQUIRED');
  const existing=refreshes.get(key);
  if(existing){if(existing.stamp!==stamp)fail('MCP_OAUTH_CREDENTIAL_CHANGED');return existing.pending;}
  const pending=(async()=>{
    try{
      const data=await post(endpoints.token,{grant_type:'refresh_token',client_id:record.clientId,refresh_token:record.refreshToken,resource,scope:'read'},fetchImpl,true);
      const next=tokens(data,record.clientId,now,record.refreshToken);
      if(!store.replaceIfCurrent(REF,raw,JSON.stringify(next),{source:'operator-oauth',purpose:'Linear OAuth read scope'}))fail('MCP_OAUTH_CREDENTIAL_CHANGED');
      rejected.delete(key);
      return next.accessToken;
    }catch(error){if(error?.message==='MCP_OAUTH_REJECTED'){rejected.set(key,stamp);fail('MCP_AUTH_REQUIRED');}throw error;}
  })();
  const entry={stamp,pending};refreshes.set(key,entry);
  try{return await pending;}finally{if(refreshes.get(key)===entry)refreshes.delete(key);}
}
