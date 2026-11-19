// One local transport, one in-flight request, never retry a dispatched mutation.
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const MUTATING=new Set(['mouse_move','mouse_click','mouse_scroll','key_press','type_text']);
const OPS=new Set([...MUTATING,'get_cursor','screenshot','self_test']);
const MAX=64*1024;
export function createInputBridgeDaemon(scriptPath,{spawnImpl=spawn,platform=process.platform}={}){
  let child=null,pending=null,closed=false,queue=Promise.resolve(),queued=0;
  const fail=(error,unknown=false)=>({ok:false,verified:false,error,outcomeUnknown:unknown});
  function settle(p,result){if(pending!==p)return;pending=null;clearTimeout(p.timer);p.resolve(result);}
  function invalidate(c,reason){
    if(child!==c)return;
    child=null;
    const p=pending;
    if(p?.child===c)settle(p,fail(reason,p.mutating));
    // Stop admission if the old worker cannot be confirmed dead. No new
    // concurrent input worker may start after a timeout or protocol failure.
    closed=true;
    try{c.kill();}catch{}
  }
  function start(){
    if(child)return child;
    const c=spawnImpl('powershell',['-NoProfile','-NonInteractive','-File',scriptPath,'-Daemon'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    child=c;let buffer='';
    c.stdout.setEncoding('utf8');
    c.stdout.on('data',chunk=>{
      if(child!==c)return;
      buffer+=chunk;
      if(buffer.length>MAX){invalidate(c,'BRIDGE_FRAME_TOO_LARGE');return;}
      let i;
      while((i=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);
        let value;try{value=JSON.parse(line);}catch{invalidate(c,'BRIDGE_INVALID_JSON');return;}
        const p=pending;
        if(!p||p.child!==c||value?.reqId!==p.reqId||typeof value.ok!=='boolean'||typeof value.verified!=='boolean'){
          invalidate(c,'BRIDGE_INVALID_RESPONSE');return;
        }
        const {reqId,...receipt}=value;
        settle(p,{...receipt,verified:receipt.ok===true&&receipt.verified===true,outcomeUnknown:receipt.outcomeUnknown===true||(p.mutating&&receipt.ok!==true&&receipt.outcomeUnknown!==false)});
      }
    });
    c.stderr.on('data',()=>{}); // drain; never log potentially sensitive input
    c.on('error',()=>invalidate(c,'BRIDGE_PROCESS_ERROR'));
    c.on('exit',()=>invalidate(c,'BRIDGE_EXITED'));
    c.stdin.on('error',()=>invalidate(c,'BRIDGE_WRITE_FAILED'));
    return c;
  }
  function send(payload,timeoutMs=10000){
    if(platform!=='win32'||closed)return Promise.resolve(fail('BRIDGE_UNAVAILABLE'));
    if(!payload||!OPS.has(payload.op)||queued>=8)return Promise.resolve(fail('BRIDGE_REQUEST_REFUSED'));
    const deadline=Date.now()+Math.max(100,Math.min(30000,Number(timeoutMs)||10000));
    let body;try{body=JSON.stringify({...payload,DeadlineMs:deadline,reqId:randomUUID()});}catch{return Promise.resolve(fail('BRIDGE_INVALID_REQUEST'));}
    if(body.length>MAX)return Promise.resolve(fail('BRIDGE_REQUEST_TOO_LARGE'));
    const reqId=JSON.parse(body).reqId;
    queued++;
    const run=()=>new Promise(resolve=>{
      if(closed||Date.now()>=deadline){resolve(fail('BRIDGE_NOT_DISPATCHED'));return;}
      let c;try{c=start();}catch{resolve(fail('BRIDGE_START_FAILED'));return;}
      const p={child:c,reqId,resolve,mutating:MUTATING.has(payload.op)};
      pending=p;p.timer=setTimeout(()=>invalidate(c,'BRIDGE_TIMEOUT'),Math.max(1,deadline-Date.now()));
      try{c.stdin.write(body+'\n');}catch{invalidate(c,'BRIDGE_WRITE_FAILED');}
    });
    const next=queue.then(run,run).finally(()=>queued--);queue=next.catch(()=>{});return next;
  }
  return {send,close(){closed=true;if(child)invalidate(child,'BRIDGE_CLOSED');}};
}
