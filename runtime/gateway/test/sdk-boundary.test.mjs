import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
// The SDK is pinned to an exact 2.x release (no range), so a dependency bump is a deliberate, reviewed change.
// The test no longer names one version: a routine bump of the pin must not break the gateway suite.
for(const [name,version] of [['@modelcontextprotocol/server',pkg.dependencies['@modelcontextprotocol/server']],['@modelcontextprotocol/node',pkg.dependencies['@modelcontextprotocol/node']],['@modelcontextprotocol/client',pkg.devDependencies['@modelcontextprotocol/client']]])
  assert.match(version,/^2\.\d+\.\d+$/,name+' must be an exact 2.x version');
const stdio=await readFile(join(root,'src','mcp-stdio.mjs'),'utf8');
const sentinel=await readFile(join(root,'src','sentinel.mjs'),'utf8');
const factory=await readFile(join(root,'src','mcp-factory.mjs'),'utf8');
const handlers=await readFile(join(root,'src','tool-handlers.mjs'),'utf8');
assert.match(stdio,/serveStdio/);
assert.match(sentinel,/createMcpHandler/);
assert.match(sentinel,/toNodeHandler/);
assert.match(sentinel,/allowMcpUpdate: config\.allowMcpUpdate/);
assert.match(factory,/McpServer/);
assert.doesNotMatch(stdio,/process\.stdin\.on|protocolVersion\s*=/);
assert.doesNotMatch(sentinel,/0\.0\.0\.0/);
assert.doesNotMatch(handlers,/Runtime\.evaluate|shell_exec|bash_shell|credential/i);
console.log('PASS SDK boundary: official MCP v2 package pins, no handwritten protocol loop, no raw execution tool');
