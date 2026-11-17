export function plan(nodes){
  if(!Array.isArray(nodes)||nodes.length>100)throw Error('Maximum 100 tasks');const by=new Map();
  for(const n of nodes){if(typeof n.id!=='string'||!/^[a-zA-Z0-9_-]{1,40}$/.test(n.id)||by.has(n.id)||!Array.isArray(n.deps)||!Number.isSafeInteger(n.minutes)||n.minutes<1||n.minutes>100000)throw Error('Invalid task');by.set(n.id,n);}
  for(const n of nodes)for(const d of n.deps)if(!by.has(d))throw Error('Missing dependency: '+d);
  const order=[],finished=new Map(),ready=nodes.filter(n=>n.deps.length===0).map(n=>n.id);
  while(order.length<nodes.length){const next=nodes.find(n=>!finished.has(n.id)&&n.deps.every(d=>finished.has(d)));if(!next)throw Error('Dependency cycle');const start=Math.max(0,...next.deps.map(d=>finished.get(d)));finished.set(next.id,start+next.minutes);order.push({id:next.id,start,end:start+next.minutes});}
  return {order,ready,totalMinutes:Math.max(0,...finished.values())};
}
