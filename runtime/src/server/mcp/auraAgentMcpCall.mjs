// The single Aura chat uses the existing MCP host and policy authority.
// Discovery may start an already configured server, but never executes a tool.
import { agentRefusal, isReadOnlyTool } from './stdioMcpHost.mjs';
import { operatorApprovalCheck } from '../../../../agents/lib/operator-action-guard.mjs';

const SERVER = /^[a-z][a-z0-9-]{1,40}$/;
const TOOL = /^[A-Za-z0-9_.-]{1,120}$/;

function configured(host, server) {
  if (!SERVER.test(server)) throw Error('MCP_SERVER_ID_INVALID');
  const def = host.servers()[server];
  if (!def || def.validationError) throw Error('MCP_SERVER_UNAVAILABLE');
  if (def.agentAccess === 'off') throw Error('MCP_AGENT_ACCESS_OFF');
  return def;
}
export async function discoverAuraMcpTools(host, server) {
  const def = configured(host, server);
  const tools = await host.listTools(server);
  return {
    server, access: def.agentAccess,
    // Discovery does not imply readiness to act or permission for a particular input.
    tools: tools.slice(0, 150).map(tool => ({
      name: tool.name, description: String(tool.description || '').slice(0, 500),
      readOnly: isReadOnlyTool(server, tool), denied: def.deny?.includes(tool.name) === true
    }))
  };
}
export async function callAuraMcpTool(host, { server, tool, args = {}, mode = 'read' } = {}) {
  const def = configured(host, server);
  if (!TOOL.test(tool)) throw Error('MCP_TOOL_ID_INVALID');
  if (mode !== 'read' && mode !== 'write') throw Error('MCP_MODE_INVALID');
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('MCP_ARGUMENTS_INVALID');
  if (def.deny?.includes(tool)) throw Error('MCP_TOOL_DENIED');
  // This starts a configured but stopped server; status READY is not a
  // prerequisite. Never start an "off" server or widen its access level.
  const tools = await host.listTools(server);
  const advertised = tools.find(item => item.name === tool);
  if (!advertised) throw Error('MCP_TOOL_UNAVAILABLE');
  const refusal = agentRefusal(def, advertised, args);
  if (refusal) throw Error(refusal);
  const readOnly = isReadOnlyTool(server, advertised);
  if (mode === 'read' && !readOnly) throw Error('MCP_TOOL_WRITE_MODE_REQUIRED');
  if (mode === 'write' && !readOnly) {
    // In action chat there is no mission-scoped approval packet. High-impact
    // actions must go through the existing mission route, which can request
    // operator authorization; scoped workspace writes remain autonomous.
    const required = operatorApprovalCheck({type:'mcp-write',data:{server,tool}});
    if (required) throw Error('MCP_MISSION_APPROVAL_REQUIRED');
  }
  return host.call(server, tool, args, { actor:'agent', readOnly: mode === 'read' });
}
