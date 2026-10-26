import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'dotenv';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// A runtime is a directory whose server.ts serves the identity readiness probes. The repository root
// also has a legacy server.ts without it; picking that one left startup waiting on a route that never exists.
const isRuntime = dir => fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'server.ts'))
  && fs.readFileSync(path.join(dir, 'server.ts'), 'utf8').includes('/api/runtime/identity');
export function runtimeDirectory(root, configured) {
  if (configured) return path.resolve(root, configured);
  if (isRuntime(root)) return root;
  const candidates = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory())
    .map(e => path.join(root, e.name)).filter(isRuntime);
  if (candidates.length !== 1) throw new Error(candidates.length ? 'RUNTIME_DIR_AMBIGUOUS:set JACO_RUNTIME_DIR' : 'RUNTIME_DIR_MISSING:set JACO_RUNTIME_DIR');
  return candidates[0];
}
export function configuration(root = ROOT, inherited = process.env, overrides = {}) {
  root = path.resolve(root);
  // Credentials may live outside the checkout. Every file that exists is read, the more specific one winning:
  // JACO_ENV_FILE, then <root>/.env, then <state dir>/.env (JACO_STATE_DIR, else ~/.jaco; the home fallback only
  // applies when the inherited environment names a home). Reading only the first file that exists let a
  // checkout .env holding just the hub pairing hide the gateway token in the state directory.
  const home = inherited.USERPROFILE || inherited.HOME;
  const stateDir = inherited.JACO_STATE_DIR || (home && path.join(home, '.jaco'));
  const files = [stateDir && path.join(stateDir, '.env'), path.join(root, '.env'), inherited.JACO_ENV_FILE && path.resolve(root, inherited.JACO_ENV_FILE)]
    .filter(candidate => candidate && fs.existsSync(candidate));
  const fromFiles = Object.assign({}, ...files.map(file => parse(fs.readFileSync(file))));
  const env = { ...fromFiles, ...inherited, ...overrides };
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  const runtime = runtimeDirectory(root, env.JACO_RUNTIME_DIR);
  const manifest = JSON.parse(fs.readFileSync(path.join(runtime, 'package.json'), 'utf8'));
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) throw new Error('RUNTIME_VERSION_MISSING');
  const releasePath = path.join(runtime, 'CURRENT_RELEASE.json');
  let releaseId = null;
  if (fs.existsSync(releasePath)) {
    const release = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
    if (release.version !== manifest.version) throw new Error('RUNTIME_RELEASE_VERSION_MISMATCH');
    if (typeof release.releaseId !== 'string' || !release.releaseId.trim()) throw new Error('RUNTIME_RELEASE_ID_MISSING');
    releaseId = release.releaseId;
  }
  const port = (key, fallback) => {
    const n = Number(env[key] || fallback);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`INVALID_PORT:${key}`);
    return n;
  };
  const ports = { runtime: port('PORT', 3000), workplace: port('JACO_WORKPLACE_PORT', 2995), seer: port('SEER_PORT', 2997), remote: port('JACO_REMOTE_BRIDGE_PORT', 2994), a2a: port('JACO_A2A_PORT', 2998), novaBridge: port('NOVA_BRIDGE_PORT', 4243), cdp: port('JACO_CDP_BRIDGE_PORT', 2996), gateway: port('JACO_GATEWAY_PORT', 4250) };
  ports.chrome = port('CDP_PORT', 9222);
  // Operator 2026-10-22: the agent connects its own browser. Chrome (a dedicated JACO profile), the Nova bridge
  // and the CDP MCP start by default; JACO_ENABLE_CDP=0 turns them off. The ChatGPT gateway stays opt-in
  // (JACO_ENABLE_CHATGPT_GATEWAY=1, or the earlier JACO_ENABLE_CDP=1 that used to start it).
  const cdp = env.JACO_ENABLE_CDP !== '0';
  const gateway = env.JACO_ENABLE_CHATGPT_GATEWAY === '1' || env.JACO_ENABLE_CDP === '1';
  const enabledPorts = Object.entries(ports).filter(([key]) => key === 'gateway' ? gateway : ['chrome','cdp','novaBridge'].includes(key) ? cdp : true).map(([, value]) => value);
  if (new Set(enabledPorts).size !== enabledPorts.length) throw new Error('DUPLICATE_LISTENER_PORT');
  for (const [key, name] of Object.entries({runtime:'PORT',workplace:'JACO_WORKPLACE_PORT',seer:'SEER_PORT',remote:'JACO_REMOTE_BRIDGE_PORT',a2a:'JACO_A2A_PORT',novaBridge:'NOVA_BRIDGE_PORT',cdp:'JACO_CDP_BRIDGE_PORT',gateway:'JACO_GATEWAY_PORT',chrome:'CDP_PORT'})) env[name] = String(ports[key]);
  Object.assign(env, { HOST: '127.0.0.1', JACO_WORKPLACE_HOST: '127.0.0.1', JACO_A2A_HOST: '127.0.0.1', GATEWAY_TOKEN: env.JACO_GATEWAY_TOKEN || env.GATEWAY_TOKEN || '', SEER_TOKEN: env.JACO_GATEWAY_TOKEN || env.GATEWAY_TOKEN || '', DISABLE_HMR: 'true', JACO_WORKPLACE_SUPERVISE_NOVA: '1', JACO_WORKPLACE_SUPERVISE_SEER: '1', JACO_WORKPLACE_REQUIRED: '1', JACO_MCP_REPO_ROOT: root, JACO_RUNTIME_DIR: runtime });
  env.JACO_RUNTIME_URL = `http://127.0.0.1:${ports.runtime}`;
  env.JACO_RELEASE_ROOT = runtime;
  env.JACO_WORKPLACE_URL = `http://127.0.0.1:${ports.workplace}`;
  env.SEER_URL = `http://127.0.0.1:${ports.seer}`;
  env.JACO_REMOTE_BRIDGE_URL = `http://127.0.0.1:${ports.remote}`;
  env.JACO_BASE_URL = env.JACO_RUNTIME_URL;
  env.JACO_NOVA_URL = `http://127.0.0.1:${ports.novaBridge}`;
  env.NOVA_BRIDGE_URL = env.JACO_NOVA_URL;
  env.JACO_A2A_PUBLIC_URL ||= `http://127.0.0.1:${ports.a2a}`;
  env.JACO_A2A_BEARER ||= env.A2A_BEARER_TOKEN || '';
  const mode = env.JACO_START_MODE || 'auto';
  if (!['auto','source','production'].includes(mode)) throw new Error('START_MODE_INVALID');
  const built = fs.existsSync(path.join(runtime, 'dist/server.cjs')) && fs.existsSync(path.join(runtime, 'dist/index.html'));
  if (mode === 'production' && !built) throw new Error('PRODUCTION_BUILD_REQUIRED');
  const production = mode === 'production' || (mode === 'auto' && built);
  return { root, runtime, version: manifest.version, releaseId, env, ports, production, cdp, gateway, tunnel: env.JACO_START_TUNNEL === '1' };
}
export function serviceEnvironment(config, kind) {
  const env = { ...config.env };
  // Secrets never appear in arguments or status. Publication/payment credentials
  // are withheld from all background workers, including the Workplace children.
  for (const k of Object.keys(env)) {
    if (/^(STRIPE_|GITHUB_TOKEN$|GH_TOKEN$|CLOUDFLARE_|SKYFIRE_|CDP_API_KEY)/.test(k)) env[k] = '';
    if (kind !== 'workplace' && /^(JACO_CHATGPT_WORKPLACE_TOKEN|JACO_WORKPLACE_OPERATOR_TOKEN)$/.test(k)) env[k] = '';
    if (kind !== 'runtime' && /^(HUGGINGFACE_TOKEN|HF_TOKEN)$/.test(k)) env[k] = '';
  }
  if (kind === 'runtime') {
    delete env.JACO_WORKSPACE_ROOT;
    env.NODE_ENV = config.production ? 'production' : 'development';
    env.OLLAMA_BASE_URL = (env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/v1\/?$/, '').replace(/\/$/, '') + '/v1';
  } else env.JACO_WORKSPACE_ROOT = config.root;
  return env;
}
export function definitions(c) {
  const node = process.execPath;
  const svc = (id, cwd, args, endpoint, accept) => ({ id, cwd, cmd: node, args, url: endpoint, accept });
  const url = (id, p = '/health') => `http://127.0.0.1:${c.ports[id]}${p}`;
  const items = [
    svc('workplace', c.root, ['--experimental-sqlite', 'gateway/src/workplace/workplace-server.mjs'], url('workplace'), d => d.schema === 'jaco.workplace/v1' && d.status === 'READY'),
    svc('runtime', c.runtime, c.production ? ['dist/server.cjs'] : ['--import', 'tsx', 'server.ts'], url('runtime', '/api/runtime/identity'), d => d.success === true && d.product === 'JACO Autonomus IDE' && d.version === c.version && (!c.releaseId || d.releaseId === c.releaseId)),
    svc('seer', c.root, [], url('seer'), d => d.ok === true && d.service === 'seer'),
    svc('remote', c.root, ['agents/remote-bridge.mjs'], url('remote'), d => d.ok === true && d.service === 'jaco-remote-bridge'),
    svc('a2a', c.runtime, ['gateway/src/a2a-server.mjs'], url('a2a'), d => d.success === true && d.product === 'JACO Continuum A2A Adapter'),
  ];
  if (c.cdp) items.push(
    svc('novaBridge', c.root, ['agents/nova-bridge.mjs'], url('novaBridge'), d => d.ok === true && d.service === 'nova-bridge'),
    svc('cdp', c.root, ['agents/cdp-bridge.mjs'], url('cdp'), d => d.ok === true && d.service === 'jaco-cdp-mcp'),
  );
  if (c.gateway) items.push(svc('gateway', c.root, ['gateway/src/chatgpt-nova-gateway.mjs'], url('gateway'), d => d.ok === true && d.service === 'jaco-chatgpt-nova-gateway'));
  for (const item of items) if (item.id === 'workplace') item.token = c.env.JACO_WORKPLACE_TOKEN || '';
  return items;
}
export function executable(env, configured, name, candidates = []) {
  const paths = configured ? [path.resolve(configured)] : [...candidates, ...(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean).map(p => path.join(p.replace(/^"|"$/g, ''), name))];
  return paths.find(p => fs.existsSync(p) && fs.statSync(p).isFile()) || null;
}
export function ollamaExecutable(env, platform = process.platform) {
  return executable(env, env.JACO_OLLAMA_EXECUTABLE, platform === 'win32' ? 'ollama.exe' : 'ollama',
    platform === 'win32' && env.LOCALAPPDATA ? [path.join(env.LOCALAPPDATA, 'Programs/Ollama/ollama.exe')] : []);
}
export function tunnelCommandMatches(command, config) {
  const match = String(command || '').match(/--config(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  const value = match?.[1] || match?.[2] || match?.[3];
  return Boolean(value && path.resolve(value).toLowerCase() === path.resolve(config).toLowerCase() && /\btunnel\b.*\brun\b/i.test(command));
}
async function probe(s, token) {
  try {
    token = s.token ?? token;
    const r = await fetch(s.url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(5000) });
    const data = await r.json();
    return { id: s.id, url: s.url, state: r.ok && s.accept(data) ? 'READY' : 'UNHEALTHY', http: r.status, data };
  } catch { return { id: s.id, url: s.url, state: 'UNREACHABLE' }; }
}
async function occupied(url) {
  const u = new URL(url);
  return new Promise(resolve => {
    const socket = net.connect(Number(u.port), u.hostname);
    socket.setTimeout(1000);
    const done = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => done(true)); socket.once('error', () => done(false)); socket.once('timeout', () => done(false));
  });
}
async function waitReady(s, token, timeout = 180000) {
  const deadline = Date.now() + timeout;
  do {
    const result = await probe(s, token);
    if (result.state === 'READY') return result;
    await new Promise(resolve => setTimeout(resolve, 1500));
  } while (Date.now() < deadline);
  throw new Error(`SERVICE_NOT_READY:${s.id}:see logs/startup/${s.id}.err.log`);
}
function launch(c, s) {
  const logs = path.join(c.root, 'logs', 'startup'); fs.mkdirSync(logs, { recursive: true });
  const out = fs.openSync(path.join(logs, `${s.id}.out.log`), 'a');
  const err = fs.openSync(path.join(logs, `${s.id}.err.log`), 'a');
  const child = spawn(s.cmd, s.args, { cwd: s.cwd, env: serviceEnvironment(c, s.id), windowsHide: true, detached: true, stdio: ['ignore', out, err] });
  fs.closeSync(out); fs.closeSync(err);
  return new Promise((resolve, reject) => { child.once('error', reject); child.once('spawn', () => {
    child.unref();
    try {
      // Retain ownership even if readiness times out. A second click must wait
      // for this process rather than spawning a second executor.
      const record = { pid: child.pid, createdAt: new Date().toISOString(), birth: processBirth(child.pid) };
      fs.writeFileSync(path.join(logs, `${s.id}.process.json`), JSON.stringify(record));
      resolve(child.pid);
    } catch (error) { reject(error); }
  }); });
}
export function processBirth(pid) {
  if (process.platform !== 'win32') return null;
  const value = execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command', `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"; if($p){$p.CreationDate.ToUniversalTime().ToString('o')}`], { encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim();
  return value || null;
}
export function pendingProcess(c, id) {
  const file = path.join(c.root, 'logs/startup', `${id}.process.json`);
  if (!fs.existsSync(file)) return null;
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Number.isInteger(record.pid) || record.pid < 1) throw new Error(`PROCESS_RECORD_INVALID:${id}`);
  // EPERM means the PID is alive but belongs to another account or a service: whose it is is decided by its creation time.
  try { process.kill(record.pid, 0); } catch (e) { if (e.code === 'ESRCH') return null; if (e.code !== 'EPERM') throw e; }
  const birth = record.birth ? processBirth(record.pid) : null;
  if (record.birth && birth === record.birth) return record.pid;
  // A PID cannot be reused while its process lives, so a process created after the recorded one means the
  // recorded process is gone (after a reboot the number belongs to something else): the record is stale, not
  // a running service. Anything unverifiable still fails closed.
  const recorded = Date.parse(record.birth), current = Date.parse(birth);
  if (Number.isFinite(recorded) && Number.isFinite(current) && current > recorded) return null;
  throw new Error(`PROCESS_OWNER_NOT_VERIFIED:${id}`);
}
export function recoverableListener(ownedPid,listenerPid) {
  return Number.isInteger(ownedPid)&&ownedPid>0&&ownedPid===listenerPid;
}
function ownsListener(c,s) {
  const pid=pendingProcess(c,s.id);
  if(!pid||process.platform!=='win32')return false;
  const port=Number(new URL(s.url).port);
  const listener=Number(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`],{encoding:'utf8',windowsHide:true,timeout:15000}).trim());
  return recoverableListener(pid,listener);
}
function save(c, result) {
  const file = path.join(c.root, 'logs', 'startup', 'status.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(result, null, 2)); fs.renameSync(file + '.tmp', file);
}
// The same semantic Nova checks are used for startup and later read-only inspection.
function novaReadiness(c) {
  const workplace = definitions(c).find(s => s.id === 'workplace');
  return [
    { ...workplace, id: 'nova-supervisor', accept: d => d.supervisedAgents?.nova?.supervised === true && d.supervisedAgents.nova.state === 'RUNNING' },
    { id: 'nova-session', token: c.env.JACO_WORKPLACE_TOKEN || '', url: c.env.JACO_WORKPLACE_URL + '/v1/agents', accept: d => d.agents?.some(a => a.requestedName === (c.env.JACO_EXECUTOR === 'desktop-agentos' ? 'Desktop AgentOS' : 'Nova') && a.sessions?.some(s => ['READY', 'BUSY', 'AVAILABLE'].includes(s.status))) },
  ];
}
export async function inspectStatus(c, services = [...definitions(c), ...novaReadiness(c)]) {
  const startedAt = new Date().toISOString();
  const observed = await Promise.all(services.map(async s => {
    const p = await probe(s, c.env.GATEWAY_TOKEN);
    return { id: p.id, state: p.state, url: p.url, http: p.http ?? null, observedAt: new Date().toISOString() };
  }));
  return { schema: 'jaco.local-startup/v1', state: observed.length && observed.every(s => s.state === 'READY') ? 'READY' : 'BLOCKED', startedAt, observedAt: new Date().toISOString(), runtime: c.runtime, scope: 'fresh service readiness; no task execution verified', services: observed };
}
export async function activate(c, { open = false } = {}) {
  if (fs.existsSync(path.join(c.root, '.jaco-emergency-stop.json'))) throw new Error('EMERGENCY_STOP_ACTIVE');
  if (c.env.GATEWAY_TOKEN.length < 24) throw new Error('GATEWAY_TOKEN_REQUIRED_MIN_24');
  if (!fs.existsSync(path.join(c.runtime, 'server.ts'))) throw new Error('RUNTIME_DIR_INVALID');
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('NODE_24_OR_NEWER_REQUIRED');
  if (!c.production) {
    try { createRequire(path.join(c.runtime, 'package.json')).resolve('tsx'); }
    catch { throw new Error('RUNTIME_DEPENDENCIES_MISSING:install runtime dependencies'); }
  }
  const dir = path.join(c.root, 'logs', 'startup'); fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, 'startup.lock');
  try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const pid = Number(fs.readFileSync(lock, 'utf8'));
    if (!Number.isInteger(pid) || pid < 1) throw new Error('STARTUP_LOCK_INVALID');
    try { process.kill(pid, 0); throw new Error('STARTUP_ALREADY_IN_PROGRESS'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    fs.unlinkSync(lock); fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
  }
  const startedAt = new Date().toISOString();
  const result = { schema: 'jaco.local-startup/v1', runId: `${process.pid}-${Date.now()}`, startedAt, observedAt: startedAt, sequence: 0, state: 'STARTING', phase: 'preflight', runtime: c.runtime, services: [] };
  const checkpoint = phase => { result.phase = phase; result.sequence++; result.observedAt = new Date().toISOString(); save(c, result); };
  try {
    checkpoint('preflight');
    // Reject foreign listeners before starting any optional helper.
    for (const service of [...definitions(c)].sort((a, b) => a.id === 'runtime' ? -1 : b.id === 'runtime' ? 1 : 0)) {
      const observed = await probe(service, c.env.GATEWAY_TOKEN);
      if (observed.state !== 'READY' && await occupied(service.url) && !ownsListener(c,service)) throw new Error(`PORT_CONFLICT_OR_UNHEALTHY:${service.id}`);
    }
    if (c.cdp) {
      const chrome = { id: 'chrome', url: `http://127.0.0.1:${c.ports.chrome}/json/version`, accept: d => Boolean(d.webSocketDebuggerUrl) };
      if ((await probe(chrome)).state !== 'READY') {
        if (await occupied(chrome.url)) throw new Error('PORT_CONFLICT:chrome');
        const exe = executable(c.env, c.env.JACO_CHROME_EXECUTABLE, 'chrome.exe', [c.env.ProgramFiles, c.env['ProgramFiles(x86)'], c.env.LOCALAPPDATA].filter(Boolean).map(p => path.join(p, 'Google/Chrome/Application/chrome.exe')));
        if (!exe) throw new Error('CHROME_NOT_INSTALLED');
        const profile = c.env.JACO_CHROME_PROFILE_DIR || (c.env.LOCALAPPDATA && path.join(c.env.LOCALAPPDATA, 'JACO/Chrome-CDP'));
        if (!profile) throw new Error('CHROME_PROFILE_DIR_REQUIRED');
        if (!pendingProcess(c, 'chrome')) await launch(c, { id: 'chrome', cwd: c.root, cmd: exe, args: [`--remote-debugging-port=${c.ports.chrome}`, '--remote-debugging-address=127.0.0.1', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', `--user-data-dir=${path.resolve(c.root, profile)}`, 'about:blank'] });
        await waitReady(chrome, '', 30000);
      }
    }
    const ollamaUrl = (c.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/v1\/?$/, '').replace(/\/$/, '');
    if (!c.env.JACO_MODEL_PROVIDER || c.env.JACO_MODEL_PROVIDER === 'ollama') {
      const ollama = { id: 'ollama', url: ollamaUrl + '/api/tags', accept: d => Array.isArray(d.models) };
      if ((await probe(ollama)).state !== 'READY') {
        const local = new URL(ollamaUrl);
        if (!['127.0.0.1', 'localhost'].includes(local.hostname)) throw new Error('OLLAMA_REMOTE_NOT_READY');
        if (await occupied(ollama.url)) throw new Error('PORT_CONFLICT:ollama');
        const exe = ollamaExecutable(c.env);
        if (!exe) throw new Error('OLLAMA_NOT_INSTALLED');
        c.env.OLLAMA_HOST = local.host;
        if (!pendingProcess(c, 'ollama')) await launch(c, { id: 'ollama', cwd: c.root, cmd: exe, args: ['serve'] });
        await waitReady(ollama, '', 30000);
      }
      result.services.push({ id: 'ollama', state: 'READY', url: ollama.url });
    }
    for (const s of definitions(c)) {
      checkpoint(`service:${s.id}`);
      let state = await probe(s, c.env.GATEWAY_TOKEN);
      if (state.state !== 'READY') {
        // Workplace exclusively owns SEER and Nova. Never launch a second copy.
        if (s.id !== 'seer') {
          if (await occupied(s.url) && !ownsListener(c,s)) throw new Error(`PORT_CONFLICT_OR_UNHEALTHY:${s.id}`);
          const pending = pendingProcess(c, s.id);
          const pid = pending || await launch(c, s); console.log(`${pending ? 'WAITING' : 'STARTED'} ${s.id} PID=${pid}`);
        }
        state = await waitReady(s, c.env.GATEWAY_TOKEN);
      }
      result.services.push({ id: s.id, state: state.state, url: s.url }); console.log(`READY ${s.id}`);
      checkpoint(`ready:${s.id}`);
    }
    checkpoint('nova');
    for (const check of novaReadiness(c)) await waitReady(check, c.env.GATEWAY_TOKEN);
    result.services.push({ id: 'nova', state: 'READY', owner: 'workplace' });
    if (c.cdp) {
      checkpoint('browser-attachment');
      const base = `http://127.0.0.1:${c.ports.chrome}`;
      const tabsResponse = await fetch(base + '/json/list', { signal: AbortSignal.timeout(5000) });
      const tabs = await tabsResponse.json();
      if (!tabsResponse.ok || !Array.isArray(tabs)) throw new Error('CHROME_TARGET_LIST_INVALID');
      let target = tabs.find(t => { try { const u = new URL(t.url); return t.type === 'page' && ['127.0.0.1','localhost'].includes(u.hostname) && Number(u.port) === c.ports.runtime; } catch { return false; } });
      if (!target) {
        const created = await fetch(base + '/json/new?' + encodeURI(c.env.JACO_RUNTIME_URL), { method: 'PUT', signal: AbortSignal.timeout(5000) });
        target = await created.json();
        if (!created.ok || !target.webSocketDebuggerUrl) throw new Error('CHROME_TARGET_CREATE_FAILED');
      }
      const response = await fetch(c.env.JACO_RUNTIME_URL + '/api/continuum/browser/attach', { method: 'POST', headers: { 'content-type': 'application/json', 'x-gateway-token': c.env.GATEWAY_TOKEN }, body: JSON.stringify({ port: c.ports.chrome, urlIncludes: target.url }), signal: AbortSignal.timeout(15000) });
      const attached = await response.json();
      if (!response.ok || attached.success !== true) throw new Error('BROWSER_ATTACHMENT_FAILED');
      result.browserAttachment = 'ATTACHED';
    }
    if (c.tunnel) {
      checkpoint('tunnel');
      const config = path.resolve(c.root, c.env.JACO_TUNNEL_CONFIG || 'logs/cloudflared-config.yml');
      if (!fs.existsSync(config)) throw new Error('TUNNEL_CONFIGURATION_MISSING');
      // A tunnel is a single long-lived service. Query process ownership before spawn.
      const running = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$items=@(Get-CimInstance Win32_Process -Filter \"Name='cloudflared.exe'\" | ForEach-Object { $_.CommandLine }); ConvertTo-Json -InputObject $items -Compress"], { encoding: 'utf8', windowsHide: true }).trim());
      const matches = running.filter(command => tunnelCommandMatches(command, config));
      if (running.length && !matches.length) throw new Error('TUNNEL_OWNER_NOT_VERIFIED');
      if (matches.length > 1) throw new Error('DUPLICATE_TUNNEL_PROCESSES');
      if (matches.length === 0) {
        const exe = executable(c.env, c.env.JACO_CLOUDFLARED_EXECUTABLE, 'cloudflared.exe', [c.env.ProgramFiles, c.env['ProgramFiles(x86)']].filter(Boolean).map(p => path.join(p, 'cloudflared/cloudflared.exe')));
        if (!exe) throw new Error('CLOUDFLARED_NOT_INSTALLED');
        await launch(c, { id: 'tunnel', cwd: c.root, cmd: exe, args: ['tunnel', '--config', config, 'run'] });
      }
      result.tunnel = 'PROCESS_PRESENT_PUBLIC_REACHABILITY_UNVERIFIED';
    }
    result.state = 'READY'; result.completedAt = new Date().toISOString(); checkpoint('complete');
    if (open) { const child = spawn('explorer.exe', [c.env.JACO_RUNTIME_URL], { windowsHide: true, detached: true, stdio: 'ignore' }); child.unref(); }
    return result;
  } catch (error) { result.state = 'BLOCKED'; result.error = error.message; result.completedAt = new Date().toISOString(); checkpoint(result.phase); throw error; }
  finally { fs.unlinkSync(lock); }
}
export async function main(args = process.argv.slice(2)) {
  const runtimeArg = args.indexOf('--runtime');
  if (runtimeArg >= 0 && (!args[runtimeArg + 1] || args[runtimeArg + 1].startsWith('--'))) throw new Error('RUNTIME_ARGUMENT_REQUIRED');
  const c = configuration(ROOT, process.env, runtimeArg >= 0 ? { JACO_RUNTIME_DIR: args[runtimeArg + 1] } : {});
  if (args.includes('--preflight')) return { schema: 'jaco.startup-preflight/v1', emergencyStop: fs.existsSync(path.join(c.root, '.jaco-emergency-stop.json')), runtimePresent: fs.existsSync(path.join(c.runtime, 'server.ts')), runtime: c.runtime, scope: 'read only; no children launched' };
  if (args.includes('--status')) return inspectStatus(c);
  return activate(c, { open: args.includes('--open') });
}
if (process.env.JACO_LITE !== '1' && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then(r => {
  console.log(JSON.stringify(r, null, 2));
  if (r.state === 'BLOCKED') process.exitCode = 1;
}).catch(e => {
  console.error(e.message);
  const dir = path.join(ROOT, 'logs/startup');
  try { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, 'launcher.err.log'), `${new Date().toISOString()} BLOCKED ${e.message}\n`); }
  catch { console.error('STARTUP_ERROR_LOG_UNAVAILABLE'); }
  process.exitCode = 1;
});
