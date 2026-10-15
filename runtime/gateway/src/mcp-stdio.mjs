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
void workplace.start();
void serveStdio(() => buildJacoMcpServer({ core, system, modelId: config.modelId, workplace }));
console.error('[JACO MCP] stdio ready; protocol negotiation is owned by official MCP SDK v2');
