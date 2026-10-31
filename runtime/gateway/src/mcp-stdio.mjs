#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { config } from './config.mjs';
import { JacoCoreClient } from './jaco-client.mjs';
import { SystemControl } from './system-control.mjs';
import { buildJacoMcpServer } from './mcp-factory.mjs';
import { McpWorkplaceBridge } from '../../../gateway/src/workplace/mcp-client-bridge.mjs';

const core = new JacoCoreClient({ baseUrl: config.coreBaseUrl, token: config.coreToken, modelId: config.modelId, timeoutMs: config.requestTimeoutMs });
const system = new SystemControl({
  jacoctl: config.jacoctl,
  allowMcpActivation: config.allowMcpActivation,
  allowMcpUpdate: config.allowMcpUpdate,
  core,
});
const workplace = new McpWorkplaceBridge({ modelId: config.modelId });
const profile = process.env.JACO_MCP_TOOL_PROFILE || 'full';
// Read-only external connections do not start a Workplace bridge. The dedicated
// collaboration profile enables messaging but NOT mission creation or shell.
if (profile !== 'cognitive-read') void workplace.start();
void serveStdio(() => buildJacoMcpServer({ core, system, modelId: config.modelId, workplace, profile }));
console.error('[JACO MCP] stdio ready (tool profile: ' + profile + '); protocol negotiation is owned by official MCP SDK v2');
