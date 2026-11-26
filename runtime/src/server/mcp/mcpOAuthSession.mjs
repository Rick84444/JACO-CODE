// Local operator browser handoff. The canonical host owns subsequent MCP calls.
import http from 'node:http';
import {SecretStore} from '../../../../agents/lib/secret-store.mjs';
import {LINEAR_OAUTH as provider,guidedCredentialMatches} from '../../lib/mcpIntegrationCatalog.mjs';
import {beginLinearOAuth,exchangeLinearOAuth,linearOAuthStatus} from './mcpOAuthTransport.mjs';
import {HttpMcpClient} from './httpMcpClient.mjs';

const safe=e=>/^MCP_[A-Z0-9_]+$/.test(e?.message||'')?e.message:'MCP_OAUTH_FAILED';
const id=provider.id,ref=provider.credentialRef;
const definition=()=>({name:'Linear OAuth',transport:'http',url:provider.resource,tokenEnv:ref,icon:'mcp',agentAccess:'read',deny:[],allowOpenLogin:false});
const allowedDefinition=def=>!def||guidedCredentialMatches(id,def)&&def.agentAccess==='read';

async function verifyRead(record,fetchImpl){
  const c=new HttpMcpClient(id,definition(),{fetchImpl,oauthAccess:async()=>record.accessToken});
  try{
    await c.start();
    const tool=c.tools.find(t=>t.name==='list_teams'&&t.readOnly===true&&t.inputSchema?.type==='object'&&!(t.inputSchema.required||[]).length);
    if(!tool)throw Error('MCP_OAUTH_READ_PROBE_UNAVAILABLE');
    const result=await c.request('tools/call',{name:tool.name,arguments:{}},15000);
    if(!result||result.isError===true)throw Error('MCP_OAUTH_READ_PROBE_REJECTED');
    let body;
    try{body=result.structuredContent??JSON.parse(result.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n'));}
    catch{throw Error('MCP_OAUTH_READ_PROOF_INVALID');}
    const teams=Array.isArray(body)?body:body?.teams??body?.nodes;
    if(!Array.isArray(teams)||!teams.every(t=>typeof t?.id==='string'&&t.id.length))throw Error('MCP_OAUTH_READ_PROOF_INVALID');
    return {teamCount:teams.length};
  }finally{c.stop();}
}

/** @param {{host:any,store?:any,fetchImpl?:typeof fetch,onChanged?:()=>void,now?:()=>number}} options */
export class McpOAuthSession {
  #pending=null;
  #state='IDLE';
  #error=null;
  #verifiedAt=null;
  #proof=null;
  #generation=0;
  constructor({host,store=new SecretStore(),fetchImpl=fetch,onChanged=()=>{},now=Date.now}){
    Object.assign(this,{host,store,fetchImpl,onChanged,now});
  }
  status(){
    const credential=linearOAuthStatus({store:this.store,now:this.now});
    const config=this.host.servers()[id];
    const configured=Boolean(config&&allowedDefinition(config)&&credential.configured);
    return {id,state:this.#pending?this.#state:!configured&&this.#state==='READ_VERIFIED'?'AUTH_REQUIRED':this.#state==='IDLE'&&configured?'CONFIGURED':this.#state,configured,
      expiresAt:credential.expiresAt,refreshAvailable:credential.refreshAvailable,
      verifiedAt:configured?this.#verifiedAt:null,proof:configured?this.#proof:null,error:this.#error,
      scope:'read',agentExecutionVerified:false};
  }
  async start(){
    if(this.#pending)throw Error('MCP_OAUTH_PENDING');
    const before=this.host.servers()[id];
    if(!allowedDefinition(before))throw Error('MCP_OAUTH_EXISTING_CONFIGURATION');
    const beforeKey=JSON.stringify(before||null),prior=this.store.get(ref);
    const generation=++this.#generation;
    let attempt=null,busy=false;
    const valid=()=>generation===this.#generation&&this.#pending?.server===server;
    const close=()=>{clearTimeout(timer);server.close();if(this.#pending?.server===server)this.#pending=null;};
    const server=http.createServer(async(req,res)=>{
      res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/plain; charset=utf-8');
      res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'none'");
      let u;
      try{
        if(req.method!=='GET'||!attempt||!valid()||typeof req.url!=='string'||!req.url.startsWith('/')||req.url.startsWith('//'))throw Error();
        u=new URL(req.url,attempt.redirectUri);
        if(u.origin+u.pathname!==attempt.redirectUri||req.headers.host!==new URL(attempt.redirectUri).host)throw Error();
      }catch{res.writeHead(404);res.end('Not found');return;}
      if(busy){res.writeHead(409);res.end('Sign-in already processing.');return;}
      if(u.searchParams.get('state')!==attempt.state){res.writeHead(400);res.end('Invalid sign-in state.');return;}
      busy=true;this.#state='VERIFYING';
      try{
        const record=await exchangeLinearOAuth(attempt,u.href,{fetchImpl:this.fetchImpl,now:this.now});
        const proof=await verifyRead(record,this.fetchImpl);
        if(!valid())throw Error('MCP_OAUTH_CANCELLED');
        if(JSON.stringify(this.host.servers()[id]||null)!==beforeKey)throw Error('MCP_OAUTH_CONFIGURATION_CHANGED');
        if(!this.store.replaceIfCurrent(ref,prior,JSON.stringify(record),{source:'operator-oauth',purpose:'Linear OAuth read scope'}))throw Error('MCP_OAUTH_CREDENTIAL_CHANGED');
        if(!before){
          try{this.host.saveServer(id,definition());}
          catch{throw Error('MCP_OAUTH_CREDENTIAL_STORED_CONFIG_FAILED');}
        }else this.host.resetConnection(id);
        this.#verifiedAt=new Date(this.now()).toISOString();
        this.#proof=proof;
        this.#state='READ_VERIFIED';this.#error=null;
        try{this.onChanged();}catch{}
        res.writeHead(200);res.end('Linear account read verified. Return to JACO.');
      }catch(error){
        if(valid()){this.#state='ERROR';this.#error=safe(error);}
        res.writeHead(400);res.end('Linear sign-in did not complete. Return to JACO.');
      }finally{close();}
    });
    const timer=setTimeout(()=>{if(valid()){++this.#generation;this.#state='ERROR';this.#error='MCP_OAUTH_ATTEMPT_EXPIRED';}close();},300000);
    timer.unref();
    this.#pending={server};this.#state='PREPARING';this.#error=null;
    try{
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
      if(!valid())throw Error('MCP_OAUTH_CANCELLED');
      attempt=await beginLinearOAuth('http://127.0.0.1:'+server.address().port+'/mcp/oauth/callback',{fetchImpl:this.fetchImpl,now:this.now});
      if(!valid())throw Error('MCP_OAUTH_CANCELLED');
      this.#state='WAITING_FOR_CONSENT';
      return {id,url:attempt.url,state:this.#state};
    }catch(error){
      if(valid()){this.#state='ERROR';this.#error=safe(error);}
      close();throw Error(safe(error));
    }
  }
  cancel(){
    ++this.#generation;
    const pending=this.#pending;
    if(pending){pending.server.close();this.#pending=null;}
    this.#state='IDLE';this.#error=null;
    return this.status();
  }
  disconnect(){
    const config=this.host.servers()[id];
    if(!allowedDefinition(config))throw Error('MCP_OAUTH_EXISTING_CONFIGURATION');
    this.cancel();
    // Remove host entry first; a failed write cannot leave a usable token in its session.
    if(config)this.host.removeServer(id);
    this.store.delete(ref);
    this.#verifiedAt=null;this.#proof=null;this.#state='DISCONNECTED';
    try{this.onChanged();}catch{}
    return {...this.status(),remoteRevocationVerified:false};
  }
}
