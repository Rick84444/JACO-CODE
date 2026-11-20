import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The Termux/Linux install has a jacoctl wrapper in ~/.local/bin. Windows has none: there the canonical
// control CLI is this checkout's agents/jaco-cli.mjs (the same one sentinel-windows.mjs uses). Picking the
// missing wrapper made every MCP status/activate call fail with ENOENT.
export function defaultJacoctl({ env = process.env, platform = process.platform, home = homedir(), exists = existsSync,
  repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..') } = {}) {
  if (env.JACOCTL_PATH) return env.JACOCTL_PATH;
  const wrapper = join(home, '.local', 'bin', 'jacoctl');
  const cli = join(repoRoot, 'agents', 'jaco-cli.mjs');
  if (platform === 'win32' && exists(cli)) return cli;
  if (exists(wrapper) || !exists(cli)) return wrapper;
  return cli;
}

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
  githubBootstrapRepo: process.env.JACO_GITHUB_BOOTSTRAP_REPO || process.env.JACO_GITHUB_CONTROL_REPO || '',
  githubBootstrapToken: process.env.JACO_GITHUB_BOOTSTRAP_TOKEN || process.env.JACO_GITHUB_CONTROL_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '',
  githubBootstrapActor: process.env.JACO_GITHUB_BOOTSTRAP_ACTOR || process.env.JACO_GITHUB_CONTROL_ACTOR ||
    (process.env.JACO_GITHUB_BOOTSTRAP_REPO || process.env.JACO_GITHUB_CONTROL_REPO || '').split('/')[0],
  githubBootstrapPollMs: int('JACO_GITHUB_BOOTSTRAP_POLL_MS', 15000),
  requestTimeoutMs: int('JACO_GATEWAY_TIMEOUT_MS', 30000),
  jacoctl: defaultJacoctl()
});
