// JACO's MCP host (operator 2026-10-03: JACO is its own entity that connects tools and an LLM; the
// LLM is not JACO). JACO owns the tool connections: it starts stdio MCP servers, lists their tools and
// calls them for the IDE and for Nova, whichever model is planning.
//
// Servers come from built-in defaults plus an optional .jaco/mcp/servers.json:
//   { "servers": { "<id>": { "name": "...", "command": "npx", "args": [...], "env": { "NAME": "${ENV_NAME}" },
//                            "icon": "git", "agentAccess": "read" | "write" | "off", "deny": ["tool"], "enabled": true } } }
// A server starts on first use and is restarted on the next use after it exits. Secrets are referenced
// as ${ENV_NAME} and resolved from the runtime's environment; they are never written to the config.
//
// Agent access (operator 2026-10-09: agents need more than read-only tools, without being blocked at
// every step): 'read' lets agents run tools that declare readOnlyHint, 'write' also mutating tools, 'off'
// nothing. A server's deny list always wins, and agents never write protected paths (.env, .git,
// secrets, credentials, node_modules). Remote (http) servers stay read-only for agents.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { HttpMcpClient } from './httpMcpClient.mjs';

const PROTOCOL_VERSION = '2025-06-18';
// Tools that only read but do not declare readOnlyHint.
const KNOWN_READ_ONLY = { fetch: new Set(['fetch']) };
export const isReadOnlyTool = (server, tool) => Boolean(tool?.readOnly || KNOWN_READ_ONLY[server]?.has(tool?.name));
const ID = /^[a-z][a-z0-9-]{1,40}$/;
export const AGENT_ACCESS = ['off', 'read', 'write'];
// Logos the IDE ships (src/components/mcpLogos.ts); anything else shows the MCP logo.
export const ICONS = ['jaco', 'mcp', 'git', 'github', 'cloudflare', 'huggingface', 'nodejs'];
// Paths an agent may never write through a tool, whatever the server's access.
const PROTECTED_PATH = /(^|[\\/])(\.env(\.[^\\/]*)?|\.git|node_modules)([\\/]|$)|secret|credential/i;

export function defaultServers({ repoRoot, runtimeRoot }) {
  // Lite ships this server; full-runtime launchers and uvx/npx are not bundled dependencies.
  if (process.env.JACO_LITE === '1') return {
    editor: { name: 'JACO Editor', role: 'project files, git and observed runtime', icon: 'jaco', agentAccess: 'read', gameboardJournalOnly: true,
      command: process.execPath, args: [path.join(runtimeRoot, 'dist', 'jaco-editor.mjs')], cwd: runtimeRoot,
      env: { JACO_RUNTIME_URL: process.env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000' } },
    // Bounded commands in the project (ls, cat, grep, git ...) for agents on a phone or Linux. The programs it runs are
    // POSIX ones, so it is not offered on Windows. Read-only for agents unless the operator sets its access to write.
    ...(process.platform !== 'win32' && fs.existsSync(path.join(runtimeRoot, 'dist', 'jaco-shell.mjs')) ? { shell: {
      name: 'JACO Shell', role: `bounded commands in ${repoRoot} (read-only unless access is write)`, icon: 'jaco', agentAccess: 'read',
      command: process.execPath, args: [path.join(runtimeRoot, 'dist', 'jaco-shell.mjs')], cwd: runtimeRoot, env: { JACO_SHELL_WORKSPACE: repoRoot } } } : {}),
  };
  return {
    jaco: {
      name: 'JACO', role: 'runtime, missions, Workplace, providers', icon: 'jaco', agentAccess: 'read',
      command: process.execPath, args: [path.join(runtimeRoot, 'tools', 'jaco-mcp-launch.mjs')],
      env: { JACO_MODEL_ID: 'jaco-ide', JACO_AGENT_STABLE_ID: 'jaco-ide', JACO_AGENT_NAME: 'JACO IDE', JACO_AGENT_PROVIDER: 'jaco' },
      cwd: path.dirname(runtimeRoot),
    },
    filesystem: {
      name: 'Filesystem', role: `read and write files under ${repoRoot}`, icon: 'mcp', agentAccess: 'write',
      command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', repoRoot],
    },
    // Switching branch or resetting would move the checkout the running runtime is built from.
    git: {
      name: 'Git', role: `git status, diff, log and commit in ${repoRoot}`, icon: 'git', agentAccess: 'write', deny: ['git_reset', 'git_checkout', 'git_init'],
      command: process.execPath, args: [path.join(runtimeRoot, 'tools', 'jaco-git-mcp.mjs'), repoRoot],
      cwd: runtimeRoot, env: { JACO_GIT_WORKSPACE: repoRoot },
    },
    fetch: {
      name: 'Fetch', role: 'fetch web pages as text', icon: 'mcp', agentAccess: 'read',
      command: process.execPath, args: [path.join(runtimeRoot, 'tools', 'jaco-fetch-mcp.mjs')], cwd: runtimeRoot,
    },
    // JACO's own read-only repository tools (tools/jaco-repo-mcp.mjs): a commit's file list without its diff.
    repo: {
      name: 'Repo', role: `read-only commit and file overviews of ${repoRoot}`, icon: 'jaco', agentAccess: 'read',
      command: process.execPath, args: [path.join(runtimeRoot, 'tools', 'jaco-repo-mcp.mjs'), repoRoot],
    },
    // JACO Connect (tools/jaco-connect-mcp.mjs): connect providers from a URL, write-only secrets,
    // and accounts + API keys created by Nova. Not read-only, so Nova's mcp-call cannot use it.
    connect: {
      name: 'JACO Connect', role: 'connect services from a URL, store or generate secrets, request accounts and API keys',
      command: process.execPath, args: [path.join(runtimeRoot, 'tools', 'jaco-connect-mcp.mjs')],
    },
    // JACO Shell (tools/jaco-shell-mcp.mjs): bounded commands in the repository. No shell interprets anything; read-only
    // commands by default, shell_run only when the operator sets this server's access to write.
    shell: {
      name: 'JACO Shell', role: `bounded commands in ${repoRoot} (read-only unless access is write)`, icon: 'jaco', agentAccess: 'read',
      command: process.execPath, args: [path.join(runtimeRoot, 'tools', 'jaco-shell-mcp.mjs')], env: { JACO_SHELL_WORKSPACE: repoRoot },
    },
    cloudflare: {
      name: 'Cloudflare', role: 'read-only account connection and Worker inventory', icon: 'cloudflare', agentAccess: 'read',
      command: process.execPath, args: [path.join(runtimeRoot, 'tools', 'cloudflare-read-mcp.mjs')],
    },
  };
}

// Applies the operator's access settings from the config entry onto a server definition.
function withAccess(def, s = {}) {
  const out = { ...def };
  if (ICONS.includes(s.icon)) out.icon = s.icon;
  if (AGENT_ACCESS.includes(s.agentAccess)) out.agentAccess = s.agentAccess;
  if (Array.isArray(s.deny)) out.deny = s.deny.map(String).filter(t => /^[A-Za-z0-9_.-]{1,80}$/.test(t));
  out.icon ||= 'mcp'; out.agentAccess ||= 'read'; out.deny ||= [];
  return out;
}

// Why an agent may not run this tool, or null when it may.
export function agentRefusal(def, tool, args = {}) {
  if (def.agentAccess === 'off') return 'MCP_AGENT_ACCESS_OFF';
  if (def.deny?.includes(tool.name)) return 'MCP_TOOL_DENIED';
  const reads = Boolean(tool.readOnly || KNOWN_READ_ONLY[def.id]?.has(tool.name));
  if (reads) return null;
  if (def.transport === 'http') return 'MCP_REMOTE_WRITE_REQUIRES_AUTHORITY';
  // A single scoped, append-only coordination exception for the bundled JacoEdit,
  // never a general write grant. It is available only to the built-in stdio server;
  // overriding it with a user command or remote MCP removes this trusted flag.
  // The MCP server attests the actor through Workplace and the runtime enforces
  // legal event kinds, numeric revisions, deduplication and immutable evidence status.
  if (def.id === 'editor' && def.gameboardJournalOnly === true && tool.name === 'gameboard_publish') {
    if (!args || !['OBSERVATION', 'HYPOTHESIS', 'MOVE_PROPOSAL'].includes(args.kind)
      || !Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0
      || typeof args.eventId !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(args.eventId)
      || typeof args.scope !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(args.scope)
      || typeof args.statement !== 'string' || !args.statement.trim())
      return 'MCP_GAMEBOARD_MESSAGE_INVALID';
    return null;
  }
  if (def.agentAccess !== 'write') return 'MCP_TOOL_NOT_READ_ONLY';
  // Only path-like arguments: a file's content may well mention a secret or credential.
  const paths = Object.entries(args || {}).filter(([k]) => /path|source|destination|file|target|dir/i.test(k))
    .flatMap(([, v]) => Array.isArray(v) ? v : [v]).filter(v => typeof v === 'string');
  if (paths.some(p => PROTECTED_PATH.test(p))) return 'MCP_PROTECTED_PATH';
  return null;
}

const resolveEnv = (env = {}, source = process.env) =>
  Object.fromEntries(Object.entries(env).map(([k, v]) => [k, String(v).replace(/\$\{([A-Z0-9_]+)\}/g, (_, n) => source[n] || '')]));

export function loadServerConfig({ configFile, repoRoot, runtimeRoot }) {
  const servers = defaultServers({ repoRoot, runtimeRoot });
  let custom = {};
  try { custom = JSON.parse(fs.readFileSync(configFile, 'utf8')).servers || {}; } catch {}
  for (const [id, s] of Object.entries(custom)) {
    if (!ID.test(id)) continue;
    if (s === null || s.enabled === false) { delete servers[id]; continue; }
    if (s.transport === 'http') {
      try {
      const url = new URL(s.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw Error('MCP_HTTPS_URL_REQUIRED');
      if (s.tokenEnv && !/^[A-Z][A-Z0-9_]{0,79}$/.test(s.tokenEnv)) throw Error('MCP_TOKEN_ENV_INVALID');
      servers[id] = withAccess({ name: String(s.name || id), role: String(s.role || ''), transport: 'http', url: url.toString(), tokenEnv: s.tokenEnv || null, icon: id === 'huggingface' ? 'huggingface' : undefined }, s);
      } catch { servers[id] = { name: String(s.name || id), role: '', validationError: 'MCP_CONFIGURATION_INVALID' }; }
      continue;
    }
    // An entry without a command only changes a built-in server's access (icon, agentAccess, deny).
    if (typeof s.command !== 'string' || !Array.isArray(s.args)) {
      if (servers[id]) servers[id] = withAccess(servers[id], s);
      continue;
    }
    // Migrate exactly the old built-in uvx commands, preserving operator access settings.
    // Do not replace arbitrary user-defined uvx servers or other custom commands.
    const legacyGit = id === 'git' && s.command === 'uvx'
      && s.args.length === 3 && s.args[0] === 'mcp-server-git'
      && s.args[1] === '--repository' && s.args[2] === repoRoot;
    const legacyFetch = id === 'fetch' && s.command === 'uvx'
      && s.args.length === 1 && s.args[0] === 'mcp-server-fetch';
    if (legacyGit || legacyFetch) {
      servers[id] = withAccess({ ...servers[id], name: String(s.name || servers[id].name), role: String(s.role || servers[id].role) }, s);
      continue;
    }
    servers[id] = withAccess({ name: String(s.name || id), role: String(s.role || ''), command: s.command, args: s.args.map(String), env: s.env || {}, cwd: s.cwd }, s);
  }
  for (const [id, def] of Object.entries(servers)) if (!def.validationError) servers[id] = { id, ...withAccess(def) };
  return servers;
}

// A server the operator adds from the IDE. Secrets stay references: an env value for a key that names a
// key, token, secret or password must be ${ENV_NAME}.
export function validateServerEntry(id, s = {}) {
  if (!ID.test(String(id))) throw Error('MCP_SERVER_ID_INVALID');
  const common = {
    name: String(s.name || id).slice(0, 80), role: String(s.role || '').slice(0, 200),
    icon: ICONS.includes(s.icon) ? s.icon : 'mcp',
    agentAccess: AGENT_ACCESS.includes(s.agentAccess) ? s.agentAccess : 'read',
    deny: Array.isArray(s.deny) ? s.deny.map(String).filter(t => /^[A-Za-z0-9_.-]{1,80}$/.test(t)) : [],
  };
  if (s.transport === 'http') {
    const url = new URL(String(s.url || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw Error('MCP_HTTPS_URL_REQUIRED');
    if (s.tokenEnv && !/^[A-Z][A-Z0-9_]{0,79}$/.test(s.tokenEnv)) throw Error('MCP_TOKEN_ENV_INVALID');
    return { ...common, transport: 'http', url: url.toString(), tokenEnv: s.tokenEnv || null };
  }
  const command = String(s.command || '').trim();
  if (!command || command.length > 300) throw Error('MCP_COMMAND_REQUIRED');
  if (!Array.isArray(s.args) || s.args.length > 40) throw Error('MCP_ARGS_INVALID');
  const env = {};
  for (const [k, v] of Object.entries(s.env || {})) {
    if (!/^[A-Z][A-Z0-9_]{0,79}$/.test(k)) throw Error('MCP_ENV_NAME_INVALID');
    const value = String(v);
    if (/KEY|TOKEN|SECRET|PASSWORD/.test(k) && !/^\$\{[A-Z][A-Z0-9_]{0,79}\}$/.test(value)) throw Error('MCP_SECRET_MUST_BE_ENV_REFERENCE');
    env[k] = value;
  }
  return { ...common, command, args: s.args.map(String).slice(0, 40), env };
}

// npx is a .cmd shim on Windows, which cannot start without a shell; run npm's npx script with node
// instead. Executables (uvx.exe, node.exe) start directly.
function resolveCommand(command, args) {
  if (command === 'npx') {
    const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
    if (fs.existsSync(cli)) return [process.execPath, [cli, ...args]];
  }
  return [command, args];
}

class StdioClient {
  constructor(id, def, { log = () => {} } = {}) {
    this.id = id; this.def = def; this.log = log;
    this.proc = null; this.buf = ''; this.nextId = 1; this.pending = new Map();
    this.ready = null; this.tools = []; this.error = null; this.startedAt = null;
  }

  start() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const [command, args] = resolveCommand(this.def.command, this.def.args);
      // No shell: arguments are passed as an array and never concatenated into a command line.
      const proc = this.proc = spawn(command, args, {
        cwd: this.def.cwd || process.cwd(), env: { ...process.env, ...resolveEnv(this.def.env) },
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      });
      this.initialized = false; this.buf = '';
      this.startedAt = new Date().toISOString();
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', chunk => { if (this.proc === proc) this.onData(chunk); });
      proc.stderr.on('data', chunk => { this.lastStderr = String(chunk).slice(-500); });
      // Events of a process that was already replaced (stop + restart) must not touch the new one.
      proc.on('exit', code => {
        if (this.proc !== proc) return;
        this.error = `exited with code ${code}${this.lastStderr ? `: ${this.lastStderr.trim().slice(-200)}` : ''}`;
        this.failPending(`MCP_SERVER_EXITED:${this.id}`);
        this.proc = null; this.ready = null; this.initialized = false;
      });
      // A command that cannot be spawned (e.g. uvx not installed) fails now, not after the 120 s timeout.
      proc.on('error', e => {
        if (this.proc !== proc) return;
        this.error = e.message;
        this.failPending(`MCP_SERVER_SPAWN_FAILED:${this.id}:${e.code || e.message}`);
      });
      proc.stdin.on('error', () => {});
      await this.request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'jaco', version: '0.21' } }, 120_000);
      this.notify('notifications/initialized');
      const listed = await this.request('tools/list', {}, 60_000);
      this.tools = (listed?.tools || []).map(t => ({
        name: String(t.name), description: String(t.description || ''),
        inputSchema: t.inputSchema || { type: 'object', properties: {} },
        readOnly: t.annotations?.readOnlyHint === true,
      }));
      this.error = null; this.initialized = true;
      return this;
    })().catch(e => { this.error = String(e.message || e); this.stop(); throw e; });
    return this.ready;
  }

  onData(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id); this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message || 'MCP_RPC_ERROR')) : p.resolve(msg.result);
      }
    }
  }

  request(method, params, timeoutMs = 60_000) {
    if (!this.proc) return Promise.reject(new Error(`MCP_SERVER_NOT_RUNNING:${this.id}`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`MCP_TIMEOUT:${this.id}.${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  notify(method, params) { this.proc?.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }) + '\n'); }
  failPending(message) { for (const p of this.pending.values()) p.reject(new Error(message)); this.pending.clear(); }
  stop() {
    const proc = this.proc;
    this.proc = null; this.ready = null; this.initialized = false;
    this.failPending(`MCP_SERVER_STOPPED:${this.id}`);
    try { proc?.kill(); } catch {}
  }
}

// What restarts a server: changing its command, not its access settings.
const launchKey = def => JSON.stringify([def.transport, def.command, def.args, def.env, def.cwd, def.url, def.tokenEnv]);

export class StdioMcpHost {
  constructor({ configFile, repoRoot, runtimeRoot, log = () => {}, now = () => Date.now() }) {
    Object.assign(this, { configFile, repoRoot, runtimeRoot, log, now });
    this.clients = new Map();
    // Feedback for the IDE: per-server counters and the latest calls, newest first.
    this.stats = new Map();
    this.recent = [];
  }

  servers() { return loadServerConfig(this); }

  readConfig() {
    try { const c = JSON.parse(fs.readFileSync(this.configFile, 'utf8')); c.servers ||= {}; return c; } catch { return { servers: {} }; }
  }
  writeConfig(config) {
    fs.mkdirSync(path.dirname(this.configFile), { recursive: true });
    const temporary = `${this.configFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(config, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.configFile);
  }

  configureHuggingFace({ enabled = true, tokenEnv = '' } = {}) {
    if (tokenEnv && !['HUGGINGFACE_TOKEN','HF_TOKEN'].includes(tokenEnv)) throw Error('MCP_TOKEN_ENV_INVALID');
    const config = this.readConfig();
    const previous = config.servers.huggingface || {};
    config.servers.huggingface = { name: 'Hugging Face', role: 'Models, datasets, papers and Hub documentation', transport: 'http', url: 'https://huggingface.co/mcp', tokenEnv: tokenEnv || null, icon: 'huggingface', agentAccess: previous.agentAccess || 'read', enabled: Boolean(enabled) };
    this.writeConfig(config);
    this.clients.get('huggingface')?.stop(); this.clients.delete('huggingface');
  }

  // Add or replace a server from the IDE; built-in servers can be replaced too.
  saveServer(id, entry) {
    const valid = validateServerEntry(id, entry);
    const config = this.readConfig();
    config.servers[id] = { ...valid, enabled: true };
    this.writeConfig(config);
    this.clients.get(id)?.stop(); this.clients.delete(id);
    return this.status().find(s => s.id === id);
  }

  // A server the operator added is removed; a built-in one is switched off (it stays in the file as disabled).
  removeServer(id) {
    if (!ID.test(String(id))) throw Error('MCP_SERVER_ID_INVALID');
    const builtIn = Boolean(defaultServers(this)[id]);
    const config = this.readConfig();
    if (!builtIn && !config.servers[id]) throw Error(`MCP_SERVER_UNKNOWN:${id}`);
    if (builtIn) config.servers[id] = { enabled: false }; else delete config.servers[id];
    this.writeConfig(config);
    this.clients.get(id)?.stop(); this.clients.delete(id);
    return { id, removed: !builtIn, disabled: builtIn };
  }

  // Agent access for one server; takes effect on the next call without restarting the server.
  setAccess(id, { agentAccess, deny } = {}) {
    if (!this.servers()[id]) throw Error(`MCP_SERVER_UNKNOWN:${id}`);
    if (agentAccess !== undefined && !AGENT_ACCESS.includes(agentAccess)) throw Error('MCP_AGENT_ACCESS_INVALID');
    const config = this.readConfig();
    const entry = { ...(config.servers[id] || {}) };
    if (entry.enabled === false && defaultServers(this)[id]) throw Error('MCP_SERVER_DISABLED');
    if (agentAccess !== undefined) entry.agentAccess = agentAccess;
    if (deny !== undefined) entry.deny = Array.isArray(deny) ? deny.map(String).filter(t => /^[A-Za-z0-9_.-]{1,80}$/.test(t)) : [];
    config.servers[id] = entry;
    this.writeConfig(config);
    return this.status().find(s => s.id === id);
  }

  client(id) {
    const def = this.servers()[id];
    if (!def) throw new Error(`MCP_SERVER_UNKNOWN:${id}`);
    if (def.validationError) throw Error(def.validationError);
    let c = this.clients.get(id);
    if (!c || launchKey(c.def) !== launchKey(def)) { c?.stop(); c = def.transport === 'http' ? new HttpMcpClient(id, def) : new StdioClient(id, def, { log: this.log }); this.clients.set(id, c); }
    else c.def = def;
    return c;
  }

  // Status without starting anything: what the IDE shows on every refresh.
  status() {
    return Object.entries(this.servers()).map(([id, def]) => {
      const c = this.clients.get(id);
      const stats = this.stats.get(id) || { calls: 0, failures: 0, refused: 0, lastCall: null };
      if (def.validationError) return { id, name: def.name, role: def.role, transport: 'http', command: '', status: 'FAILED', tools: [], error: def.validationError, startedAt: null, icon: 'mcp', agentAccess: 'off', deny: [], stats };
      const tools = (c?.tools || []).map(t => ({ ...t, readOnly: Boolean(t.readOnly || KNOWN_READ_ONLY[id]?.has(t.name)), agentAllowed: agentRefusal(def, t) === null }));
      return { id, name: def.name, role: def.role, transport: def.transport || 'stdio', command: def.transport === 'http' ? new URL(def.url).origin + new URL(def.url).pathname : `${path.basename(def.command)} ${def.args.join(' ')}`.slice(0, 200),
        credentialEnv: id === 'huggingface' ? def.tokenEnv || '' : undefined,
        credentialConfigured: def.tokenEnv ? Boolean(process.env[def.tokenEnv]) : null,
        builtIn: Boolean(defaultServers(this)[id]),
        icon: def.icon, agentAccess: def.agentAccess, deny: def.deny, stats,
        status: c?.initialized ? 'READY' : c?.ready ? 'STARTING' : c?.error ? 'FAILED' : 'STOPPED',
        tools, error: c?.error || null, startedAt: c?.startedAt || null };
    });
  }

  recentCalls(limit = 30) { return this.recent.slice(0, limit); }

  record(id, entry) {
    const s = this.stats.get(id) || { calls: 0, failures: 0, refused: 0, lastCall: null };
    if (entry.outcome === 'refused') s.refused++; else { s.calls++; if (entry.outcome !== 'ok') s.failures++; }
    s.lastCall = entry;
    this.stats.set(id, s);
    this.recent.unshift({ server: id, ...entry });
    this.recent.length = Math.min(this.recent.length, 100);
  }

  async start(id) { const c = this.client(id); await c.start(); return c.tools; }
  async listTools(id) { return this.start(id); }

  // actor 'agent' (Nova, other agents): the server's agent access decides, and readOnly: true (Nova's
  // mcp-call task) also refuses a tool that changes something; those run as mcp-write. actor 'operator'
  // (a click in the IDE) may run any tool of a local server.
  async call(id, name, args = {}, { timeoutMs = 120_000, readOnly = false, actor = readOnly ? 'agent' : 'operator' } = {}) {
    const started = this.now();
    const done = (outcome, error = null) => this.record(id, { tool: name, actor, outcome, error, ms: this.now() - started, at: new Date(started).toISOString() });
    let c;
    try {
      c = this.client(id);
      await c.start();
    } catch (e) { done('failed', String(e.message || e).slice(0, 300)); throw e; }
    const tool = c.tools.find(t => t.name === name);
    if (!tool) { done('failed', `MCP_TOOL_UNKNOWN:${id}.${name}`); throw new Error(`MCP_TOOL_UNKNOWN:${id}.${name}`); }
    const reads = Boolean(tool.readOnly || KNOWN_READ_ONLY[id]?.has(name));
    const refusal = actor === 'agent' ? agentRefusal(c.def, tool, args) || (readOnly && !reads ? 'MCP_TOOL_NOT_READ_ONLY' : null)
      : c.def.transport === 'http' && !tool.readOnly ? 'MCP_REMOTE_WRITE_REQUIRES_AUTHORITY' : null;
    if (refusal) { done('refused', `${refusal}:${id}.${name}`); throw new Error(`${refusal}:${id}.${name}`); }
    try {
      let result;
      try { result = await c.request('tools/call', { name, arguments: args }, timeoutMs); }
      catch (e) {
        // A server that is not running (exited between calls) is started again and the call retried once.
        // A server that exits during the call is not retried: the call may have had an effect.
        if (!/^MCP_SERVER_NOT_RUNNING/.test(e.message)) throw e;
        c = this.client(id); await c.start();
        result = await c.request('tools/call', { name, arguments: args }, timeoutMs);
      }
      done(result?.isError === true ? 'tool_error' : 'ok', result?.isError === true ? String((result.content || []).map(x => x?.text || '').join(' ')).slice(0, 300) : null);
      return result;
    } catch (e) { done('failed', String(e.message || e).slice(0, 300)); throw e; }
  }

  stopAll() { for (const c of this.clients.values()) c.stop(); }
}
