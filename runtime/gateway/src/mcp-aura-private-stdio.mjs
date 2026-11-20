#!/usr/bin/env node
// Explicit local operator enablement is required for a private mission tunnel.
if(process.env.JACO_MCP_ALLOW_AURA_MISSIONS!=='1')throw Error('JACO_PRIVATE_AURA_BRIDGE_DISABLED');
process.env.JACO_MCP_TOOL_PROFILE='aura-private';
await import('./mcp-stdio.mjs');
