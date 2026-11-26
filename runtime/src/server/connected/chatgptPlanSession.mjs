// Local, operator-initiated SIWC preview. No automatic provider registration.
// Tokens are kept in this process only until a reviewed account vault is integrated.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { beginAuthorization, exchangeAuthorization, listPlanModels, completePlan } from './chatgptPlanTransport.mjs';

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
  constructor({hostId=hostIdentifier,fetchImpl=fetch}={}) { this.hostId=hostId;this.fetchImpl=fetchImpl; }
  status() {
    const connected=Boolean(this.#session && this.#session.expiresAt>Date.now());
    return {state:connected?this.#state:(this.#state==='connected'?'expired':this.#state),
      connected,models:connected?this.#models:[],verifiedAt:connected?this.#verifiedAt:null,error:this.#error,testBusy:this.#testBusy,
      storage:'process-only',automaticRouting:false};
  }
  async start() {
    if(this.#pending)throw new Error('SIWC_LOGIN_PENDING');
    if(this.#session)throw new Error('SIWC_DISCONNECT_FIRST');
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
        const session=await exchangeAuthorization(attempt,u.href,{fetchImpl:this.fetchImpl});
        if(generation!==this.#generation)throw new Error('SIWC_CANCELLED');
        this.#session=session;this.#state='connected';this.#error=null;
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
      attempt=beginAuthorization({hostId,redirectUri:'http://127.0.0.1:'+server.address().port+'/auth/callback'});
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
    const session=this.#session,generation=this.#generation;
    try {
      const models=await listPlanModels(session,{fetchImpl:this.fetchImpl});
      if(generation!==this.#generation)throw new Error('SIWC_CANCELLED');
      this.#models=models;this.#error=null;return this.status();
    }catch(e){if(generation===this.#generation)this.#error=safeError(e);throw new Error(safeError(e));}
  }
  async test(model) {
    if(!this.status().connected)throw new Error('SIWC_SESSION_REQUIRED');
    if(this.#testBusy)throw new Error('SIWC_TEST_PENDING');
    if(!this.#models.some(m=>m.id===model))throw new Error('SIWC_MODEL_NOT_DISCOVERED');
    const session=this.#session,generation=this.#generation;
    this.#testBusy=true;
    try {
      const result=await completePlan(session,{model,messages:[{role:'user',content:'Reply with the single word OK.'}],fetchImpl:this.fetchImpl});
      if(generation!==this.#generation)throw new Error('SIWC_CANCELLED');
      this.#verifiedAt=new Date().toISOString();this.#error=null;
      return {model:result.model,verifiedAt:this.#verifiedAt};
    }catch(e){if(generation===this.#generation){this.#verifiedAt=null;this.#error=safeError(e);}throw new Error(safeError(e));}
    finally{this.#testBusy=false;}
  }
  disconnect() {
    ++this.#generation;
    if(this.#pending){clearTimeout(this.#pending.timeout);this.#pending.server.close();this.#pending=null;}
    this.#session=null;this.#models=[];this.#verifiedAt=null;this.#error=null;this.#state='disconnected';
    return this.status();
  }
}
