import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  StdioMcpHost,
  classifyMcpChildExit,
  isOneShotSellerScript,
  validateServerEntry,
  agentRefusal,
} from '../../runtime/src/server/mcp/stdioMcpHost.mjs';
import { HttpMcpClient, classifyMcpNetworkError } from '../../runtime/src/server/mcp/httpMcpClient.mjs';
import { remedyFor } from '../../runtime/src/server/connected/automaticConnections.mjs';
import { classifyToolFailure } from '../../agents/lib/tool-failure-diagnosis.mjs';

test('seller registration task is not installed as an MCP server', async t => {
  assert.equal(isOneShotSellerScript('node', ['tools/create-skyfire-seller-service.mjs']), true);
  assert.equal(isOneShotSellerScript('node', ['C:\\JACO\\tools\\create-skyfire-seller-service.mjs']), true);
  assert.equal(isOneShotSellerScript('node', ['runtime/tools/jaco-git-mcp.mjs']), false);
  assert.throws(() => validateServerEntry('skyfire', {
    command: process.execPath, args: ['tools/create-skyfire-seller-service.mjs'], agentAccess: 'write',
  }), /MCP_ONE_SHOT_NOT_MCP_SERVER/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-one-shot-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const configFile = path.join(dir, 'servers.json');
  fs.writeFileSync(configFile, JSON.stringify({ servers: {
    skyfire: { command: process.execPath, args: ['tools/create-skyfire-seller-service.mjs'], agentAccess: 'write' },
  } }));
  const host = new StdioMcpHost({ configFile, repoRoot: dir, runtimeRoot: dir });
  assert.equal(host.status().find(s => s.id === 'skyfire')?.error, 'MCP_ONE_SHOT_NOT_MCP_SERVER');
  await assert.rejects(() => host.start('skyfire'), /MCP_ONE_SHOT_NOT_MCP_SERVER/);
  assert.equal(host.clients.has('skyfire'), false, 'no process and no API call was started');
});

test('MCP child failures use bounded codes without exposing stderr', () => {
  const privateStderr = 'token=operator-secret /home/private/agent MODULE_NOT_FOUND';
  assert.equal(classifyMcpChildExit(1, privateStderr, false), 'ENTRYPOINT_NOT_FOUND');
  assert.equal(classifyMcpChildExit(0, '', false), 'NO_MCP_HANDSHAKE');
  assert.equal(classifyMcpChildExit(2, privateStderr, true), 'EXIT_2');
  assert.equal(classifyToolFailure('MCP_SERVER_EXITED:skyfire:ENTRYPOINT_NOT_FOUND').kind, 'MCP_ENTRYPOINT_INVALID');
  assert.equal(classifyToolFailure('MCP_ONE_SHOT_NOT_MCP_SERVER').kind, 'MCP_ENTRYPOINT_INVALID');
  assert.equal(classifyToolFailure('MCP_SERVER_EXITED:skyfire:ENTRYPOINT_NOT_FOUND').restart, false);
});

test('HTTP MCP transport diagnostics are stable and do not disclose endpoint errors', async () => {
  const samples = [
    ['ENOTFOUND', 'MCP_TRANSPORT_DNS'],
    ['ECONNREFUSED', 'MCP_TRANSPORT_UNREACHABLE'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'MCP_TRANSPORT_TLS'],
    ['ETIMEDOUT', 'MCP_TRANSPORT_TIMEOUT'],
  ];
  for (const [code, expected] of samples) {
    const error = new Error('fetch failed: private-service.local');
    error.cause = Object.assign(new Error('private credential and host'), { code });
    assert.equal(classifyMcpNetworkError(error), expected);
    const client = new HttpMcpClient('remote', { url: 'https://example.test/mcp' }, {
      env: {}, fetchImpl: async () => { throw error; },
    });
    await assert.rejects(client.start(), new RegExp(expected));
    assert.equal(client.error, expected);
    assert.doesNotMatch(client.error, /private-service|credential/);
  }
  assert.equal(classifyMcpNetworkError(Error('SENSITIVE DATA')), 'MCP_CONNECTION_FAILED');
  assert.equal(classifyToolFailure('MCP_TRANSPORT_TLS').kind, 'MCP_REMOTE_UNREACHABLE');
  assert.equal(classifyToolFailure('MCP_TRANSPORT_TIMEOUT').kind, 'TIMEOUT');
  assert.match(remedyFor('MCP_TRANSPORT_DNS'), /DNS/);
  assert.match(remedyFor('MCP_ONE_SHOT_NOT_MCP_SERVER'), /not an MCP server/);
});

test('read and write tools retain the local policy boundary', () => {
  const readTool = { name: 'observe', readOnly: true };
  const writeTool = { name: 'change', readOnly: false };
  const local = { id: 'fixture', agentAccess: 'write', transport: 'stdio', deny: [] };
  assert.equal(agentRefusal(local, readTool), null);
  assert.equal(agentRefusal(local, writeTool), null, 'write-enabled local MCP server may expose changing tools to a permitted mission');
  assert.equal(agentRefusal({ ...local, agentAccess: 'read' }, writeTool), 'MCP_TOOL_NOT_READ_ONLY');
  assert.equal(agentRefusal({ ...local, transport: 'http' }, writeTool), 'MCP_REMOTE_WRITE_REQUIRES_AUTHORITY');
  assert.equal(agentRefusal({ ...local, deny: ['change'] }, writeTool), 'MCP_TOOL_DENIED');
});
