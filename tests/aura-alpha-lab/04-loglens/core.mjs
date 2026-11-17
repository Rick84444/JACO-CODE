export function logs(text){
  text=String(text);if(text.length>500000)throw Error('Input too large');
  const rows=text.split(/\r?\n/).filter(l=>l.trim()).map((l,i)=>{const m=l.match(/(?:^|\s|\[)(ERROR|WARN(?:ING)?|INFO|DEBUG)(?=\s|\]|:|$)/i);return {line:i+1,level:m?m[1].toUpperCase().replace('WARNING','WARN'):'OTHER',message:l.slice(0,500)};});
  const counts={ERROR:0,WARN:0,INFO:0,DEBUG:0,OTHER:0};for(const row of rows)counts[row.level]++;return {counts,rows};
}
