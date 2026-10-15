import { McpServer } from '@modelcontextprotocol/server';
import { createToolRegistry } from './tool-registry.mjs';

function asResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value && typeof value === 'object' && !Array.isArray(value) ? value : { value }
  };
}

export function buildJacoMcpServer(context) {
  const server = new McpServer(
    { name: 'jaco-autonomus-ide', version: '0.22.0' },
    { capabilities: { tools: { listChanged: false } } }
  );
  for (const tool of createToolRegistry(context)) {
    server.registerTool(tool.name, tool.config, async args => {
      try { return asResult(await tool.handler(args)); }
      catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    });
  }
  return server;
}
