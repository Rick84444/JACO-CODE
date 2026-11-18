// Synthetic discrete-event experiment. No production runtime invoked.
export function experiment(seed=42, trials=1000){
 if(!Number.isSafeInteger(trials)||trials<1) throw new RangeError('trials');
 let state=seed>>>0; const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296};
 const result={trials,deliveries:0,baselineDuplicates:0,deduplicatedDuplicates:0,missed:0};
 for(let i=0;i<trials;i++){
  const seen=new Set(); const expected=new Set();
  for(let j=0;j<20;j++){
   const id=`${i}:${j}`;expected.add(id);const copies=1+(random()<.25?1:0)+(random()<.1?1:0);
   for(let k=0;k<copies;k++){result.deliveries++; if(k>0)result.baselineDuplicates++;if(seen.has(id))continue; seen.add(id);}
  }
  result.missed+=expected.size-seen.size;
 }
 return result;
}
