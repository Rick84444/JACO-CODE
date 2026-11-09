// JACO Link host connector: outbound only. This is a transport for the one
// Windows Aura, not a second executor or a cloud mirror of local memory.
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { validateRemoteCall, MAX_RESPONSE_BYTES } from '../../../../site/jacocode.com/link-protocol.mjs';

const DEFAULT_ORIGIN = 'https://jacocode.com';
const CODE = /^[A-Za-z0-9_-]{18,28}$/;
const RETRY_MS = 10_000;
const json = (value) => JSON.stringify(value);
const validHostToken = x => typeof x==='string' && x.length>80 && x.length<1600;
const fileSafe = file => {
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw Error('LINK_TOKEN_SYMLINK');
  const dir=path.dirname(file);
  if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw Error('LINK_STATE_DIR_SYMLINK');
};
function writeState(file,value) {
  fileSafe(file);
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const temp=file+'.'+process.pid+'.tmp';
  try {
    fs.writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600,flag:'wx'});
    fs.renameSync(temp,file);
  } finally {try{fs.rmSync(temp,{force:true});}catch{}}
}
function readState(file){
  fileSafe(file);
  try {return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){
    if(error?.code==='ENOENT')return null;
    throw error;
  }
}
const isLocal = input => {
  try {const u=new URL(input);return u.protocol==='http:' && ['127.0.0.1','[::1]'].includes(u.hostname) && !u.username && !u.password && (u.pathname==='/'||u.pathname==='');}
  catch {return false;}
};

export function createJacoLinkHost({
  file, localBaseUrl='http://127.0.0.1:3000', origin=DEFAULT_ORIGIN,
  fetchImpl=fetch, websocketFactory=(url,options)=>new WebSocket(url,options),
  onStatus=()=>{}, schedule=setTimeout, cancel=clearTimeout,
}={}) {
  if(!file || !isLocal(localBaseUrl)) throw Error('LINK_REQUIRES_LOCAL_AURA');
  if(!/^https:\/\/[A-Za-z0-9.-]+$/.test(origin) || new URL(origin).hostname!==new URL(DEFAULT_ORIGIN).hostname)
    throw Error('LINK_ORIGIN_NOT_TRUSTED');
  let saved=readState(file);
  let state='DISCONNECTED', error=null, socket=null, timer=null;
  let stopped=false, pendingCalls=0;
  const persist=data=>{saved=data;writeState(file,data);};
  const status=()=>({
    state,error,configured:Boolean(saved?.hostToken),
    deviceId:saved?.deviceId||null,
    pairing:saved?.pending && saved.pending.until>Date.now()
      ? {code:saved.pending.code,approvalUrl:origin+'/link/connect.html?code='+encodeURIComponent(saved.pending.code),expiresAt:new Date(saved.pending.until).toISOString()}
      : null,
    pendingCalls,
    remoteUrl:origin+'/link/remote.html',
    // Never return tokens or device secrets from the local status route.
  });
  const report=(next,reason=null)=>{state=next;error=reason;try{onStatus(status());}catch{}};
  const arm=(fn,ms)=>{if(timer)cancel(timer);if(!stopped)timer=schedule(fn,ms);};
  const root=origin+'/link/v1';
  const exchange=async (endpoint,init={})=>{
    const r=await fetchImpl(root+endpoint,{redirect:'error',signal:AbortSignal.timeout(10_000),...init});
    const result=await r.json().catch(()=>({error:'INVALID_LINK_RESPONSE'}));
    if(!r.ok)throw Error(result.error || 'LINK_HTTP_'+r.status);
    return result;
  };
  async function startPairing() {
    stopped=false;
    if(saved?.hostToken){connect();return status();}
    const result=await exchange('/start',{method:'POST'});
    if(!CODE.test(String(result.code||'')) || typeof result.pollToken!=='string' ||
        result.pollToken.length<30 || Number(result.expiresIn)!==600)throw Error('LINK_PAIR_RESPONSE_INVALID');
    const until=Date.now()+600000;
    persist({pending:{code:result.code,pollToken:result.pollToken,until}});
    report('AWAITING_ACCOUNT_APPROVAL');
    arm(()=>{void poll().catch(e=>{report('PAIRING_ERROR',String(e.message).slice(0,130));arm(()=>void poll().catch(()=>{}),RETRY_MS);});},2500);
    return status();
  }
  async function poll() {
    if(!saved?.pending || stopped)return;
    if(saved.pending.until<Date.now()){persist({});report('PAIRING_EXPIRED');return;}
    try{
      const p=saved.pending;
      const r=await exchange('/poll?code='+encodeURIComponent(p.code),{
        headers:{authorization:'Bearer '+p.pollToken},
      });
      if(r.state==='APPROVED') {
        if(!validHostToken(r.hostToken))throw Error('LINK_HOST_TICKET_INVALID');
        persist({hostToken:r.hostToken,deviceId:p.code});
        report('CONNECTING');connect();return;
      }
      if(r.state!=='PENDING')throw Error('LINK_PAIR_STATE_INVALID');
      arm(()=>void poll(),3000);
    }catch(e){
      if(/PAIR_EXPIRED|PAIR_ALREADY_DELIVERED|PAIRING_CREDENTIALS_REQUIRED/.test(e.message)){
        report('PAIRING_EXPIRED',e.message);return;
      }
      report('PAIRING_RETRY',String(e.message).slice(0,130));
      arm(()=>void poll(),RETRY_MS);
    }
  }
  async function respond(id,request) {
    pendingCalls++;
    try{
      const method=request.method;
      const url=localBaseUrl.replace(/\/$/,'')+request.path;
      const options={method,redirect:'error',headers:{'accept':'application/json'}};
      if(method==='POST'){options.headers['content-type']='application/json';options.body=json(request.body||{});}
      const r=await fetchImpl(url,{...options,signal:AbortSignal.timeout(method==='GET'?15000:90000)});
      const text=await r.text();
      let body;
      if(text.length>MAX_RESPONSE_BYTES)body={error:'LOCAL_RESPONSE_TOO_LARGE'};
      else try{body=JSON.parse(text);}catch{body={error:'LOCAL_RESPONSE_INVALID_JSON'};}
      socket?.readyState===1 && socket.send(json({
        type:'rpc_result',id,status:text.length>MAX_RESPONSE_BYTES?502:r.status,body,
      }));
    }catch(e){
      socket?.readyState===1 && socket.send(json({
        type:'rpc_result',id,status:503,body:{
          error:request.method==='POST'?'LOCAL_RESULT_UNKNOWN':'LOCAL_SERVICE_UNAVAILABLE',
          // Never replay a mutation because of network uncertainty.
        },
      }));
    }finally{pendingCalls--;}
  }
  function connect() {
    if(stopped || !saved?.hostToken)return;
    if(socket && (socket.readyState===0 || socket.readyState===1))return;
    report('CONNECTING');
    const url=origin.replace(/^https:/,'wss:')+'/link/ws?role=host';
    const candidate=websocketFactory(url,{headers:{authorization:'Bearer '+saved.hostToken},handshakeTimeout:10000});
    socket=candidate;
    candidate.on('open',()=>{if(socket===candidate)report('CONNECTED');});
    candidate.on('message',raw=>{
      if(socket!==candidate)return;
      if(raw.length>64*1024)return;
      let payload;
      try {payload=JSON.parse(raw.toString());}catch{return;}
      const valid=validateRemoteCall(payload);
      if(!valid.ok){
        if(typeof payload?.id==='string')candidate.send(json({type:'rpc_result',id:payload.id,status:403,body:{error:valid.error}}));
        return;
      }
      void respond(valid.id,valid);
    });
    candidate.on('error',err=>{if(socket===candidate)report('RECONNECTING',String(err.message||err).slice(0,120));});
    candidate.on('unexpected-response',(_req,response)=>{
      if(response.statusCode===401||response.statusCode===403) {
        report('AUTH_REQUIRED','Device credential expired or revoked');
        stopped=true;
      }
      response.resume();
    });
    candidate.on('close',(code)=>{
      if(socket!==candidate)return;
      socket=null;
      if(code===4003){stopped=true;report('REVOKED','Device revoked');return;}
      if(!stopped){report('RECONNECTING');arm(connect,RETRY_MS);}
    });
  }
  function resume(){
    stopped=false;
    if(saved?.hostToken){connect();return;}
    if(saved?.pending?.until>Date.now()) {report('AWAITING_ACCOUNT_APPROVAL');arm(()=>void poll(),1200);}
    else report('NOT_PAIRED');
  }
  function stop(){stopped=true;if(timer)cancel(timer);timer=null;socket?.close(1000,'Stopped locally');socket=null;report('STOPPED');}
  function forgetLocal(){stop();persist({});report('NOT_PAIRED');}
  return {startPairing,resume,stop,forgetLocal,status,connect};
}
