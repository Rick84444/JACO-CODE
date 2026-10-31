import { McpServer } from '@modelcontextprotocol/server';
import { createToolRegistry } from './tool-registry.mjs';

// Dedicated profiles for external/private ChatGPT MCP connections. The legacy
// full catalog remains available to existing local JACO clients only when
// explicitly selected or when no external profile has been configured.
export const JACO_MCP_COGNITIVE_READ = Object.freeze([
  'jaco_identity', 'jaco_system_health', 'jaco_cognitive_context', 'jaco_knowledge_search',
]);
export const JACO_MCP_COGNITIVE_COLLABORATE = Object.freeze([
  ...JACO_MCP_COGNITIVE_READ, 'jaco_workplace_status', 'jaco_workplace_post',
  'jaco_knowledge_note',
]);
export function selectJacoMcpTools(registry, profile = process.env.JACO_MCP_TOOL_PROFILE || 'full') {
  if(profile === 'full') return registry;
  if(profile !== 'cognitive-read' && profile !== 'cognitive-collaborate')
    throw new Error('JACO_MCP_TOOL_PROFILE_INVALID');
  const allowed = profile === 'cognitive-read'
    ? JACO_MCP_COGNITIVE_READ : JACO_MCP_COGNITIVE_COLLABORATE;
  const byName = new Map(registry.map(tool => [tool.name, tool]));
  const result = allowed.map(name => byName.get(name));
  if(result.some(tool => !tool)) throw new Error('JACO_MCP_COGNITIVE_PROFILE_INCOMPLETE');
  return result;
}

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
  for (const tool of selectJacoMcpTools(createToolRegistry(context), context.profile)) {
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
