// OAuth credentials belong to the existing encrypted vault. Never export to process.env.
import { randomUUID } from 'node:crypto';
import { SecretStore } from '../../../../agents/lib/secret-store.mjs';
import { LINEAR_OAUTH, refreshLinearOAuth } from './oauthReadonly.mjs';

export const LINEAR_OAUTH_REF='JACO_MCP_OAUTH_LINEAR';
export const isOAuthReference=name=>typeof name==='string'&&/^JACO_MCP_OAUTH_/i.test(name);
export function oauthDefinitionMatches(id,def){
  return id==='linear'&&def?.transport==='http'&&def.url===LINEAR_OAUTH.resource&&def.tokenEnv===LINEAR_OAUTH_REF;
}
const fail=code=>{throw Error('MCP_OAUTH_'+code);};
const opaque=(v,max=16384)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x20\x7f]/.test(v);
function validSession(s){
  return s?.issuer===LINEAR_OAUTH.issuer&&s.resource===LINEAR_OAUTH.resource&&s.scope==='read'
    &&opaque(s.clientId,2048)&&opaque(s.accessToken)&&
    (s.refreshToken===null||opaque(s.refreshToken))&&Number.isSafeInteger(s.expiresAt)&&s.expiresAt>0;
}
const metadata={source:'operator-oauth',purpose:'Linear read-only account session'};
function parse(raw){
  if(raw===null)return null;
  try{
    const r=JSON.parse(raw);
    if(r?.schema!==1)fail('VAULT_RECORD_INVALID');
    if(r.state==='active'&&validSession(r.session)&&typeof r.verifiedAt==='string'&&Number.isFinite(Date.parse(r.verifiedAt)))return r;
    if(['refreshing','reauth_required'].includes(r.state)&&typeof r.at==='number'&&Number.isFinite(r.at))return r;
  }catch{}
  fail('VAULT_RECORD_INVALID');
}
function active(session,verifiedAt){
  if(!validSession(session))fail('TOKEN_INVALID');
  // Explicit field allowlist: provider data and UI state do not belong in the vault.
  return JSON.stringify({schema:1,state:'active',verifiedAt,session:{
    issuer:session.issuer,resource:session.resource,scope:session.scope,clientId:session.clientId,
    accessToken:session.accessToken,refreshToken:session.refreshToken,expiresAt:session.expiresAt}});
}

export class ReadonlyOAuthCredentials {
  #pending=null;
  constructor({store=new SecretStore(),fetchImpl=fetch,now=Date.now}={}){
    this.store=store;this.fetchImpl=fetchImpl;this.now=now;
  }
  read(){try{return this.store.get(LINEAR_OAUTH_REF);}catch{fail('VAULT_UNAVAILABLE');}}
  status(){
    try{
      const r=parse(this.read());
      if(!r)return {state:'NOT_CONFIGURED',credentialConfigured:false,verifiedAt:null};
      if(r.state==='refreshing')return {state:this.now()-r.at<60000?'REFRESHING':'REAUTH_REQUIRED',credentialConfigured:false,verifiedAt:null};
      if(r.state==='reauth_required')return {state:'REAUTH_REQUIRED',credentialConfigured:false,verifiedAt:null};
      const ready=r.session.expiresAt>this.now()+30000;
      return {state:ready?'AUTHORIZED':r.session.refreshToken?'REFRESH_REQUIRED':'REAUTH_REQUIRED',credentialConfigured:ready||!!r.session.refreshToken,verifiedAt:r.verifiedAt};
    }catch{return {state:'VAULT_ERROR',credentialConfigured:false,verifiedAt:null};}
  }
  // Internal caller must obtain account-read proof first. Never silently overwrite an account.
  installVerified(session,verifiedAt){
    if(!Number.isFinite(Date.parse(verifiedAt))||session.expiresAt<=this.now())fail('PROOF_INVALID');
    if(!this.store.setIfAbsent(LINEAR_OAUTH_REF,active(session,verifiedAt),metadata))fail('CREDENTIAL_EXISTS');
    return this.status();
  }
  async access(id,def){
    if(!oauthDefinitionMatches(id,def))fail('CREDENTIAL_SCOPE_INVALID');
    if(this.#pending)return this.#pending;
    const raw=this.read(),r=parse(raw);
    if(!r||r.state!=='active')fail(r?.state==='refreshing'&&this.now()-r.at<60000?'REFRESH_IN_PROGRESS':'REAUTH_REQUIRED');
    if(r.session.expiresAt>this.now()+30000)return r.session.accessToken;
    if(!r.session.refreshToken)fail('REAUTH_REQUIRED');
    // Durable claim before network I/O; no other process may reuse the same refresh token.
    // After an ambiguous outcome or crash, reauthorization is required rather than replay.
    const marker=JSON.stringify({schema:1,state:'refreshing',at:this.now(),operation:randomUUID()});
    if(!this.store.replaceIfCurrent(LINEAR_OAUTH_REF,raw,marker,metadata))fail('CREDENTIAL_CHANGED');
    const pending=(async()=>{
      try{
        const session=await refreshLinearOAuth(r.session,{fetchImpl:this.fetchImpl,now:this.now});
        if(session.expiresAt<=this.now()+30000)fail('TOKEN_INVALID');
        if(!this.store.replaceIfCurrent(LINEAR_OAUTH_REF,marker,active(session,r.verifiedAt),metadata))fail('CREDENTIAL_CHANGED');
        return session.accessToken;
      }catch(error){
        // Do not keep possibly consumed refresh tokens; do not overwrite a newer account.
        try{this.store.replaceIfCurrent(LINEAR_OAUTH_REF,marker,JSON.stringify({schema:1,state:'reauth_required',at:this.now()}),metadata);}catch{}
        fail('REAUTH_REQUIRED');
      }
    })();
    this.#pending=pending;
    try{return await pending;}finally{if(this.#pending===pending)this.#pending=null;}
  }
  // Called on observed authorization rejection, never refresh/replay the failed MCP request.
  invalidate(accessToken){
    try{
      const raw=this.read(),r=parse(raw);
      if(r?.state!=='active'||r.session.accessToken!==accessToken)return false;
      return this.store.replaceIfCurrent(LINEAR_OAUTH_REF,raw,JSON.stringify({schema:1,state:'reauth_required',at:this.now()}),metadata);
    }catch{return false;}
  }
}
export const readonlyOAuthCredentials=new ReadonlyOAuthCredentials();
