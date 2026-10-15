import { spawn } from 'node:child_process';
const server = spawn(process.execPath, ['tools/jaco-mcp-server.mjs'], { stdio: ['pipe','pipe','inherit'] });
const replies=[]; let buf='';
server.stdout.on('data', d => { buf += d; let i; while ((i=buf.indexOf('\n'))>=0) { const line=buf.slice(0,i).trim(); buf=buf.slice(i+1); if(line) replies.push(JSON.parse(line)); }});
const send=o=>server.stdin.write(JSON.stringify(o)+'\n'); const wait=ms=>new Promise(r=>setTimeout(r,ms));
send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05'}});
send({jsonrpc:'2.0',id:2,method:'tools/list'}); send({jsonrpc:'2.0',id:3,method:'ping'}); await wait(500); server.kill();
const by=id=>replies.find(x=>x.id===id); const checks=[
 ['identity',by(1)?.result?.serverInfo?.name==='jaco-autonomus-ide'],
 ['protocol',by(1)?.result?.protocolVersion==='2024-11-05'],
 ['semantic tools',by(2)?.result?.tools?.length===10],
 ['no raw evaluate',!by(2)?.result?.tools?.some(t=>/evaluate|javascript|shell/i.test(t.name+' '+t.description))],
 ['ping',!!by(3)?.result],
];
for(const [n,c] of checks) console.log(`${c?'PASS':'FAIL'} ${n}`); if(checks.some(([,c])=>!c)) process.exit(1);
