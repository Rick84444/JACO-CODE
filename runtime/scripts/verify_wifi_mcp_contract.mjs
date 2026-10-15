import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict';
const root=process.cwd(); const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const ps=read('scripts/windows/bootstrap-jaco-autonomous.ps1');
const sh=read('termux/bootstrap-jaco-autonomous.sh');
const wp=read('scripts/windows/start-jaco-wifi-mcp.ps1');
const ts=read('termux/start-jaco-wifi-mcp.sh');
for(const src of [ps,sh]){
  assert.match(src,/JACO_GATEWAY_HOST/); assert.match(src,/0\.0\.0\.0/); assert.match(src,/JACO_GATEWAY_MODE/); assert.match(src,/lan/); assert.match(src,/JACO_MCP_BEARER/); assert.match(src,/127\.0\.0\.1/); assert.match(src,/2999/);
}
assert.match(wp,/bootstrap-jaco-autonomous\.ps1/); assert.match(ts,/bootstrap-jaco-autonomous\.sh/);
assert.doesNotMatch(wp,/npm run dev/); assert.doesNotMatch(ts,/npm run dev/);
console.log('PASS Wi-Fi MCP contract: Windows/Termux use autonomous bootstrap, Core remains loopback, Sentinel is bearer-protected LAN surface, no duplicate Core start');
