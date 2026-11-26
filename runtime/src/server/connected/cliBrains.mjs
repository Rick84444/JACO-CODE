// CLI brains: use a vendor's own signed-in CLI (Claude Code, Codex, Gemini CLI) as a model provider.
//
// JACO never touches the subscription credential. The vendor CLI signs in through its own web page and keeps
// its own token; JACO only asks it "are you signed in?" and hands it one prompt on stdin. The CLI's environment
// is an allow-list, so a stray API key in JACO's environment cannot switch a subscription to metered billing.
import { spawn as nodeSpawn } from 'node:child_process';

const MAX_OUTPUT = 1024 * 1024;
const CHAT_TIMEOUT_MS = 120_000;
const STATUS_TIMEOUT_MS = 8_000;
const LOGIN_TIMEOUT_MS = 10 * 60_000;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

// Only these variables reach a CLI. In particular no ANTHROPIC_/OPENAI_/GEMINI_/GOOGLE_ API keys.
const ENV_ALLOW = new Set([
  'PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR',
  'LANG', 'LC_ALL', 'SHELL', 'TERM', 'USER', 'LOGNAME', 'DISPLAY', 'WAYLAND_DISPLAY', 'BROWSER', 'XDG_CONFIG_HOME',
  'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_RUNTIME_DIR', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy',
  'https_proxy', 'no_proxy', 'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS', 'REQUESTS_CA_BUNDLE',
]);
export const cliEnv = (env = process.env) => Object.fromEntries(Object.entries(env).filter(([k, v]) => ENV_ALLOW.has(k) && typeof v === 'string'));

const flatten = messages => messages.map(m => {
  const role = String(m?.role || 'user');
  const text = typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? '');
  return messages.length === 1 && role === 'user' ? text : `[${role}]\n${text}`;
}).join('\n\n');

const jsonStatus = out => { const j = JSON.parse(out); return { loggedIn: j?.loggedIn === true && j?.authMethod === 'oauth_token', detail: j?.authMethod === 'oauth_token' ? 'oauth' : 'unverified authentication' }; };

// `observed` records which commands were read from an installed CLI. Only claude was available when this was
// written; codex and gemini follow the vendors' documented behaviour and fail closed if the output differs.
export const BRAINS = {
  claude: {
    id: 'claude', providerId: 'claude-cli', label: 'Claude', plan: 'Claude Pro / Max', bin: 'claude', observed: true,
    loginKind: 'browser', loginArgs: ['auth', 'login', '--claudeai'],
    statusArgs: ['auth', 'status', '--json'], parseStatus: jsonStatus,
    defaultModel: 'default',
    chatArgs: model => ['-p', '--output-format', 'json', '--tools', '', '--no-session-persistence', '--disable-slash-commands', '--strict-mcp-config',
      ...(model && model !== 'default' ? ['--model', model] : [])],
    parseChat: out => { const j = JSON.parse(out); if (j?.is_error) throw new Error('CLI_BRAIN_ERROR'); return String(j?.result ?? ''); },
  },
  codex: {
    id: 'codex', providerId: 'codex-cli', label: 'ChatGPT (Codex)', plan: 'ChatGPT Plus / Pro', bin: 'codex', observed: false,
    loginKind: 'browser', loginArgs: ['login'],
    statusArgs: ['login', 'status'], parseStatus: out => ({ loggedIn: /logged in (?:using|with) chatgpt/i.test(out) && !/not logged in/i.test(out), detail: 'ChatGPT authentication status' }),
    defaultModel: 'default',
    chatArgs: model => ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', ...(model && model !== 'default' ? ['--model', model] : []), '-'],
    parseChat: out => {
      let result = ''; let completed = false;
      for (const line of out.split(/\r?\n/).filter(Boolean)) {
        const e = JSON.parse(line);
        if (['error', 'turn.failed'].includes(e.type)) throw new Error('CLI_BRAIN_ERROR');
        if (e.type === 'item.completed' && e.item?.type === 'agent_message') result = e.item.text;
        if (e.type === 'turn.completed') completed = true;
      }
      if (!completed) throw new Error('CLI_BRAIN_INCOMPLETE');
      return result;
    },
  },
  gemini: {
    id: 'gemini', providerId: 'gemini-cli', label: 'Gemini', plan: 'Code Assist Standard / Enterprise', bin: 'gemini', observed: false,
    // The Gemini CLI has no login subcommand: the first interactive run offers "Login with Google".
    loginKind: 'terminal', loginHint: 'gemini',
    statusArgs: ['--version'],
    parseStatus: () => ({ loggedIn: false, detail: 'account entitlement unverified' }),
    defaultModel: 'default',
    chatArgs: model => ['-p', ' ', ...(model && model !== 'default' ? ['--model', model] : [])],
    parseChat: out => out,
  },
};

export const brainByProviderId = providerId => Object.values(BRAINS).find(b => b.providerId === providerId) || null;

// Run a CLI without a shell on POSIX; the prompt goes on stdin, never in argv. Output is capped.
function run(bin, args, { input = '', timeoutMs, env = process.env, spawnImpl = nodeSpawn } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(bin, args, { env: cliEnv(env), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { return reject(new Error(e?.code === 'ENOENT' ? 'CLI_NOT_INSTALLED' : 'CLI_SPAWN_FAILED')); }
    let stdout = ''; let stderr = ''; let done = false;
    const finish = (fn, value) => { if (done) return; done = true; clearTimeout(timer); fn(value); };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} finish(reject, new Error('CLI_TIMEOUT')); }, timeoutMs);
    const take = which => chunk => {
      if (which === 'out') stdout += chunk; else stderr += chunk;
      if (stdout.length + stderr.length > MAX_OUTPUT) { try { child.kill('SIGKILL'); } catch {} finish(reject, new Error('CLI_OUTPUT_TOO_LARGE')); }
    };
    child.stdout?.setEncoding?.('utf8'); child.stderr?.setEncoding?.('utf8');
    child.stdout?.on('data', take('out')); child.stderr?.on('data', take('err'));
    child.on('error', e => finish(reject, new Error(e?.code === 'ENOENT' ? 'CLI_NOT_INSTALLED' : 'CLI_SPAWN_FAILED')));
    child.on('close', code => finish(resolve, { code, stdout, stderr }));
    child.stdin?.on?.('error', () => {});
    child.stdin?.end?.(input);
  });
}

export async function brainStatus(id, { env = process.env, spawnImpl, home } = {}) {
  const b = Object.hasOwn(BRAINS, id) ? BRAINS[id] : null; if (!b) throw new Error('UNKNOWN_BRAIN');
  const base = { id: b.id, providerId: b.providerId, label: b.label, plan: b.plan, loginKind: b.loginKind, loginHint: b.loginHint || null, observed: b.observed };

  try {
    const r = await run(b.bin, b.statusArgs, { timeoutMs: STATUS_TIMEOUT_MS, env, spawnImpl });
    const text = `${r.stdout}\n${r.stderr}`.trim();
    try { return { ...base, installed: true, ...(r.code === 0 ? b.parseStatus(r.stdout.trim() || text) : { loggedIn: false, detail: 'status command failed' }) }; }
    catch { return { ...base, installed: true, loggedIn: false, detail: 'status not understood' }; }
  } catch (e) {
    return { ...base, installed: e.message !== 'CLI_NOT_INSTALLED', loggedIn: false, detail: e.message };
  }
}

export const allBrainStatus = opts => Promise.all(Object.keys(BRAINS).map(id => brainStatus(id, opts)));

// One browser sign-in per CLI at a time. The CLI prints the sign-in address; it is returned so the operator
// can open it when the CLI's own browser launch has no display (a phone or a remote computer).
const logins = new Map();
export async function startLogin(id, { env = process.env, spawnImpl = nodeSpawn } = {}) {
  const b = Object.hasOwn(BRAINS, id) ? BRAINS[id] : null; if (!b) throw new Error('UNKNOWN_BRAIN');
  if (b.loginKind === 'terminal') return { state: 'TERMINAL', command: b.loginHint };
  const running = logins.get(id);
  if (running) return { state: 'WAITING', url: running.url };
  let child;
  try { child = spawnImpl(b.bin, b.loginArgs, { env: cliEnv(env), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { throw new Error(e?.code === 'ENOENT' ? 'CLI_NOT_INSTALLED' : 'CLI_SPAWN_FAILED'); }
  const entry = { url: null };
  logins.set(id, entry);
  const stop = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, LOGIN_TIMEOUT_MS);
  stop.unref?.(); // a pending sign-in must never keep JACO (or a test run) alive
  const release = () => { clearTimeout(stop); if (logins.get(id) === entry) logins.delete(id); };
  let seen = '';
  const sniff = chunk => {
    if (entry.url || seen.length > 64_000) return;
    seen += chunk;
    const hosts = id === 'claude' ? ['claude.ai', 'console.anthropic.com', 'platform.claude.com'] : ['auth.openai.com', 'chatgpt.com'];
    for (const raw of seen.match(/https:\/\/[^\s"'<>]+/g) || []) {
      try { const u = new URL(raw); if (!u.username && !u.password && !u.port && hosts.includes(u.hostname)) { entry.url = u.href; break; } } catch {}
    }
  };
  child.stdout?.setEncoding?.('utf8'); child.stderr?.setEncoding?.('utf8');
  child.stdout?.on('data', sniff); child.stderr?.on('data', sniff);
  child.on('error', release); child.on('close', release);
  // Give the CLI a moment to print its address.
  for (let i = 0; i < 20 && !entry.url && logins.get(id) === entry; i++) await new Promise(r => setTimeout(r, 100));
  return { state: 'WAITING', url: entry.url };
}

// One tool-less completion. Fails closed: not signed in, non-zero exit or empty text all throw.
export async function complete(providerId, { messages, model, env = process.env, spawnImpl } = {}) {
  const b = brainByProviderId(providerId); if (!b) throw new Error('PROVIDER_NOT_FOUND');
  if (!Array.isArray(messages) || messages.length === 0) throw new Error('MESSAGES_REQUIRED');
  const m = String(model || '').trim();
  if (m && !MODEL_RE.test(m)) throw new Error('CLI_MODEL_INVALID');
  const started = Date.now();
  const r = await run(b.bin, b.chatArgs(m), { input: flatten(messages), timeoutMs: CHAT_TIMEOUT_MS, env, spawnImpl });
  if (r.code !== 0) throw new Error(`CLI_BRAIN_EXIT_${Number.isInteger(r.code) ? r.code : 'UNKNOWN'}`);
  let content;
  try { content = b.parseChat(r.stdout); } catch { throw new Error('CLI_BRAIN_OUTPUT_UNPARSEABLE'); }
  content = String(content || '').trim();
  if (!content) throw new Error('PROVIDER_EMPTY_COMPLETION');
  return { providerId, model: m || b.defaultModel, content, finishReason: 'stop', latencyMs: Date.now() - started, usage: null };
}
