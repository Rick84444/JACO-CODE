export function inventory(items,action){
  const sku=String(action.sku||'').trim().toUpperCase();if(!/^[A-Z0-9-]{1,30}$/.test(sku))throw Error('Invalid SKU');
  const quantity=Number(action.quantity);if(!Number.isSafeInteger(quantity)||quantity<=0||quantity>1000000)throw Error('Invalid quantity');
  const copy=items.map(i=>({...i}));let item=copy.find(i=>i.sku===sku);
  if(action.type==='receive'){if(!item){const name=String(action.name||'').trim();if(!name||name.length>100)throw Error('Name required');item={sku,name,quantity:0};copy.push(item);}if(item.quantity+quantity>1000000)throw Error('Stock limit');item.quantity+=quantity;}
  else if(action.type==='issue'){if(!item||item.quantity<quantity)throw Error('Insufficient stock');item.quantity-=quantity;}
  else throw Error('Invalid movement');return copy;
}
