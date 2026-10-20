// Deterministic radial projection of observed relationships. Never schedules or invents agents.
export function layoutAgentNetwork(nodes, coordinatorId) {
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const depths=new Map();
  function depth(id, seen=new Set()) {
    if(depths.has(id)) return depths.get(id);
    if(seen.has(id) || seen.size>64) return 1;
    seen.add(id);
    const parent=byId.get(id)?.parentId;
    const value=id===coordinatorId ? 0 : parent && byId.has(parent) ? Math.min(12,depth(parent,seen)+1) : 1;
    depths.set(id,value);return value;
  }
  const layers=new Map();
  for(const node of nodes){const d=depth(node.id);if(!layers.has(d))layers.set(d,[]);layers.get(d).push(node);}
  let radius=0;
  const polar=new Map([[coordinatorId,{angle:0,radius:0}]]);
  for(const [level,items] of [...layers].sort((a,b)=>a[0]-b[0])) {
    if(level===0)continue;
    radius=Math.max(radius+190,items.length*132/(2*Math.PI));
    items.sort((a,b)=>String(a.parentId||'').localeCompare(String(b.parentId||''))||a.id.localeCompare(b.id));
    items.forEach((node,index)=>polar.set(node.id,{angle:-Math.PI/2+index*Math.PI*2/items.length,radius}));
  }
  const size=Math.max(760,Math.ceil(radius*2+260)),center=size/2;
  return {width:size,height:size,positions:Object.fromEntries(nodes.map(node=>{
    const p=polar.get(node.id)||{angle:0,radius:0};
    return [node.id,{x:center+Math.cos(p.angle)*p.radius,y:center+Math.sin(p.angle)*p.radius,depth:depths.get(node.id)||0}];
  }))};
}
