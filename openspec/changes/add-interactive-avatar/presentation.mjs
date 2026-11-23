// Connection-local presentation cursor. Initial and reconnect snapshots are silent.
export function advancePresentation(previous, ids, connected, capacity=2048) {
 if (!Number.isSafeInteger(capacity)||capacity<1) throw new RangeError('capacity');
 const valid=[...new Set(ids.filter(x=>typeof x==='string'&&x.length>0&&x.length<=256))];
 const seen=new Set(previous?.seen??[]);
 const fresh=connected&&previous?.connected ? valid.filter(x=>!seen.has(x)):[];
 for(const id of valid) seen.add(id);
 return {connected,seen:[...seen].slice(-capacity),fresh};
}
