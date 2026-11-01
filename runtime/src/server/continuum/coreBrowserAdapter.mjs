export class CoreBrowserSessionsAdapter {
  constructor({baseUrl='http://127.0.0.1:3000',token=''}={}){this.baseUrl=String(baseUrl).replace(/\/$/,'');this.token=token;this.session={attached:false,cdpPort:9222,urlIncludes:null,attachedAt:null};}
  headers(json=false){return {...(json?{'content-type':'application/json'}:{}),...(this.token?{'x-gateway-token':this.token}:{})};}
  async call(path,{method='GET',body=null}={}){const r=await fetch(`${this.baseUrl}${path}`,{method,headers:this.headers(body!==null),body:body===null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(`CORE_BROWSER_${r.status}:${data?.error?.message||data?.error||JSON.stringify(data).slice(0,300)}`);return data;}
  snapshot(){return {...this.session,executionSubstrate:this.baseUrl};}
  async targets(port=9222){const d=await this.call(`/api/browser/hands-off/targets?port=${encodeURIComponent(port)}`);return d.targets||[];}
  async attach(input={}){const d=await this.call('/api/browser/hands-off/attach',{method:'POST',body:{port:input.port||9222,urlIncludes:input.urlIncludes,targetId:input.targetId}});this.session={...(d.session||{}),executionSubstrate:this.baseUrl};return this.snapshot();}
  async detach(){await this.call('/api/browser/hands-off/detach',{method:'POST',body:{}});this.session={attached:false,cdpPort:9222,urlIncludes:null,attachedAt:null};}
  getClient(){if(!this.session.attached)return null;return {
    survey:async(label)=>{const d=await this.call('/api/browser/hands-off/survey',{method:'POST',body:{label}});return d.survey;},
    observe:async()=>{const d=await this.call('/api/browser/hands-off/observe',{method:'POST',body:{}});return d.observation;},
    executeVerified:async(action)=>{try{const d=await this.call('/api/browser/hands-off/action',{method:'POST',body:action});return d.receipt;}catch(error){const msg=error instanceof Error?error.message:String(error);return {verified:false,refusal:msg,verification:{level:'UNVERIFIED'},action};}}
  };}
  async probe(){try{const d=await this.call('/api/runtime/identity');return {reachable:true,identity:d};}catch(error){return {reachable:false,error:error instanceof Error?error.message:String(error)};}}
}
