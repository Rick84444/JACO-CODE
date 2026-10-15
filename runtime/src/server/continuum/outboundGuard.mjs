import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

// Outbound HTTP for peer-supplied URLs (Agent Cards and their interfaces).
// Peer data decides where JACO connects, so every request is checked at connect time, never follows redirects,
// is size and time bounded, and cannot reach loopback/private/link-local/metadata addresses unless the operator
// allowlisted that exact origin in JACO_A2A_ALLOWED_PRIVATE_ORIGINS (for local peer-to-peer development).

function v4ToInt(ip){return ip.split('.').reduce((n,o)=>(n*256)+Number(o),0);}
const V4_BLOCKED=[['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]];
function inV4(ip,[base,bits]){const mask=bits===0?0:(0xFFFFFFFF<<(32-bits))>>>0;return ((v4ToInt(ip)&mask)>>>0)===((v4ToInt(base)&mask)>>>0);}

export function isBlockedAddress(address){
  const ip=String(address||'').replace(/^\[|\]$/g,'').split('%')[0];
  if(net.isIPv4(ip))return V4_BLOCKED.some(range=>inV4(ip,range));
  if(!net.isIPv6(ip))return true;
  const lower=ip.toLowerCase();
  const mapped=lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);if(mapped)return isBlockedAddress(mapped[1]);
  if(lower==='::'||lower==='::1')return true;
  const first=parseInt(lower.split(':')[0]||'0',16);
  if((first&0xfe00)===0xfc00)return true; // fc00::/7 unique local
  if((first&0xffc0)===0xfe80)return true; // fe80::/10 link local
  if((first&0xff00)===0xff00)return true; // ff00::/8 multicast
  if(lower.startsWith('64:ff9b:')||lower.startsWith('2001:db8:'))return true; // NAT64, documentation
  return false;
}

export function allowedPrivateOrigins(env=process.env){return new Set(String(env.JACO_A2A_ALLOWED_PRIVATE_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean).map(s=>new URL(s).origin));}

// Only environment variables meant for A2A bearers may be sent to peers; anything else (payment keys, gateway tokens) is refused.
const BEARER_ENV=/^(A2A_BEARER_TOKEN|JACO_A2A_PEER_[A-Z0-9_]{1,64}_TOKEN)$/;
export function bearerFromEnv(name,env=process.env){if(!name)return '';const key=String(name);if(!BEARER_ENV.test(key))throw new Error('A2A_BEARER_ENV_NOT_ALLOWED');return String(env[key]||'');}

export function assertPeerUrl(raw,{allowPrivate=allowedPrivateOrigins()}={}){
  let url;try{url=new URL(String(raw));}catch{throw new Error('A2A_URL_INVALID');}
  if(!['http:','https:'].includes(url.protocol))throw new Error('A2A_URL_PROTOCOL_NOT_ALLOWED');
  if(url.username||url.password)throw new Error('A2A_URL_CREDENTIALS_NOT_ALLOWED');
  const host=url.hostname.replace(/^\[|\]$/g,'');
  if(net.isIP(host)&&isBlockedAddress(host)&&!allowPrivate.has(url.origin))throw new Error('A2A_PRIVATE_ADDRESS_BLOCKED');
  return url;
}

export async function guardedRequest(raw,{method='GET',headers={},body=null,timeoutMs=8000,maxBytes=256*1024,allowPrivate=allowedPrivateOrigins()}={}){
  const url=assertPeerUrl(raw,{allowPrivate});
  const privateOk=allowPrivate.has(url.origin);
  // Validate the address actually used for the connection, so DNS answers cannot redirect JACO inward.
  const lookup=(hostname,options,callback)=>{dns.lookup(hostname,{all:true,verbatim:true},(error,addresses)=>{
    if(error)return callback(error);
    const usable=privateOk?addresses:addresses.filter(a=>!isBlockedAddress(a.address));
    if(!usable.length)return callback(Object.assign(new Error('A2A_PRIVATE_ADDRESS_BLOCKED'),{code:'A2A_PRIVATE_ADDRESS_BLOCKED'}));
    if(options?.all)return callback(null,usable);
    callback(null,usable[0].address,usable[0].family);
  });};
  const payload=body==null?null:Buffer.from(typeof body==='string'?body:JSON.stringify(body));
  const client=url.protocol==='https:'?https:http;
  return await new Promise((resolve,reject)=>{
    const req=client.request(url,{method,lookup,headers:{accept:'application/json',...headers,...(payload?{'content-length':String(payload.length)}:{})},timeout:timeoutMs},res=>{
      if(res.statusCode>=300&&res.statusCode<400){res.resume();return reject(new Error(`A2A_REDIRECT_REFUSED:${res.statusCode}`));}
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){req.destroy(new Error('A2A_RESPONSE_TOO_LARGE'));return;}chunks.push(chunk);});
      res.on('end',()=>{const text=Buffer.concat(chunks).toString('utf8');let json;try{json=JSON.parse(text);}catch{json=undefined;}resolve({status:res.statusCode,ok:res.statusCode>=200&&res.statusCode<300,text,json,url});});
      res.on('error',reject);
    });
    req.on('timeout',()=>req.destroy(new Error('A2A_REQUEST_TIMEOUT')));
    req.on('error',error=>reject(error.code==='A2A_PRIVATE_ADDRESS_BLOCKED'?new Error('A2A_PRIVATE_ADDRESS_BLOCKED'):error));
    if(payload)req.write(payload);
    req.end();
  });
}

// Structural validation of a peer Agent Card (A2A v1.0 wire form). Content remains unverified peer claims.
export function validateAgentCard(card){
  const errors=[];
  if(!card||typeof card!=='object'||Array.isArray(card))return ['card must be a JSON object'];
  if(typeof card.name!=='string'||!card.name.trim()||card.name.length>240)errors.push('name must be a non-empty string up to 240 characters');
  if(card.version!==undefined&&typeof card.version!=='string')errors.push('version must be a string');
  if(!Array.isArray(card.supportedInterfaces)||!card.supportedInterfaces.length||card.supportedInterfaces.length>20)errors.push('supportedInterfaces must list 1 to 20 interfaces');
  else card.supportedInterfaces.forEach((iface,i)=>{
    try{const u=new URL(String(iface?.url));if(!['http:','https:'].includes(u.protocol))errors.push(`supportedInterfaces[${i}].url must be http(s)`);}catch{errors.push(`supportedInterfaces[${i}].url is not a valid URL`);}
    if(typeof iface?.protocolBinding!=='string'||!iface.protocolBinding)errors.push(`supportedInterfaces[${i}].protocolBinding is required`);
    if(typeof iface?.protocolVersion!=='string'||!iface.protocolVersion)errors.push(`supportedInterfaces[${i}].protocolVersion is required`);
  });
  if(card.skills!==undefined&&(!Array.isArray(card.skills)||card.skills.length>500||card.skills.some(s=>!s||typeof s.id!=='string'||typeof s.name!=='string')))errors.push('skills must be up to 500 objects with string id and name');
  if(card.securitySchemes!==undefined&&(typeof card.securitySchemes!=='object'||Array.isArray(card.securitySchemes)))errors.push('securitySchemes must be an object');
  return errors;
}
