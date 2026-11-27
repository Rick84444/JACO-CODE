// Local operator browser hand-off. Internal service only; the HTTP UI must never return tokens.
import http from 'node:http';
import {beginLinearOAuth,completeLinearOAuth} from './oauthReadonly.mjs';

const safeError=e=>/^MCP_OAUTH_[A-Z0-9_]+$/.test(e?.message||'')?e.message:'MCP_OAUTH_FAILED';
export class ReadonlyMcpOAuthSession {
  #pending=null;
  #state='idle';
  #error=null;
  #generation=0;
  /** @param {{fetchImpl?:typeof fetch,onAuthorized:(session:any,isCurrent:()=>boolean)=>Promise<void>}} options */
  constructor({fetchImpl=fetch,onAuthorized}){
    if(typeof onAuthorized!=='function')throw Error('MCP_OAUTH_INTERNAL_HANDLER_REQUIRED');
    this.fetchImpl=fetchImpl;this.onAuthorized=onAuthorized;
  }
  status(){return {state:this.#state,error:this.#error,pending:!!this.#pending,accountVerified:false};}
  cancel(){
    ++this.#generation;
    if(this.#pending){clearTimeout(this.#pending.timer);this.#pending.server.close();this.#pending=null;}
    this.#state='idle';this.#error=null;
    return this.status();
  }
  async start(){
    if(this.#pending)throw Error('MCP_OAUTH_BUSY');
    const generation=++this.#generation;
    const current=()=>generation===this.#generation;
    let attempt,processing=false;
    const close=()=>{clearTimeout(timer);server.close();if(this.#pending?.server===server)this.#pending=null;};
    const server=http.createServer(async(req,res)=>{
      res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
      res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
      res.setHeader('Content-Type','text/plain; charset=utf-8');
      if(!current()||!attempt||req.method!=='GET'||req.headers.host!==new URL(attempt.redirectUri).host||typeof req.url!=='string'||!req.url.startsWith('/mcp/oauth/callback?')||req.url.length>8192){res.writeHead(404);res.end('Not found');return;}
      if(processing){res.writeHead(409);res.end('Already processing');return;}
      const callback=new URL(req.url,attempt.redirectUri);
      processing=true;
      try{
        const session=await completeLinearOAuth(attempt,callback.href,{fetchImpl:this.fetchImpl});
        if(!current())throw Error('MCP_OAUTH_CANCELLED');
        // Internal callback owns storage and account verification. No token reaches the browser.
        // Do not install a connector here; the canonical host is its owner.
        await this.onAuthorized(session,current);
        if(!current())throw Error('MCP_OAUTH_CANCELLED');
        this.#state='authorized';this.#error=null;
        res.writeHead(200);res.end('Authorization received. Return to JACO for connection verification.');
        close();
      }catch(e){
        if(!attempt.consumed&&current()&&safeError(e)==='MCP_OAUTH_CALLBACK_MISMATCH'){
          res.writeHead(400);res.end('Invalid authorization state.');processing=false;return;
        }
        if(current()){this.#state='error';this.#error=safeError(e);}
        res.writeHead(400);res.end('Authorization did not complete. Return to JACO.');close();
      }
    });
    server.requestTimeout=15000;server.headersTimeout=10000;
    const timer=setTimeout(()=>{if(current()){++this.#generation;this.#state='error';this.#error='MCP_OAUTH_ATTEMPT_EXPIRED';}close();},330000);
    timer.unref();
    this.#pending={server,timer};this.#state='starting';this.#error=null;
    try{
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
      if(!current())throw Error('MCP_OAUTH_CANCELLED');
      attempt=await beginLinearOAuth({redirectUri:'http://127.0.0.1:'+server.address().port+'/mcp/oauth/callback',fetchImpl:this.fetchImpl});
      if(!current())throw Error('MCP_OAUTH_CANCELLED');
      this.#state='waiting';
      return {url:attempt.url,state:'waiting'};
    }catch(e){if(current()){this.#state='error';this.#error=safeError(e);}close();throw Error(safeError(e));}
  }
}
