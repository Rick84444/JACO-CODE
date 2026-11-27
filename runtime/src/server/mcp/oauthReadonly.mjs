// Narrow OAuth client primitive for a reviewed provider. Not an account store or MCP host.
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const origin='https://mcp.linear.app';
export const LINEAR_OAUTH=Object.freeze({
  issuer:origin, resource:origin+'/mcp',
  metadata:origin+'/.well-known/oauth-authorization-server',
  protectedResource:origin+'/.well-known/oauth-protected-resource/mcp',
  authorize:origin+'/authorize', token:origin+'/token', register:origin+'/register',
  scope:'read'
});
const fail=code=>{throw Error('MCP_OAUTH_'+code);};
const opaque=(value,max=16384)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\x00-\x20\x7f]/.test(value);
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const includes=(value,item)=>Array.isArray(value)&&value.includes(item);
const scopes=value=>typeof value==='string'?value.trim().split(/\s+/).filter(Boolean):[];

async function jsonRequest(fetchImpl,url,options={}){
  if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')fail('TLS_REQUIRED');
  let res;
  try{res=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000),headers:{accept:'application/json',...options.headers}});}
  catch{fail('NETWORK_FAILED');}
  if(!res.ok){void res.body?.cancel().catch(()=>{});fail('HTTP_'+res.status);}
  if(!(res.headers.get('content-type')||'').includes('application/json')){void res.body?.cancel().catch(()=>{});fail('RESPONSE_INVALID');}
  const reader=res.body?.getReader();
  if(!reader)fail('RESPONSE_INVALID');
  let size=0;const chunks=[];
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>65536)fail('RESPONSE_LIMIT');
      chunks.push(Buffer.from(value));
    }
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!value||typeof value!=='object'||Array.isArray(value))fail('RESPONSE_INVALID');
    return value;
  }catch(error){if(/^MCP_OAUTH_[A-Z0-9_]+$/.test(error?.message||''))throw error;fail('RESPONSE_INVALID');}
  finally{await reader.cancel().catch(()=>{});}
}

export async function discoverLinearOAuth({fetchImpl=fetch}={}){
  const p=LINEAR_OAUTH;
  const resource=await jsonRequest(fetchImpl,p.protectedResource);
  if(resource.resource!==p.resource||!Array.isArray(resource.authorization_servers)||resource.authorization_servers.length!==1||resource.authorization_servers[0]!==p.issuer)fail('RESOURCE_MISMATCH');
  const metadata=await jsonRequest(fetchImpl,p.metadata);
  if(metadata.issuer!==p.issuer||metadata.authorization_endpoint!==p.authorize||metadata.token_endpoint!==p.token||metadata.registration_endpoint!==p.register)fail('METADATA_MISMATCH');
  if(!includes(metadata.code_challenge_methods_supported,'S256')||!includes(metadata.token_endpoint_auth_methods_supported,'none')||!includes(metadata.grant_types_supported,'authorization_code')||!includes(metadata.grant_types_supported,'refresh_token')||!includes(metadata.response_types_supported,'code')||!includes(metadata.scopes_supported,'read')||metadata.authorization_response_iss_parameter_supported!==true)fail('CONTRACT_UNSUPPORTED');
  return p;
}

function callbackUri(uri){
  let u;try{u=new URL(uri);}catch{fail('CALLBACK_INVALID');}
  if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.pathname!=='/mcp/oauth/callback'||u.search||u.hash||u.username||u.password||u.href!==uri)fail('CALLBACK_INVALID');
  return u.href;
}

/** One in-memory attempt. Never serialize it to a browser or log. */
export async function beginLinearOAuth({redirectUri,fetchImpl=fetch,now=Date.now}){
  redirectUri=callbackUri(redirectUri);
  const p=await discoverLinearOAuth({fetchImpl});
  const registered=await jsonRequest(fetchImpl,p.register,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({client_name:'JACO',redirect_uris:[redirectUri],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none',scope:p.scope})
  });
  if(!opaque(registered.client_id,2048)||registered.client_secret||registered.token_endpoint_auth_method!=='none'||!Array.isArray(registered.redirect_uris)||registered.redirect_uris.length!==1||registered.redirect_uris[0]!==redirectUri)fail('REGISTRATION_INVALID');
  if(registered.scope!==undefined&&(scopes(registered.scope).length!==1||scopes(registered.scope)[0]!==p.scope))fail('SCOPE_MISMATCH');
  const state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
  const challenge=createHash('sha256').update(verifier).digest('base64url');
  const url=new URL(p.authorize);
  url.search=new URLSearchParams({response_type:'code',client_id:registered.client_id,redirect_uri:redirectUri,scope:p.scope,resource:p.resource,state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
  return {url:url.href,clientId:registered.client_id,redirectUri,state,verifier,expiresAt:now()+300000,consumed:false};
}

async function exchange(params,{fetchImpl,now,clientId,previousRefresh}){
  const p=LINEAR_OAUTH;
  const r=await jsonRequest(fetchImpl,p.token,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...params,client_id:clientId,resource:p.resource})});
  if(!opaque(r.access_token)||String(r.token_type).toLowerCase()!=='bearer'||!Number.isSafeInteger(r.expires_in)||r.expires_in<=0||r.expires_in>86400)fail('TOKEN_INVALID');
  if(r.scope!==undefined&&(scopes(r.scope).length!==1||scopes(r.scope)[0]!==p.scope))fail('SCOPE_MISMATCH');
  if(r.refresh_token!==undefined&&!opaque(r.refresh_token))fail('TOKEN_INVALID');
  return {issuer:p.issuer,resource:p.resource,clientId,scope:p.scope,accessToken:r.access_token,refreshToken:r.refresh_token||previousRefresh||null,expiresAt:now()+r.expires_in*1000};
}

export async function completeLinearOAuth(attempt,callback,{fetchImpl=fetch,now=Date.now}={}){
  if(!attempt||attempt.consumed||now()>=attempt.expiresAt)fail('ATTEMPT_INVALID');
  let u;try{u=new URL(callback);}catch{fail('CALLBACK_INVALID');}
  if(u.origin+u.pathname!==attempt.redirectUri||u.hash||u.username||u.password)fail('CALLBACK_INVALID');
  const q=u.searchParams;
  if(q.getAll('state').length!==1||!equal(q.get('state'),attempt.state)||q.getAll('iss').length!==1||q.get('iss')!==LINEAR_OAUTH.issuer)fail('CALLBACK_MISMATCH');
  attempt.consumed=true;
  if(q.has('error'))fail('CONSENT_DENIED');
  if(q.getAll('code').length!==1||!opaque(q.get('code')))fail('CODE_INVALID');
  return exchange({grant_type:'authorization_code',code:q.get('code'),code_verifier:attempt.verifier,redirect_uri:attempt.redirectUri},{fetchImpl,now,clientId:attempt.clientId});
}

// Caller must serialize refresh and persist rotated tokens atomically before use.
// No retries: a lost response may have consumed the old refresh token.
export async function refreshLinearOAuth(session,{fetchImpl=fetch,now=Date.now}={}){
  const p=LINEAR_OAUTH;
  if(session?.issuer!==p.issuer||session.resource!==p.resource||session.scope!==p.scope||!opaque(session.clientId,2048)||!opaque(session.refreshToken))fail('REFRESH_INVALID');
  return exchange({grant_type:'refresh_token',refresh_token:session.refreshToken,scope:p.scope},{fetchImpl,now,clientId:session.clientId,previousRefresh:session.refreshToken});
}
