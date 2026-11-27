// The operator's own ChatGPT plan through OpenAI's "Sign in with ChatGPT" flow for locally run, open-source apps.
// https://developers.openai.com/siwc/token-sharing-open-source/
// The account is kept encrypted on this computer only, in its own folder (not the vault that tools list). Signing
// in routes nothing by itself: the operator turns chat use on, and background work needs its own consent.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { beginAuthorization, exchangeAuthorization, listPlanModels, completePlan, refreshSession, restoreSession, revokeSession } from './chatgptPlanTransport.mjs';
import { SecretStore, stateDir } from '../../../../agents/lib/secret-store.mjs';

const ACCOUNT = 'CHATGPT_PLAN_ACCOUNT';
export function chatGPTAccountStore(env = process.env) {
  const store = new SecretStore({ env, dir: path.join(stateDir(env), 'siwc') });
  return {
    load() { const text = store.get(ACCOUNT); return text ? JSON.parse(text) : null; },
    save(record) { store.set(ACCOUNT, JSON.stringify(record), { source: 'chatgpt-sign-in', purpose: 'Operator ChatGPT plan' }); },
    clear() { store.delete(ACCOUNT); },
  };
}
const masked = email => { const [name, host] = String(email || '').split('@'); return host ? `${name.slice(0, 1)}***@${host}` : ''; };

function hostIdentifier() {
  const dir=path.join(os.homedir(),'.jaco','siwc');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const filename=path.join(dir,'host-id');
  try { fs.writeFileSync(filename,'urn:uuid:'+randomUUID(),{flag:'wx',mode:0o600,flush:true}); }
  catch(e){ if(e.code!=='EEXIST')throw e; }
  const id=fs.readFileSync(filename,'utf8').trim();
  if(!/^urn:uuid:[0-9a-f-]{36}$/i.test(id))throw new Error('SIWC_HOST_ID_INVALID');
  return id;
}

const safeError=e=>/^SIWC_[A-Z0-9_]+$/.test(e?.message||'')?e.message:'SIWC_OPERATION_FAILED';

export class ChatGPTPlanSession {
  #session=null;
  #pending=null;
  #state='disconnected';
  #error=null;
  #testBusy=false;
  #models=[];
  #verifiedAt=null;
  #generation=0;
  #refreshing=null;
  #use={enabled:false,model:'',backgroundAllowed:false};
  constructor({hostId=hostIdentifier,fetchImpl=fetch,store=chatGPTAccountStore()}={}) {
    this.hostId=hostId;this.fetchImpl=fetchImpl;this.store=store;
    try {
      const saved=store.load();
      if(saved){
        this.#session=restoreSession(saved);
        this.#use={enabled:saved.use?.enabled===true,model:String(saved.use?.model||''),backgroundAllowed:saved.use?.backgroundAllowed===true};
        this.#models=Array.isArray(saved.models)?saved.models:[];
        this.#state=saved.reconnect?'expired':'connected';
      }
    }catch{this.#state='error';this.#error='SIWC_ACCOUNT_UNREADABLE';}
  }
  #save(extra={}) { if(this.#session)this.store.save({...this.#session,use:this.#use,models:this.#models,...extra}); }
  status() {
    const connected=Boolean(this.#session)&&this.#state!=='expired';
    return {state:this.#state,connected,account:this.#session?masked(this.#session.email):'',
      models:connected?this.#models:[],use:{...this.#use},verifiedAt:connected?this.#verifiedAt:null,error:this.#error,testBusy:this.#testBusy,
      storage:'encrypted-on-this-computer'};
  }
  // The model Aura's chat uses, or null. Never set by signing in alone.
  chatChoice() {
    return this.#session&&this.#state==='connected'&&this.#use.enabled&&this.#use.model?{providerId:'chatgpt-plan',model:this.#use.model}:null;
  }
  /** @param {{enabled?: boolean, model?: string, backgroundAllowed?: boolean}} [choice] */
  use({enabled,model=this.#use.model,backgroundAllowed=this.#use.backgroundAllowed}={}) {
    if(!this.status().connected)throw new Error('SIWC_SESSION_REQUIRED');
    if(enabled&&!this.#models.some(m=>m.id===model))throw new Error('SIWC_MODEL_NOT_DISCOVERED');
    this.#use={enabled:enabled===true,model:String(model||''),backgroundAllowed:backgroundAllowed===true};
    this.#save();return this.status();
  }
  // One refresh at a time: the refresh token rotates, so a second concurrent use of the old one would be refused.
  async #fresh() {
    if(!this.#session||this.#state==='expired')throw new Error('SIWC_RECONNECT_REQUIRED');
    if(this.#session.expiresAt-Date.now()>60000)return this.#session;
    if(!this.#refreshing){
      const generation=this.#generation,before=this.#session;
      this.#refreshing=(async()=>{
        try {
          const next=await refreshSession(before,{fetchImpl:this.fetchImpl});
          if(generation!==this.#generation)throw new Error('SIWC_CANCELLED');
          this.#session=next;this.#save();return next;
        }catch(e){
          if(generation===this.#generation&&/^SIWC_(HTTP_40[013]|PLAN_NOT_GRANTED|ACCOUNT_MISMATCH)$/.test(e?.message||'')){
            this.#state='expired';this.#error='SIWC_RECONNECT_REQUIRED';this.#save({reconnect:true});throw new Error('SIWC_RECONNECT_REQUIRED');
          }
          throw new Error(safeError(e));
        }
      })().finally(()=>{this.#refreshing=null;});
    }
    return this.#refreshing;
  }
  async start() {
    if(this.#pending)throw new Error('SIWC_LOGIN_PENDING');
    if(this.#session&&this.#state!=='expired')throw new Error('SIWC_DISCONNECT_FIRST');
    // Signing in again after expiry reuses the issued client and must be the same account.
    const previous=this.#session;
    const generation=++this.#generation;
    const hostId=this.hostId();
    let attempt;
    let busy=false;
    const server=http.createServer(async(req,res)=>{
      res.setHeader('Cache-Control','no-store');
      res.setHeader('Content-Type','text/plain; charset=utf-8');
      res.setHeader('Referrer-Policy','no-referrer');
      res.setHeader('Content-Security-Policy',"default-src 'none'");
      let u;
      try {
        if(req.method!=='GET'||!attempt||typeof req.url!=='string'||!req.url.startsWith('/'))throw new Error();
        u=new URL(req.url,attempt.redirectUri);
        if(u.origin+u.pathname!==attempt.redirectUri||req.headers.host!==new URL(attempt.redirectUri).host)throw new Error();
      }catch{res.writeHead(404);res.end('Not found');return;}
      if(busy){res.writeHead(409);res.end('Sign-in already processing.');return;}
      if(u.searchParams.get('state')!==attempt.state){res.writeHead(400);res.end('Invalid sign-in state.');return;}
      busy=true;
      try {
        const session=await exchangeAuthorization(attempt,u.href,{fetchImpl:this.fetchImpl,expectedSubject:previous?.subject});
        if(generation!==this.#generation)throw new Error('SIWC_CANCELLED');
        this.#session=session;this.#state='connected';this.#error=null;this.#save();
        res.writeHead(200);res.end('ChatGPT connected. Return to the local JACO settings window.');
      }catch(e){
        if(generation===this.#generation){this.#state='error';this.#error=safeError(e);}
        res.writeHead(400);res.end('Sign-in did not complete. Return to JACO to retry.');
      }finally{
        clearTimeout(timeout);
        server.close();
        if(this.#pending?.server===server)this.#pending=null;
      }
    });
    const timeout=setTimeout(()=>{
      if(this.#pending?.server===server){this.#pending=null;++this.#generation;this.#state='error';this.#error='SIWC_ATTEMPT_EXPIRED';}
      server.close();
    },300000);
    timeout.unref();
    this.#pending={server,timeout};
    this.#state='waiting';this.#error=null;
    try {
      await new Promise((resolve,reject)=>{
        server.once('error',reject);
        server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});
      });
      attempt=beginAuthorization({hostId,clientId:previous?.clientId,redirectUri:'http://127.0.0.1:'+server.address().port+'/auth/callback'});
      if(generation!==this.#generation)throw new Error('SIWC_CANCELLED');
      return {url:attempt.url};
    }catch(e){
      clearTimeout(timeout);server.close();
      if(this.#pending?.server===server){this.#pending=null;this.#state='error';this.#error=safeError(e);}
      throw new Error(safeError(e));
    }
  }
  async discover() {
    if(!this.status().connected)throw new Error('SIWC_SESSION_REQUIRED');
    const generation=this.#generation;
    try {
      const models=await listPlanModels(await this.#fresh(),{fetchImpl:this.fetchImpl});
      if(generation!==this.#generation)throw new Error('SIWC_CANCELLED');
      this.#models=models;this.#error=null;this.#save();return this.status();
    }catch(e){if(generation===this.#generation&&this.#state!=='expired')this.#error=safeError(e);throw new Error(safeError(e));}
  }
  // One answer from the plan. Background work (anything the operator did not just ask for) needs its own consent.
  async complete({model,system,user,background=false}) {
    if(background&&!this.#use.backgroundAllowed)throw new Error('SIWC_BACKGROUND_CONSENT_REQUIRED');
    const session=await this.#fresh();
    try {
      const result=await completePlan(session,{model,messages:[{role:'system',content:String(system||'')},{role:'user',content:String(user||'')}],fetchImpl:this.fetchImpl});
      this.#verifiedAt=new Date().toISOString();this.#error=null;return result;
    }catch(e){this.#error=safeError(e);throw new Error(safeError(e));}
  }
  async test(model) {
    if(!this.status().connected)throw new Error('SIWC_SESSION_REQUIRED');
    if(this.#testBusy)throw new Error('SIWC_TEST_PENDING');
    if(!this.#models.some(m=>m.id===model))throw new Error('SIWC_MODEL_NOT_DISCOVERED');
    this.#testBusy=true;
    try {
      const result=await this.complete({model,system:'Reply briefly.',user:'Reply with the single word OK.'});
      return {model:result.model,verifiedAt:this.#verifiedAt};
    }catch(e){this.#verifiedAt=null;throw e;}
    finally{this.#testBusy=false;}
  }
  // Removes the account here whatever happens; says whether OpenAI confirmed the revocation.
  async disconnect() {
    ++this.#generation;
    if(this.#pending){clearTimeout(this.#pending.timeout);this.#pending.server.close();this.#pending=null;}
    const session=this.#session;
    this.#session=null;this.#models=[];this.#verifiedAt=null;this.#error=null;this.#state='disconnected';
    this.#use={enabled:false,model:'',backgroundAllowed:false};
    this.store.clear();
    let revoked=null;
    if(session){try{await revokeSession(session,{fetchImpl:this.fetchImpl});revoked=true;}catch{revoked=false;}}
    return {...this.status(),revoked};
  }
}
