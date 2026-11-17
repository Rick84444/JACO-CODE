export function quote(lines,discount=0,vat=25){
  if(!Number.isInteger(discount)||discount<0||discount>100||![0,6,12,25].includes(vat))throw Error('Invalid rate');
  let net=0;for(const item of lines){if(!Number.isSafeInteger(item.unitOre)||item.unitOre<0||item.unitOre>100000000||!Number.isSafeInteger(item.qty)||item.qty<1||item.qty>10000)throw Error('Invalid line');net+=item.qty*item.unitOre;if(!Number.isSafeInteger(net)||net>1000000000000)throw Error('Quote too large');}
  const rebate=Math.round(net*discount/100),taxable=net-rebate,tax=Math.round(taxable*vat/100);return {net,rebate,taxable,tax,total:taxable+tax};
}
