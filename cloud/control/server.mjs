import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import pg from 'pg';
import {WebSocketServer} from 'ws';
import {handleAuth} from '../../site/jacocode.com/auth.mjs';
import {handleLink,handleLinkHostSocket} from '../../site/jacocode.com/link.mjs';
import {MAX_MESSAGE_BYTES} from '../../site/jacocode.com/link-protocol.mjs';
import {createRenderLink} from './render-link.mjs';

const origin=process.env.PUBLIC_ORIGIN||process.env.RENDER_EXTERNAL_URL||'';
if(!/^https:\/\/[a-zA-Z0-9.-]+$/.test(origin))throw Error('PUBLIC_HTTPS_ORIGIN_REQUIRED');
const enabled=process.env.LINK_ENABLED==='1';
const dbUrl=process.env.DATABASE_URL;
if(!dbUrl)throw Error('DATABASE_URL_REQUIRED');
const pool=new pg.Pool({connectionString:dbUrl,max:8,connectionTimeoutMillis:5000,statement_timeout:10000});
pool.on('error',()=>console.error('JACO_CLOUD_DB_POOL_ERROR'));
const lease=await pool.connect();
// An exclusive process lease prevents competing Render instances dispatching
// through the same account. Do not retry unknown mutations on process death.
const lock=await lease.query('SELECT pg_try_advisory_lock(14729013,20261121) AS acquired');
if(!lock.rows[0].acquired){lease.release();await pool.end();throw Error('LINK_SINGLE_OWNER_LEASE_BUSY');}
lease.on('error',()=>process.exit(1));lease.on('end',()=>process.exit(1));
for(const file of ['001_missions.sql','002_link.sql'])await lease.query(await readFile(new URL('./sql/'+file,import.meta.url),'utf8'));
const env={PUBLIC_ORIGIN:origin,LINK_ENABLED:enabled?'1':'0',GOOGLE_CLIENT_ID:process.env.GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET:process.env.GOOGLE_CLIENT_SECRET,SESSION_SECRET:process.env.SESSION_SECRET,LINK_SIGNING_KEY:process.env.LINK_SIGNING_KEY};
const key=Buffer.from(process.env.LINK_STORAGE_KEY||'','base64url');
if(enabled&&(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||String(env.SESSION_SECRET||'').length<32||String(env.LINK_SIGNING_KEY||'').length<32||key.length!==32))throw Error('LINK_CONFIGURATION_REQUIRED');
const link=enabled?createRenderLink(pool,key):null;
if(link)Object.assign(env,link);
const wss=new WebSocketServer({noServer:true,maxPayload:MAX_MESSAGE_BYTES,perMessageDeflate:false});
const assets=fileURLToPath(new URL('../../site/jacocode.com/public/link/',import.meta.url));
const mime={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml',png:'image/png',webmanifest:'application/manifest+json'};
const publicFiles=new Set(['connect.html','connect.js','remote.html','remote.js','runtime-identity.js','style.css','icon.svg','memory-tree.png','manifest.webmanifest']);
const json=(data,status=200)=>Response.json(data,{status});
function requestHeaders(req){
  const h=new Headers();
  for(const [k,v] of Object.entries(req.headers))if(v!==undefined)h.set(k,Array.isArray(v)?v.join(', '):v);
  // Render terminates TLS. Do not accept client-supplied internal link claims.
  for(const name of [...h.keys()])if(name.startsWith('x-jaco-link-'))h.delete(name);
  // Use only the platform-provided peer address header; otherwise share a conservative quota.
  h.set('cf-connecting-ip',String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',').at(-1).trim().slice(0,100));
  return h;
}
async function request(req){
  let body;
  if(!['GET','HEAD'].includes(req.method)){
    const chunks=[];let total=0;
    for await(const chunk of req){total+=chunk.length;if(total>4096)throw Error('REQUEST_TOO_LARGE');chunks.push(chunk);}
    body=Buffer.concat(chunks);
  }
  return new Request(new URL(req.url,origin),{method:req.method,headers:requestHeaders(req),...(body?{body}:{})});
}
async function route(r){
  const url=new URL(r.url);
  if(url.origin!==origin)return json({error:'ORIGIN_INVALID'},400);
  if(url.pathname==='/health'&&r.method==='GET'){
    try{await pool.query('SELECT 1');return json({service:'jaco-cloud',database:'READY',link:enabled?'CONFIGURED':'DISABLED',oauthMcp:'NOT_CONFIGURED',auraRuntime:'REMOTE_ONLY',revision:process.env.RENDER_GIT_COMMIT||null});}
    catch{return json({service:'jaco-cloud',database:'UNAVAILABLE'},503);}
  }
  if(url.pathname==='/robots.txt')return new Response('User-agent: *\nDisallow: /\n',{headers:{'content-type':'text/plain'}});
  if(url.pathname==='/'&&r.method==='GET')return json({service:'jaco-cloud',remote:'/link/remote.html',link:enabled?'CONFIGURED':'DISABLED'});
  if(url.pathname.startsWith('/auth/'))return enabled?await handleAuth(r,env,url):json({error:'LINK_NOT_ENABLED'},503);
  if(url.pathname.startsWith('/link/v1/')||url.pathname==='/link/ws'){
    if(!enabled)return json({error:'LINK_NOT_ENABLED'},503);
    return await handleLinkHostSocket(r,env,url)||await handleLink(r,env,url)||json({error:'NOT_FOUND'},404);
  }
  const name=url.pathname.slice('/link/'.length);
  if(r.method==='GET'&&url.pathname.startsWith('/link/')&&publicFiles.has(name)){
    return new Response(await readFile(resolve(assets,name)),{headers:{'content-type':mime[name.split('.').at(-1)]}});
  }
  return json({error:'NOT_FOUND'},404);
}
const common={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY','content-security-policy':"default-src 'self'; connect-src 'self' "+origin.replace('https:','wss:')+"; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
const server=http.createServer(async(req,res)=>{
  try{const response=await route(await request(req));if(!(response instanceof Response))throw Error('UPGRADE_REQUIRED');
    const headers={...common,...Object.fromEntries(response.headers)};delete headers['set-cookie'];const cookies=response.headers.getSetCookie();if(cookies.length)headers['set-cookie']=cookies;
    res.writeHead(response.status,headers);res.end(Buffer.from(await response.arrayBuffer()));
  }catch(e){if(!res.headersSent)res.writeHead(e.message==='REQUEST_TOO_LARGE'?413:500,{'content-type':'application/json',...common});res.end(JSON.stringify({error:e.message==='REQUEST_TOO_LARGE'?'REQUEST_TOO_LARGE':'CLOUD_REQUEST_FAILED'}));}
});
server.on('upgrade',async(req,socket,head)=>{
  try{
    const response=await route(new Request(new URL(req.url,origin),{headers:requestHeaders(req)}));
    if(!response?.jacoUpgrade){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
    wss.handleUpgrade(req,socket,head,ws=>response.room.accept(ws,response.attachment));
  }catch{socket.destroy();}
});
server.requestTimeout=15000;server.headersTimeout=10000;
server.listen(Number(process.env.PORT||10000),'0.0.0.0',()=>console.log('JACO Cloud listening; Link '+(enabled?'configured':'disabled')));
process.on('SIGTERM',()=>{link?.close();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),5000).unref();});
