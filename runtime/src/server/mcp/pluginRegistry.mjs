// Public directory metadata only; never install, contact a listed host or pass credentials.
const REGISTRY='https://registry.modelcontextprotocol.io/v0.1/servers';
const MAX=1024*1024;
const plain=(v,n)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,n):'';
export async function searchPluginRegistry(query,{fetchImpl=fetch}={}){
  if(typeof query!=='string'||query.trim().length<3||query.trim().length>100||/[\u0000-\u001f\u007f]/.test(query))throw Error('PLUGIN_REGISTRY_QUERY_INVALID');
  const url=new URL(REGISTRY);
  url.search=new URLSearchParams({search:query.trim(),version:'latest',limit:'20'}).toString();
  let response;
  try{response=await fetchImpl(url.href,{method:'GET',headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10000)});}
  catch{throw Error('PLUGIN_REGISTRY_UNAVAILABLE');}
  if(!response.ok)throw Error('PLUGIN_REGISTRY_HTTP_'+response.status);
  const reader=response.body?.getReader();
  if(!reader)throw Error('PLUGIN_REGISTRY_INVALID_RESPONSE');
  const chunks=[];let size=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX)throw Error('PLUGIN_REGISTRY_RESPONSE_LIMIT');chunks.push(Buffer.from(value));}
  }finally{await reader.cancel().catch(()=>{});}
  let data;
  try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('PLUGIN_REGISTRY_INVALID_RESPONSE');}
  if(!Array.isArray(data.servers))throw Error('PLUGIN_REGISTRY_INVALID_RESPONSE');
  const entries=[];
  for(const row of data.servers.slice(0,20)){
    const server=row?.server,meta=row?._meta?.['io.modelcontextprotocol.registry/official'];
    if(meta?.status!=='active'||meta.isLatest!==true||typeof server?.name!=='string'||!server.name||typeof server.version!=='string')continue;
    entries.push({name:plain(server.name,200),title:plain(server.title,120),description:plain(server.description,300),version:plain(server.version,80),
      transports:[...new Set((Array.isArray(server.remotes)?server.remotes:[]).map(r=>r?.type).filter(t=>['streamable-http','sse'].includes(t)))],
      packaged:Array.isArray(server.packages)&&server.packages.length>0,state:'DISCOVERED_NOT_VERIFIED'});
  }
  return {source:REGISTRY,observedAt:new Date().toISOString(),entries,hasMore:typeof data.metadata?.nextCursor==='string'&&Boolean(data.metadata.nextCursor),note:'Registry listing only; publisher safety, cost, authentication and runtime execution are unverified.'};
}
