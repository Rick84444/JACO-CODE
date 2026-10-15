#!/usr/bin/env node
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { config } from './config.mjs';
import { JacoCoreClient } from './jaco-client.mjs';
import { SystemControl } from './system-control.mjs';
import { createGithubBootstrapControl } from './github-bootstrap-control.mjs';
import { buildJacoMcpServer } from './mcp-factory.mjs';
import { bearerAllowed, hostAllowed, originAllowed, readJson, writeJson } from './security.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const uiPath = join(here, '..', 'public', 'index.html');
const uiNonce = randomBytes(24).toString('base64url');
const core = new JacoCoreClient({ baseUrl: config.coreBaseUrl, token: config.coreToken, modelId: config.modelId, timeoutMs: config.requestTimeoutMs });
const system = new SystemControl({
  jacoctl: config.jacoctl,
  allowMcpActivation: config.allowMcpActivation,
  allowMcpUpdate: config.allowMcpUpdate,
  core,
});
const githubBootstrap = createGithubBootstrapControl({
  system,
  enabled: config.githubBootstrapEnabled,
  repo: config.githubBootstrapRepo,
  token: config.githubBootstrapToken,
  actor: config.githubBootstrapActor,
  pollMs: config.githubBootstrapPollMs,
});
const mcp = createMcpHandler(() => buildJacoMcpServer({ core, system, modelId: config.modelId }));
const mcpNodeHandler = toNodeHandler(mcp);

if (config.gatewayMode !== 'loopback' && !config.mcpBearer) {
  throw new Error('JACO_GATEWAY_MODE is not loopback but JACO_MCP_BEARER is empty; refusing unsafe remote-capable startup');
}
if (!['127.0.0.1', 'localhost', '::1'].includes(config.gatewayHost) && config.gatewayMode === 'loopback') {
  throw new Error('loopback mode requires JACO_GATEWAY_HOST=127.0.0.1/localhost/::1');
}

function sameLocalBoundary(req) {
  return hostAllowed(req, config.allowedHosts) && originAllowed(req, config);
}

function uiWriteAllowed(req) {
  return sameLocalBoundary(req) && String(req.headers['x-jaco-ui-nonce'] || '') === uiNonce;
}

async function coreHealth() {
  try {
    const identity = await core.identity();
    return { state: 'READY', identity };
  } catch (error) {
    return { state: 'UNAVAILABLE', error: error instanceof Error ? error.message : String(error) };
  }
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

    if (url.pathname === '/mcp') {
      if (!sameLocalBoundary(req)) return writeJson(res, 403, { error: 'LOCAL_BOUNDARY_REJECTED' });
      if (!bearerAllowed(req, config.mcpBearer)) return writeJson(res, 401, { error: 'MCP_AUTH_REQUIRED' }, { 'www-authenticate': 'Bearer' });
      return mcpNodeHandler(req, res);
    }

    if (!sameLocalBoundary(req)) return writeJson(res, 403, { error: 'LOCAL_BOUNDARY_REJECTED' });

    if (req.method === 'GET' && url.pathname === '/health') {
      return writeJson(res, 200, {
        product: 'JACO Autonomus IDE Sentinel',
        version: '0.22.0',
        status: 'READY',
        bind: `${config.gatewayHost}:${config.gatewayPort}`,
        mcp: { endpoint: '/mcp', sdk: '@modelcontextprotocol/server@2.0.0', protocol: 'negotiated by SDK' },
        githubBootstrap: githubBootstrap.status(),
        core: await coreHealth()
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/system/status') {
      return writeJson(res, 200, { success: true, status: await system.status(), core: await coreHealth() });
    }

    if (req.method === 'POST' && url.pathname === '/api/system/activate') {
      if (!uiWriteAllowed(req)) return writeJson(res, 403, { error: 'ACTIVATION_NONCE_REQUIRED' });
      const body = await readJson(req);
      const result = await system.activate(body.profile || 'full', { fromMcp: false });
      return writeJson(res, 200, { success: true, result, core: await coreHealth() });
    }

    if (req.method === 'POST' && url.pathname === '/api/system/deactivate') {
      if (!uiWriteAllowed(req)) return writeJson(res, 403, { error: 'ACTIVATION_NONCE_REQUIRED' });
      const result = await system.deactivateCore();
      return writeJson(res, 200, { success: true, result });
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/activate')) {
      let html = await readFile(uiPath, 'utf8');
      html = html.replaceAll('__JACO_UI_NONCE__', uiNonce);
      const data = Buffer.from(html);
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': String(data.length),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"
      });
      return res.end(data);
    }

    return writeJson(res, 404, { error: 'NOT_FOUND' });
  })().catch(error => {
    if (!res.headersSent) writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    else res.end();
  });
});

let githubBootstrapTimer = null;

server.listen(config.gatewayPort, config.gatewayHost, () => {
  console.error(`[JACO Sentinel] http://${config.gatewayHost}:${config.gatewayPort}`);
  console.error(`[JACO Sentinel] MCP endpoint http://${config.gatewayHost}:${config.gatewayPort}/mcp`);
  if (githubBootstrap.enabled) {
    console.error(`[JACO Sentinel] GitHub bootstrap enabled for ${githubBootstrap.repo}; actor=${githubBootstrap.actor}; poll=${githubBootstrap.pollMs}ms`);
    void githubBootstrap.pollOnce().catch(error => console.error('[JACO Sentinel] GitHub bootstrap poll failed:', error?.message || error));
    githubBootstrapTimer = setInterval(() => {
      void githubBootstrap.pollOnce().catch(error => console.error('[JACO Sentinel] GitHub bootstrap poll failed:', error?.message || error));
    }, githubBootstrap.pollMs);
    githubBootstrapTimer.unref?.();
  } else {
    console.error('[JACO Sentinel] GitHub bootstrap disabled (enable flag required)');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (githubBootstrapTimer) clearInterval(githubBootstrapTimer);
    server.close(() => process.exit(0));
  });
}
