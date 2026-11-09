// JACO Link SaaS control/transport plane. One account = one isolated Durable Object room.
// PC makes an outbound WebSocket, Android uses the existing jacocode.com Google session.
// Nothing on this cloud worker executes Aura, reads local files, or owns missions.
import { verifySiteSession } from './auth.mjs';
import { LINK_PROTOCOL, MAX_MESSAGE_BYTES, validateRemoteCall, validateHostResponse } from './link-protocol.mjs';

const enc = new TextEncoder(), dec = new TextDecoder();
const CODE = /^[A-Za-z0-9_-]{18,28}$/;
const MAX_BROWSERS = 8;
const MAX_PAIR_AGE = 10 * 60 * 1000;
const TOKEN_AGE = 90 * 86400;
const ORIGIN = 'https://jacocode.com';
const random = n => b64u(crypto.getRandomValues(new Uint8Array(n)));
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
const key = secret => crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
const sha = async text => b64u(await crypto.subtle.digest('SHA-256',enc.encode(text)));
const json = (payload,status=200) => Response.json(payload,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
const validCode = x => typeof x === 'string' && CODE.test(x);
const safeJson = async request => {
  if (Number(request.headers.get('content-length')||0)>4096) throw Error('REQUEST_TOO_LARGE');
  const raw = await request.text();
  if(raw.length>4096)throw Error('REQUEST_TOO_LARGE');
  try {return JSON.parse(raw);}catch{throw Error('INVALID_JSON');}
};
async function signTicket(data, secret) {
  const body = b64u(enc.encode(JSON.stringify(data)));
  return body + '.' + b64u(await crypto.subtle.sign('HMAC',await key(secret),enc.encode(body)));
}
async function checkTicket(token, secret) {
  const [body,sig,rest] = String(token||'').split('.');
  if (!body || !sig || rest || body.length>1000) return null;
  try {
    const valid = await crypto.subtle.verify('HMAC',await key(secret),unb64(sig),enc.encode(body));
    if(!valid)return null;
    const claims=JSON.parse(dec.decode(unb64(body)));
    const now=Math.floor(Date.now()/1000);
    return claims?.role==='host' && claims.sub && validCode(claims.did) &&
      claims.aud==='jaco-link' && claims.exp>now && claims.iat<=now ? claims : null;
  } catch {return null;}
}
function pending(env,code) {
  return env.LINK_PAIRINGS.get(env.LINK_PAIRINGS.idFromName('pair:'+code));
}
function room(env,sub) {
  return env.LINK_ROOMS.get(env.LINK_ROOMS.idFromName('account:'+sub));
}
function originOk(request) { return request.headers.get('origin')===ORIGIN; }
function signedIn(request,env){return verifySiteSession(request,env.SESSION_SECRET);}
async function quota(env,identity,limit) {
  const obj = env.LINK_PAIRINGS.get(env.LINK_PAIRINGS.idFromName('quota:'+identity));
  return obj.fetch('https://internal/quota',{method:'POST',body:JSON.stringify({limit})});
}
function socketError(code) {return new Response(code,{status:403});}

export async function handleLink(request,env,url) {
  if (!url.pathname.startsWith('/link/v1/') && url.pathname!=='/link/ws') return null;
  if (!env?.LINK_PAIRINGS || !env?.LINK_ROOMS || !env.LINK_SIGNING_KEY ||
      !env.SESSION_SECRET) return json({error:'LINK_NOT_CONFIGURED'},503);
  const route=url.pathname;
  if (route==='/link/v1/start' && request.method==='POST') {
    // A PC does not need an account token until the user approves a single-use code
    // in the logged-in browser. Distinct per-IP quota avoids unchecked allocations.
    const ip=request.headers.get('cf-connecting-ip')||'unidentified';
    const r=await quota(env,'ip:'+await sha(ip),30);
    if (!r.ok)return json({error:'PAIRING_RATE_LIMITED'},429);
    const code=random(18), pollToken=random(32);
    await pending(env,code).fetch('https://internal/start',{
      method:'POST',body:JSON.stringify({hash:await sha(pollToken),until:Date.now()+MAX_PAIR_AGE}),
    });
    return json({protocol:LINK_PROTOCOL,code,pollToken,
      approvalUrl:ORIGIN+'/link/connect.html?code='+encodeURIComponent(code),
      expiresIn:600});
  }
  if (route==='/link/v1/poll' && request.method==='GET') {
    const code=url.searchParams.get('code');
    const token=request.headers.get('authorization')||'';
    if (!validCode(code) || !token.startsWith('Bearer ') || token.length>160)
      return json({error:'PAIRING_CREDENTIALS_REQUIRED'},401);
    return pending(env,code).fetch('https://internal/poll?hash='+encodeURIComponent(await sha(token.slice(7))));
  }
  // All other account requests require the *existing Google* site session.
  const session=await signedIn(request,env);
  if (!session?.sub) return json({error:'ACCOUNT_LOGIN_REQUIRED'},401);
  if (route==='/link/v1/me' && request.method==='GET')
    return json({signedIn:true,name:session.name||'',email:session.email||''});
  if (route==='/link/v1/claim' && request.method==='POST') {
    if (!originOk(request)) return json({error:'ORIGIN_DENIED'},403);
    const body=await safeJson(request);
    if(!validCode(body.code))return json({error:'PAIR_CODE_INVALID'},400);
    const r=await quota(env,'account:'+await sha(session.sub),40);
    if(!r.ok)return json({error:'PAIRING_RATE_LIMITED'},429);
    const now=Math.floor(Date.now()/1000);
    const hostToken=await signTicket({
      aud:'jaco-link',role:'host',sub:session.sub,did:body.code,iat:now,exp:now+TOKEN_AGE,
    },env.LINK_SIGNING_KEY);
    const result=await pending(env,body.code).fetch('https://internal/claim',{
      method:'POST',body:JSON.stringify({token:hostToken}),
    });
    if(!result.ok)return json({error:'PAIR_CODE_EXPIRED_OR_USED'},409);
    return json({success:true,deviceId:body.code});
  }
  if (route==='/link/v1/hosts' && request.method==='GET')
    return room(env,session.sub).fetch('https://internal/hosts');
  if (route==='/link/v1/revoke' && request.method==='POST') {
    if(!originOk(request))return json({error:'ORIGIN_DENIED'},403);
    const data=await safeJson(request);
    if(!validCode(data.deviceId))return json({error:'INVALID_DEVICE'},400);
    return room(env,session.sub).fetch('https://internal/revoke',{
      method:'POST',body:JSON.stringify({deviceId:data.deviceId}),
    });
  }
  if (route==='/link/ws' && request.headers.get('upgrade')?.toLowerCase()==='websocket') {
    const role=url.searchParams.get('role');
    if (role==='phone') {
      if(!originOk(request))return socketError('ORIGIN_DENIED');
      return room(env,session.sub).fetch(new Request('https://internal/ws',{
        headers:{upgrade:'websocket','x-jaco-link-role':'phone'},
      }));
    }
  }
  return json({error:'LINK_ROUTE_NOT_FOUND'},404);
}

// Host WebSocket handshake: no browser cookie, only signed device ticket.
// Separate because the PC has no Google session until pairing is completed.
export async function handleLinkHostSocket(request,env,url) {
  if(url.pathname!=='/link/ws' || url.searchParams.get('role')!=='host')return null;
  if (!env?.LINK_SIGNING_KEY || !env?.LINK_ROOMS)return json({error:'LINK_NOT_CONFIGURED'},503);
  if(request.headers.get('upgrade')?.toLowerCase()!=='websocket')return json({error:'UPGRADE_REQUIRED'},426);
  const auth=request.headers.get('authorization')||'';
  const claims=auth.startsWith('Bearer ') ? await checkTicket(auth.slice(7),env.LINK_SIGNING_KEY):null;
  if(!claims)return json({error:'DEVICE_TOKEN_INVALID'},401);
  return room(env,claims.sub).fetch(new Request('https://internal/ws',{
    headers:{upgrade:'websocket','x-jaco-link-role':'host','x-jaco-link-device':claims.did},
  }));
}

// Durable pending slot, one per unguessable code. Token is never stored in clear text.
export class JacoLinkPairing {
  constructor(ctx){this.ctx=ctx;}
  async fetch(request) {
    const url=new URL(request.url);
    if(url.pathname==='/quota'){
      const {limit}=await request.json();
      const bucket=Math.floor(Date.now()/3600000);
      const state=await this.ctx.storage.get('quota');
      const used=state?.bucket===bucket?state.used:0;
      if(used>=Math.min(100,Math.max(1,Number(limit)||20)))return json({error:'RATE_LIMIT'},429);
      await this.ctx.storage.put('quota',{bucket,used:used+1});
      return json({ok:true});
    }
    if(url.pathname==='/start' && request.method==='POST') {
      const data=await request.json();
      if(!data.hash || !Number.isFinite(data.until)||data.until>Date.now()+MAX_PAIR_AGE+1000)
        return json({error:'BAD_PAIR'},400);
      if(await this.ctx.storage.get('pair'))return json({error:'DUPLICATE_PAIR'},409);
      await this.ctx.storage.put('pair',{hash:data.hash,until:data.until,token:null,delivered:false});
      return json({ok:true});
    }
    const value=await this.ctx.storage.get('pair');
    if(!value || value.until<Date.now())return json({error:'PAIR_EXPIRED'},410);
    if(url.pathname==='/claim' && request.method==='POST') {
      if(value.token || value.delivered)return json({error:'PAIR_USED'},409);
      const {token}=await request.json();
      if(typeof token!=='string'||token.length>1500)return json({error:'TOKEN_INVALID'},400);
      await this.ctx.storage.put('pair',{...value,token});
      return json({ok:true});
    }
    if(url.pathname==='/poll' && request.method==='GET') {
      const proposed=url.searchParams.get('hash')||'';
      let diff=proposed.length===value.hash.length?0:1;
      for(let i=0;i<Math.min(proposed.length,value.hash.length);i++)
        diff|=proposed.charCodeAt(i)^value.hash.charCodeAt(i);
      if(diff)return json({error:'POLL_UNAUTHORIZED'},401);
      if(value.delivered)return json({error:'PAIR_ALREADY_DELIVERED'},410);
      if(!value.token)return json({state:'PENDING'});
      await this.ctx.storage.put('pair',{...value,token:null,delivered:true});
      return json({state:'APPROVED',hostToken:value.token});
    }
    return json({error:'NOT_FOUND'},404);
  }
}

// Per-account single-writer relay. All WebSockets are scoped by the Worker to a
// verified account. The cloud never stores missions, messages or model prompts.
export class JacoLinkRoom {
  constructor(ctx) {
    this.ctx=ctx;
    this.pending=new Map();
    this.counters=new WeakMap();
  }
  sockets(role) {
    return this.ctx.getWebSockets().filter(ws=>ws.deserializeAttachment()?.role===role);
  }
  async fetch(request) {
    const url=new URL(request.url);
    if(url.pathname==='/hosts'){
      const online=new Set(this.sockets('host').map(ws=>ws.deserializeAttachment().deviceId));
      const devices=await this.ctx.storage.list({prefix:'device:'});
      const hosts=[...devices].map(([key,value])=>({deviceId:key.slice(7),online:online.has(key.slice(7)),label:value?.label||'Windows PC',createdAt:value?.createdAt}));
      return json({hosts,online:online.size>0});
    }
    if(url.pathname==='/revoke'&&request.method==='POST'){
      const {deviceId}=await request.json();
      // Revocation is permanent for this device token. Never age out previous
      // revocations just because newer devices were registered.
      await this.ctx.storage.put('revoked:'+deviceId,true);
      await this.ctx.storage.delete('device:'+deviceId);
      for(const ws of this.sockets('host')){
        if(ws.deserializeAttachment().deviceId===deviceId)ws.close(4003,'Device revoked');
      }
      return json({revoked:true,deviceId});
    }
    if(url.pathname!=='/ws'||request.headers.get('upgrade')?.toLowerCase()!=='websocket')
      return json({error:'NOT_FOUND'},404);
    const role=request.headers.get('x-jaco-link-role');
    const deviceId=request.headers.get('x-jaco-link-device');
    if(!['host','phone'].includes(role))return json({error:'ROLE_INVALID'},403);
    if(role==='host'){
      if(!validCode(deviceId))return json({error:'DEVICE_INVALID'},403);
      if(await this.ctx.storage.get('revoked:'+deviceId))return json({error:'DEVICE_REVOKED'},403);
      if(!(await this.ctx.storage.get('device:'+deviceId)))await this.ctx.storage.put('device:'+deviceId,{
        label:'Windows PC',createdAt:new Date().toISOString(),
      });
      for(const ws of this.sockets('host')){
        if(ws.deserializeAttachment().deviceId===deviceId)ws.close(4001,'Host replaced');
      }
    } else if(this.sockets('phone').length>=MAX_BROWSERS) return json({error:'TOO_MANY_PHONES'},429);
    const [client,server]=Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({role,deviceId:role==='host'?deviceId:null});
    return new Response(null,{status:101,webSocket:client});
  }
  send(ws,value){try{ws.send(JSON.stringify(value));}catch{/* client disconnected */}}
  webSocketMessage(ws, raw) {
    if(typeof raw!=='string'||raw.length>MAX_MESSAGE_BYTES){ws.close(1009,'Message too large');return;}
    let value;
    try {value=JSON.parse(raw);}catch{this.send(ws,{type:'error',error:'INVALID_JSON'});return;}
    const info=ws.deserializeAttachment();
    if(info?.role==='phone'){
      if(value?.type!=='rpc')return this.send(ws,{type:'error',error:'UNKNOWN_MESSAGE_TYPE'});
      const count=this.counters.get(ws)||{start:Date.now(),used:0};
      if(Date.now()-count.start>60_000){count.start=Date.now();count.used=0;}
      if(++count.used>100){this.send(ws,{type:'error',error:'RATE_LIMIT'});return;}
      this.counters.set(ws,count);
      const valid=validateRemoteCall(value);
      if(!valid.ok)return this.send(ws,{type:'rpc_result',id:String(value?.id||''),status:403,body:{error:valid.error}});
      if(this.pending.has(valid.id))return this.send(ws,{type:'rpc_result',id:valid.id,status:409,body:{error:'DUPLICATE_REQUEST_ID'}});
      const hosts=this.sockets('host').filter(s=>!valid.target||s.deserializeAttachment().deviceId===valid.target);
      if(hosts.length!==1)return this.send(ws,{type:'rpc_result',id:valid.id,status:503,body:{error:hosts.length?'SELECT_A_PC':'PC_OFFLINE'}});
      this.pending.set(valid.id,{phone:ws,host:hosts[0],at:Date.now()});
      this.send(hosts[0],{type:'rpc',id:valid.id,method:valid.method,path:valid.path,body:valid.body});
      return;
    }
    if(info?.role==='host'&&validateHostResponse(value)){
      const held=this.pending.get(value.id);
      if(!held||held.host!==ws)return;
      this.pending.delete(value.id);
      this.send(held.phone,value);
    }
  }
  webSocketClose(ws) {
    for(const [id,p] of this.pending){
      if(p.phone===ws)this.pending.delete(id);
      else if(p.host===ws){
        this.pending.delete(id);
        this.send(p.phone,{type:'rpc_result',id,status:503,body:{error:'PC_DISCONNECTED_OUTCOME_UNKNOWN'}});
      }
    }
  }
  webSocketError(ws){this.webSocketClose(ws);}
}
