import { homedir } from 'node:os';
import { join } from 'node:path';

function int(name, fallback) {
  const v = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) ? v : fallback;
}

export const config = Object.freeze({
  gatewayHost: process.env.JACO_GATEWAY_HOST || '127.0.0.1',
  gatewayPort: int('JACO_GATEWAY_PORT', 2999),
  gatewayMode: process.env.JACO_GATEWAY_MODE || 'loopback',
  allowedHosts: (process.env.JACO_ALLOWED_HOSTS || '127.0.0.1,localhost,[::1]')
    .split(',').map(s => s.trim()).filter(Boolean),
  coreBaseUrl: (process.env.JACO_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, ''),
  coreToken: process.env.JACO_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || '',
  mcpBearer: process.env.JACO_MCP_BEARER || '',
  modelId: process.env.JACO_MODEL_ID || 'jaco-mcp-client',
  allowMcpActivation: process.env.JACO_MCP_ALLOW_ACTIVATION === '1',
  // A remote update changes the checkout and restarts the runtime. Keep this
  // separate from activation so an MCP client cannot gain Git update rights
  // merely because it may start an already-installed runtime.
  allowMcpUpdate: process.env.JACO_MCP_ALLOW_UPDATE === '1',
  githubBootstrapEnabled: process.env.JACO_GITHUB_BOOTSTRAP_ENABLE === '1',
  githubBootstrapRepo: process.env.JACO_GITHUB_BOOTSTRAP_REPO || process.env.JACO_GITHUB_CONTROL_REPO || 'Rick84444/jaco-code',
  githubBootstrapToken: process.env.JACO_GITHUB_BOOTSTRAP_TOKEN || process.env.JACO_GITHUB_CONTROL_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '',
  githubBootstrapActor: process.env.JACO_GITHUB_BOOTSTRAP_ACTOR || process.env.JACO_GITHUB_CONTROL_ACTOR || 'Rick84444',
  githubBootstrapPollMs: int('JACO_GITHUB_BOOTSTRAP_POLL_MS', 15000),
  requestTimeoutMs: int('JACO_GATEWAY_TIMEOUT_MS', 30000),
  jacoctl: process.env.JACOCTL_PATH || join(homedir(), '.local', 'bin', 'jacoctl')
});
