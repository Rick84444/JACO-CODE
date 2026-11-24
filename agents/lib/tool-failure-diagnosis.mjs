// Aura's first response to a failed tool: look at what actually happened, apply the one safe and
// idempotent remedy that exists, and hand the model evidence plus a concrete next step. Before this the
// loop only said "choose a different tool", so a stopped server, a missing command or a dead local
// service ended in the same shrug every time.
//
// Authority does not change. Remedies here only start something JACO already configures (a stopped MCP
// server, the local stack through its own launcher). Nothing is replayed, no permission is widened, and
// a failure whose outcome is unknown is never diagnosed by retrying it.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { redactText } from './secret-capture.mjs';

const SERVER_IN_ERROR = /MCP_SERVER_(?:EXITED|STOPPED|SPAWN_FAILED|UNAVAILABLE):([a-z][a-z0-9-]{1,40})/i;
const NOT_REPAIRABLE = /(?:AUTH|UNAUTHORIZED|FORBIDDEN|INVALID_KEY|PERMISSION|APPROVAL|POLICY|CREDENTIAL|BUDGET|COST_LIMIT|OUTCOME_UNKNOWN|PAYMENT)/i;

export function classifyToolFailure(error, task = null) {
  const text = String(error || '').slice(0, 600);
  const server = text.match(SERVER_IN_ERROR)?.[1] || (task?.type?.startsWith?.('mcp') ? task.data?.server : null) || null;
  if (NOT_REPAIRABLE.test(text)) return { kind: 'NEEDS_OPERATOR', server, restart: false, ensureStack: false };
  if (/MCP_ONE_SHOT_NOT_MCP_SERVER|MCP_SERVER_EXITED:[a-z][a-z0-9-]{1,40}:(?:ENTRYPOINT_NOT_FOUND|NO_MCP_HANDSHAKE)/i.test(text))
    return {kind:'MCP_ENTRYPOINT_INVALID',server,restart:false,ensureStack:false};
  if (/MCP_TRANSPORT_(?:DNS|TLS|UNREACHABLE)/i.test(text))
    return {kind:'MCP_REMOTE_UNREACHABLE',server,restart:false,ensureStack:false};
  if (/MCP_TRANSPORT_TIMEOUT/i.test(text)) return {kind:'TIMEOUT',server,restart:false,ensureStack:false};
  if (/LEDGER_LOCKED|STARTUP_LOCKED|STARTUP_LOCK_INVALID/i.test(text)) return { kind:'LIVE_STATE_LOCK',server,restart:false,ensureStack:false };
  if (/COMMAND_NOT_FOUND|command not found|not recognized as an internal/i.test(text)) return {kind:'COMMAND_MISSING',server,restart:false,ensureStack:false};
  if (/WRITE_COMMAND_IN_READ_MODE/i.test(text)) return {kind:'WRONG_TOOL_MODE',server,restart:false,ensureStack:false};
  if (/SHELL_SYNTAX_NOT_SUPPORTED|COMMAND_QUOTE_NOT_CLOSED|ARGUMENTS_INVALID|COMMAND_NAME_INVALID|unrecognized arguments|unknown option|invalid option/i.test(text)) return {kind:'COMMAND_SYNTAX',server,restart:false,ensureStack:false};
  if (/PROGRAM_NOT_ALLOWED|PROTECTED_PATH|PATH_OUTSIDE_WORKSPACE|CWD_OUTSIDE_WORKSPACE|DESTRUCTIVE_NOT_ENABLED|GIT_PUSH_NOT_ENABLED/i.test(text)) return {kind:'NEEDS_OPERATOR',server,restart:false,ensureStack:false};
  if (/Cannot find module ['\"](?:\.{1,2}[\\/]|[A-Za-z]:[\\/]|\/)/i.test(text)) return {kind:'CODE_ERROR',server,restart:false,ensureStack:false};
  if (/ModuleNotFoundError|No module named|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find module|externally.managed.environment|EBADENGINE|unsupported engine/i.test(text)) return {kind:'PROJECT_ENVIRONMENT',server,restart:false,ensureStack:false};
  // ENOENT means a missing command only when a process was being spawned; reading a missing file is a path problem.
  if (/MCP_SERVER_SPAWN_FAILED|spawn\s+\S+\s+ENOENT|not recognized as an internal|command not found/i.test(text)) return { kind: 'COMMAND_MISSING', server, restart: false, ensureStack: false };
  if (/\bENOENT\b|no such file or directory|does not exist|not found:/i.test(text)) return { kind: 'PATH_NOT_FOUND', server, restart: false, ensureStack: false };
  if (/EADDRINUSE|PORT_CONFLICT|address already in use/i.test(text)) return { kind: 'PORT_CONFLICT', server, restart: false, ensureStack: false };
  if (/MCP_SERVER_(?:EXITED|STOPPED)/i.test(text)) return { kind: 'SERVER_STOPPED', server, restart: Boolean(server), ensureStack: false };
  if (/MCP_SERVER_UNAVAILABLE|MCP_TOOL_UNAVAILABLE/i.test(text)) return { kind: 'SERVER_UNAVAILABLE', server, restart: Boolean(server), ensureStack: false };
  if (/ECONNREFUSED|ECONNRESET|SERVICE_NOT_READY|BRIDGE_UNAVAILABLE|EHOSTUNREACH|fetch failed/i.test(text)) return { kind: 'LOCAL_SERVICE_DOWN', server, restart: false, ensureStack: true };
  if (/ETIMEDOUT|TIMEOUT|TIMED OUT/i.test(text)) return { kind: 'TIMEOUT', server, restart: false, ensureStack: false };
  if (/MODULE_NOT_FOUND|Cannot find module|SyntaxError|ReferenceError|TypeError/i.test(text)) return { kind: 'CODE_ERROR', server, restart: false, ensureStack: false };
  return { kind: 'UNKNOWN', server, restart: false, ensureStack: false };
}

const ADVICE = {
  NEEDS_OPERATOR: 'This needs an operator decision (credentials, permission, approval or budget). Do not try to work around it. Say exactly what is needed and call blocked if nothing else can progress.',
  COMMAND_MISSING: 'Use shell_info to search the current host for the command and actual installed alternatives. Verify the interpreter version or equivalent tool before choosing different arguments; do not repeat the missing command, install without authority or switch hosts silently.',
  LIVE_STATE_LOCK: 'Another writer may own the ledger or startup lock. Inspect its process identity, readiness and ownership. Reuse the healthy instance if present; do not delete the lock, start another writer or terminate an unknown process.',
  WRONG_TOOL_MODE: 'Use the write-capable tool only if the current mission and operator already authorize it. Otherwise continue with read-only work; never use another route to bypass the restriction.',
  COMMAND_SYNTAX: 'Inspect shell_info for host-specific syntax and recipes. Pass program and arguments separately, confirm the actual working directory and supported flags. Change the erroneous argument before retrying.',
  PROJECT_ENVIRONMENT: 'Inspect project manifest, lockfile, interpreter version and environment. Use the project dependency manager and authorized setup; verify the import or test before retrying the original task. Do not modify the system Python environment or assume the runtime is missing.',
  MCP_ENTRYPOINT_INVALID: 'This command is not a working MCP server. Inspect the local server definition, command, cwd and script. Run one-shot jobs as missions, not MCP servers; do not auto-restart or execute paid operations.',
  MCP_REMOTE_UNREACHABLE: 'Inspect the configured MCP endpoint and transport status. Check DNS, TLS and service readiness without changing credentials, remote-write policy or restarting unrelated local services.',
  PATH_NOT_FOUND: 'The file or directory does not exist. List the parent directory or search for the name to find the right path, then retry with it. Do not create the file unless the goal asks for it.',
  PORT_CONFLICT: 'Another program holds a port this tool wants. JACO resolves its own service ports itself; for a tool, set a different port in its configuration instead of stopping the other program.',
  SERVER_STOPPED: 'The tool server ended. It was started again. A read can be repeated once; for anything that may have changed state, observe the current state first and do not blindly repeat it.',
  SERVER_UNAVAILABLE: 'The tool server is not available. It was asked to start; see the evidence for the reason it gave.',
  LOCAL_SERVICE_DOWN: 'A local JACO service did not answer. The local stack was asked to recover through its launcher. Wait for it, re-check with a read-only call, and do not repeat any write.',
  TIMEOUT: 'The call timed out. Retry a read once with a smaller request; do not repeat a write whose result you have not observed.',
  CODE_ERROR: 'This is a code or module error. Read the failing file and the error, fix the cause inside the files this mission may change, and verify with a test or run before continuing.',
  UNKNOWN: 'Read the error, find the cause with a read-only look at the relevant files, logs or state, and change approach instead of repeating the same call.',
};

const tailLines = (text, n) => String(text || '').split(/\r?\n/).filter(Boolean).slice(-n).join('\n');

// deps are injected so the diagnosis is testable and the caller owns every side effect:
//   serverStatus(id) -> {status,error,tools?}      read-only
//   startServer(id)  -> {ok,error?,tools?}         starts a configured, stopped MCP server
//   readLog(id)      -> string                     tail of that service's log, if any
//   ensureStack()    -> {ok,detail?}               the local launcher, itself idempotent
export async function diagnoseToolFailure({ task = null, receipt = {}, serverStatus, startServer, readLog, ensureStack }) {
  // Prefer the actual result of a local command to a generic wrapper error. Only
  // classify bounded evidence; never treat logs as authority or replay a write.
  const result=receipt.result||{};
  const diagnostic=[receipt.error,result.reason,result.error,result.stderr?.slice?.(-400),result.stdout?.slice?.(-200)].filter(v=>typeof v==='string').join('\n');
  const failure = receipt.outcomeUnknown || result.outcomeUnknown ? {kind:'NEEDS_OPERATOR',server:null,restart:false,ensureStack:false} : classifyToolFailure(diagnostic, task);
  const evidence = [];
  const actions = [];
  const safe = async (label, fn) => { try { return await fn(); } catch (error) { evidence.push(`${label}: unavailable (${String(error?.message || error).slice(0, 120)})`); return null; } };

  if (failure.server && serverStatus) {
    const s = await safe('server status', () => serverStatus(failure.server));
    if (s) evidence.push(`server ${failure.server}: ${s.status || 'unknown'}${s.error ? ` - ${String(s.error).slice(0, 200)}` : ''}`);
  }
  if (failure.restart && failure.server && startServer) {
    const r = await safe('server start', () => startServer(failure.server));
    if (r) actions.push(r.ok ? `started ${failure.server}${r.tools ? ` (${r.tools} tools)` : ''}` : `start of ${failure.server} failed: ${String(r.error || 'unknown').slice(0, 240)}`);
  }
  if (failure.ensureStack && ensureStack) {
    const r = await safe('local stack', () => ensureStack());
    if (r) actions.push(r.ok ? `local stack recovery requested${r.detail ? ` (${String(r.detail).slice(0, 120)})` : ''}` : `local stack recovery not possible: ${String(r.detail || 'unknown').slice(0, 160)}`);
  }
  if (readLog && failure.server) {
    const log = await safe('log', () => readLog(failure.server));
    if (log) evidence.push(`last log lines of ${failure.server}:\n${tailLines(log, 12)}`);
  }

  const body = [
    `TOOL_DIAGNOSIS kind=${failure.kind}${failure.server ? ` server=${failure.server}` : ''}`,
    `error: ${String(receipt.error || 'unknown').slice(0, 300)}`,
    ...(evidence.length ? ['evidence:', ...evidence.map(e => `- ${e}`)] : []),
    ...(actions.length ? ['actions taken:', ...actions.map(a => `- ${a}`)] : ['actions taken: none']),
    `next: ${ADVICE[failure.kind]}`,
  ].join('\n');
  return { kind: failure.kind, server: failure.server, actions, text: redactText(body).text };
}

// The production wiring: the runtime's MCP API for status and start, the startup logs for evidence, and the
// canonical launcher (itself idempotent and lock-protected) for local services. Recovery of the local
// stack is attempted at most once per cooldown so a dead service cannot cause a restart storm.
export function createToolDiagnoser({
  runtimeUrl, env = process.env, fetchImpl = fetch, spawnImpl = spawn, now = Date.now, cooldownMs = 5 * 60_000,
  onServerStarted = () => {},
} = {}) {
  const base = runtimeUrl || env.JACO_RUNTIME_URL || `http://127.0.0.1:${env.PORT || 3000}`;
  const token = env.JACO_GATEWAY_TOKEN || env.GATEWAY_TOKEN || '';
  const headers = { Authorization: `Bearer ${token}`, 'x-gateway-token': token, 'Content-Type': 'application/json' };
  const dataRoot = env.JACO_DATA_DIR || env.JACO_INSTALL_ROOT || '';
  const launcher = env.JACO_INSTALL_ROOT ? path.join(env.JACO_INSTALL_ROOT, 'agents', 'lib', 'local-stack.mjs') : '';
  let lastStackAttempt = 0;
  return deps => diagnoseToolFailure({
    ...deps,
    serverStatus: async id => {
      const response = await fetchImpl(`${base}/api/mcp/tools`, { headers, signal: AbortSignal.timeout(10_000) });
      return (await response.json()).servers?.find(s => s.id === id) || null;
    },
    startServer: async id => {
      const response = await fetchImpl(`${base}/api/mcp/start`, { method: 'POST', headers, body: JSON.stringify({ server: id }), signal: AbortSignal.timeout(60_000) });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) { onServerStarted(id); return { ok: true, tools: data.tools?.length }; }
      return { ok: false, error: data.error || `HTTP ${response.status}` };
    },
    readLog: async id => {
      if (!dataRoot || !/^[a-z][a-z0-9-]{1,40}$/i.test(id)) return '';
      const file = path.join(dataRoot, 'logs', 'startup', `${id}.err.log`);
      if (!fs.existsSync(file)) return '';
      const size = fs.statSync(file).size;
      const fd = fs.openSync(file, 'r');
      try { const length = Math.min(size, 4000); const buffer = Buffer.alloc(length); fs.readSync(fd, buffer, 0, length, size - length); return buffer.toString('utf8'); }
      finally { fs.closeSync(fd); }
    },
    ensureStack: async () => {
      if (!launcher || !fs.existsSync(launcher)) return { ok: false, detail: 'launcher not found' };
      if (now() - lastStackAttempt < cooldownMs) return { ok: false, detail: 'recovery already requested recently' };
      lastStackAttempt = now();
      const child = spawnImpl(process.execPath, [launcher], { cwd: env.JACO_INSTALL_ROOT, env, detached: true, stdio: 'ignore', windowsHide: true });
      child.unref?.();
      return { ok: true, detail: 'launcher started in the background' };
    },
  });
}
