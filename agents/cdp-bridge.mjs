// Authenticated, stateless MCP facade. Browser execution stays in nova-bridge.
// 2996 = MCP, 2998 = A2A, 4243 = Nova, 9222 = private Chrome CDP.
import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const definitions=[
  ['nova_targets','List allowed browser tabs','GET','/targets',{}],
  ['nova_observe','Observe the pinned allowed page','GET','/observe',{}],
  ['nova_screenshot','Capture the pinned allowed page','GET','/screenshot',{}],
  ['nova_html','Read the pinned allowed page as cleaned HTML: no scripts, comments, element values, hidden fields, token metadata, event handlers, data attributes, or URL query strings and fragments. Visible page text is returned as shown','GET','/html',{}],
  ['nova_navigate','Navigate within configured origins','POST','/navigate',{url:{type:'string'}}],
  ['nova_click','Click a unique selector and verify an explicit transition','POST','/click',{selector:{type:'string'},expectedUrl:{type:'string'},expect:{type:'object',properties:{url:{type:'string'},selector:{type:'string'}}}}],
  ['nova_type','Set a field and read back the value','POST','/type',{selector:{type:'string'},expectedUrl:{type:'string'},text:{type:'string'}}],
];
export function createCdpFacade({token=process.env.JACO_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || '',base=process.env.NOVA_BRIDGE_URL || 'http://127.0.0.1:4243',fetchImpl=fetch}={}) {
  const send=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
  return createServer(async(req,res)=>{
    let id=null;
    try {
      const path=new URL(req.url,'http://localhost').pathname;
      if (req.method==='GET' && path==='/health') return send(res,200,{ok:true,service:'jaco-cdp-mcp',protocol:'2025-03-26',browserVerified:false});
      const a=Buffer.from(req.headers.authorization || ''),b=Buffer.from('Bearer '+token);
      if (token.length<24 || a.length!==b.length || !timingSafeEqual(a,b)) return send(res,401,{error:'UNAUTHORIZED'});
      if (req.headers.origin) return send(res,403,{error:'BROWSER_ORIGIN_DENIED'});
      if (path!=='/mcp') return send(res,404,{error:'NOT_FOUND'});
      if(req.method!=='POST') return send(res,405,{error:'POST_REQUIRED'});
      let size=0;const chunks=[];
      for await (const c of req) {size+=c.length;if(size>65536)return send(res,413,{error:'BODY_TOO_LARGE'});chunks.push(c);}
      let msg;try {msg=JSON.parse(Buffer.concat(chunks).toString());}catch{return send(res,400,{jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});}
      id=msg.id ?? null;
      const reply=result=>send(res,200,{jsonrpc:'2.0',id,result});
      const error=(code,message)=>send(res,200,{jsonrpc:'2.0',id,error:{code,message}});
      if(msg.jsonrpc!=='2.0' || typeof msg.method!=='string') return error(-32600,'Invalid Request');
      if(msg.id===undefined) {res.writeHead(202);res.end();return;}
      if(msg.method==='initialize') return reply({protocolVersion:['2024-11-05','2025-03-26','2025-06-18'].includes(msg.params?.protocolVersion)?msg.params.protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'jaco-nova',version:'1.1.0'}});
      if(msg.method==='ping') return reply({});
      if(msg.method==='tools/list') return reply({tools:definitions.map(([name,description,method,path,properties])=>({name,description,inputSchema:{type:'object',properties,required:Object.keys(properties),additionalProperties:false},annotations:{readOnlyHint:method==='GET',openWorldHint:true}}))});
      if(msg.method!=='tools/call') return error(-32601,'Method not found');
      const def=definitions.find(d=>d[0]===msg.params?.name);
      if(!def) return error(-32602,'Unknown tool');
      const args=msg.params.arguments || {};
      if(!args || typeof args!=='object' || Array.isArray(args)) return error(-32602,'Invalid arguments');
      for(const [key,schema] of Object.entries(def[4])) if(typeof args[key]!==schema.type || args[key]===null) return error(-32602,'Invalid '+key);
      if(Object.keys(args).some(k=>!(k in def[4]))) return error(-32602,'Unexpected argument');
      try {
        const r=await fetchImpl(base+def[3],{method:def[2],headers:{'content-type':'application/json',Authorization:'Bearer '+token},...(def[2]==='POST'?{body:JSON.stringify(args)}:{}),signal:AbortSignal.timeout(20000)});
        const result=await r.json();
        const failed=!r.ok || result.ok!==true;
        if(!failed && def[0]==='nova_screenshot') return reply({content:[{type:'image',mimeType:'image/png',data:result.data}],isError:false});
        return reply({content:[{type:'text',text:JSON.stringify(result)}],isError:failed});
      }catch(e){return reply({content:[{type:'text',text:JSON.stringify({ok:false,error:e.message,outcomeUnknown:def[2]==='POST'})}],isError:true});}
    }catch(e){send(res,500,{jsonrpc:'2.0',id,error:{code:-32603,message:e.message}});}
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  if((process.env.JACO_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || '').length<24) throw new Error('JACO_GATEWAY_TOKEN_REQUIRED_MIN_24');
  createCdpFacade().listen(Number(process.env.JACO_CDP_BRIDGE_PORT || 2996),'127.0.0.1',()=>console.log('JACO CDP MCP listening on loopback; /mcp requires Bearer authentication.'));
}
