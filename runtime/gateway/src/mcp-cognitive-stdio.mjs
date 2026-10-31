#!/usr/bin/env node
// Hardened entrypoint for private ChatGPT/Codex tunnel clients.
// Never inherit the legacy full tool catalog, even if the caller has set it.
// Keep authentication and Continuum ownership in the existing stdio server.
process.env.JACO_MCP_TOOL_PROFILE = 'cognitive-read';
await import('./mcp-stdio.mjs');
