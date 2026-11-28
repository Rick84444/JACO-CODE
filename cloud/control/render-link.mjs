import {JacoLinkPairing,JacoLinkRoom} from '../../site/jacocode.com/link.mjs';
import {createLinkStorage,createRpcAdmission} from './render-store.mjs';
// Adapt the existing room/pairing implementation. One active Render process
// holds the database lease; the caller must terminate on lease loss.
export function createRenderLink(pool,key){
  const storage=createLinkStorage(pool,key),rooms=new Map(),queues=new Map();
  function serial(id,fn){
    const previous=queues.get(id)||Promise.resolve();
    const run=previous.catch(()=>{}).then(fn);
    queues.set(id,run);
    run.finally(()=>{if(queues.get(id)===run)queues.delete(id);}).catch(()=>{});
    return run;
  }
  function room(id){
    if(rooms.has(id))return rooms.get(id);
    if(rooms.size>=10000)throw Error('LINK_ROOM_LIMIT');
    const sockets=new Set(),rpc=createRpcAdmission(pool,id);
    let ctx;
    const value={sockets,touched:Date.now(),get handler(){return handler;},accept(ws,attachment){
      let current=attachment;
      ws.deserializeAttachment=()=>current;
      ws.serializeAttachment=next=>{current=next;};
      // The HTTP upgrade was authorized earlier. A device may have been
      // revoked before this socket was actually accepted. Serialize one final
      // durable revocation check with all account operations before admitting
      // a host or processing its messages. Database errors fail closed.
      if(attachment.role==='host'){
        serial(id,async()=>{
          if(await storage(id).get('revoked:'+attachment.deviceId)){
            ws.close(4003,'Device revoked');
            return;
          }
          if(ws.readyState!==1)return;
          for(const prior of sockets){
            const a=prior.deserializeAttachment?.();
            if(a?.role==='host'&&a.deviceId===attachment.deviceId)prior.close(4001,'Host replaced');
          }
          sockets.add(ws);
        }).catch(()=>ws.close(1011,'Host admission failed'));
      }else sockets.add(ws);
      ws.on('message',(data,binary)=>{if(binary){ws.close(1003,'Text required');return;}
        serial(id,()=>{
          if(!sockets.has(ws)){ws.close(4003,'Host not admitted');return;}
          return handler.webSocketMessage(ws,data.toString('utf8'));
        }).catch(()=>ws.close(1011,'Link error'));
      });
      ws.on('close',()=>{sockets.delete(ws);serial(id,()=>handler.webSocketClose(ws)).catch(()=>{});});
      ws.on('error',()=>{sockets.delete(ws);serial(id,()=>handler.webSocketError(ws)).catch(()=>{});});
    }};
    ctx={storage:storage(id),getWebSockets:()=>[...sockets].filter(s=>s.readyState===1),
      upgrade:attachment=>({jacoUpgrade:true,room:value,attachment}),
      reserveRpc:(device,request)=>rpc.reserve(device,request),
      recordRpcResponse:(device,request,status)=>rpc.response(device,request,status)};
    const handler=new JacoLinkRoom(ctx);rooms.set(id,value);return value;
  }
  function binding(isRoom){return {idFromName:name=>name,get:id=>({fetch(input,init){
    const req=input instanceof Request?input:new Request(input,init);
    return serial(id,async()=>{
      if(isRoom){const r=room(id);r.touched=Date.now();return r.handler.fetch(req);}
      // All access to one pairing/quota namespace is serialized; each write is durable.
      return new JacoLinkPairing({storage:storage(id)}).fetch(req);
    });
  }})};}
  const cleanup=setInterval(()=>{
    for(const [id,r] of rooms)if(!r.sockets.size&&!queues.has(id)&&Date.now()-r.touched>600000)rooms.delete(id);
    pool.query('DELETE FROM jaco_link_kv WHERE expires_at<now()').catch(()=>{});
  },60000);cleanup.unref();
  return {LINK_PAIRINGS:binding(false),LINK_ROOMS:binding(true),close(){clearInterval(cleanup);for(const r of rooms.values())for(const ws of r.sockets)ws.close(1001,'Service restarting');}};
}
