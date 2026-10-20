// The system connects what it can reach by itself, and keeps doing it. Every cycle:
//   providers  known local endpoints and providers whose key is already configured are probed; a chat model is
//              adopted only when the operator chose none
//   tools      every MCP server that is not switched off and not waiting for a missing credential is started; one
//              that stopped or crashed is started again, with a growing pause between attempts
// No key guessing, account creation, downloads or purchases (JACO Connect does those, on request). Listing models
// is not a tool-capability test. What cannot be fixed here is reported with what the operator can do about it.
const RETRY_FROM_MS = 30_000, RETRY_MAX_MS = 10 * 60_000, START_CONCURRENCY = 3;

// What the operator can do about a start failure, from the error text alone.
export function remedyFor(error = '') {
  const e = String(error);
  if (/ENOENT.*uvx|uvx.*ENOENT|spawn uvx/i.test(e)) return 'uvx saknas: installera uv (Termux: pkg install uv, Windows: winget install astral-sh.uv).';
  if (/ENOENT.*npx|npx.*ENOENT|spawn npx/i.test(e)) return 'npx saknas: installera Node.js med npm.';
  if (/ENOENT/i.test(e)) return 'Programmet som servern ska starta hittas inte. Kontrollera kommandot i verktygsinställningarna.';
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|network|offline/i.test(e)) return 'Ingen nätverksanslutning just nu. Försöker igen automatiskt.';
  if (/MCP_TIMEOUT|timed out/i.test(e)) return 'Servern svarade inte i tid. Försöker igen automatiskt.';
  if (/HTTPS_URL_REQUIRED|CONFIGURATION_INVALID|TOKEN_ENV/i.test(e)) return 'Inställningen för servern är ogiltig. Rätta den i verktygsinställningarna.';
  return 'Försöker igen automatiskt; se serverns logg om felet kvarstår.';
}

export function automaticConnections({ registry, mcpHost, env = process.env, now = Date.now, onToolsStarted = (_event) => {} }) {
  let inFlight = null, at = -Infinity, receipt = { observedAt: null, providers: [], tools: [], problems: [], ok: false };
  const retry = new Map(); // id -> { attempts, nextTry, error }
  const autoStart = env.JACO_AUTO_START_TOOLS !== '0';

  async function connectTools() {
    if (!mcpHost || !autoStart) return [];
    const lite = env.JACO_LITE === '1';
    const rows = mcpHost.status().filter(s => s.agentAccess !== 'off' && (!lite || s.id === 'editor'));
    const out = [], todo = [];
    for (const s of rows) {
      if (s.status === 'READY') { retry.delete(s.id); out.push({ id: s.id, state: 'CONNECTED', tools: s.tools.map(t => t.name) }); continue; }
      if (s.credentialEnv && s.credentialConfigured === false) { out.push({ id: s.id, state: 'NO_KEY', tools: [], remedy: `Lägg in ${s.credentialEnv} (JACO Connect kan ta emot den) så ansluts servern själv.` }); continue; }
      if (s.status === 'FAILED' && s.error && /CONFIGURATION_INVALID|HTTPS_URL_REQUIRED|TOKEN_ENV/.test(s.error)) { out.push({ id: s.id, state: 'INVALID', tools: [], error: s.error, remedy: remedyFor(s.error) }); continue; }
      const r = retry.get(s.id);
      if (r && now() < r.nextTry) { out.push({ id: s.id, state: 'RETRY_LATER', tools: [], error: r.error, attempts: r.attempts, nextTry: new Date(r.nextTry).toISOString(), remedy: remedyFor(r.error) }); continue; }
      todo.push(s);
    }
    const started = [], failed = [];
    for (let i = 0; i < todo.length; i += START_CONCURRENCY) {
      await Promise.all(todo.slice(i, i + START_CONCURRENCY).map(async s => {
        try {
          const listed = await mcpHost.start(s.id);
          retry.delete(s.id); started.push(s.id);
          out.push({ id: s.id, state: 'CONNECTED', tools: listed.map(t => t.name) });
        } catch (error) {
          const text = String(error?.message || error).split('\n')[0].slice(0, 200);
          const attempts = (retry.get(s.id)?.attempts || 0) + 1;
          retry.set(s.id, { attempts, error: text, nextTry: now() + Math.min(RETRY_MAX_MS, RETRY_FROM_MS * 2 ** (attempts - 1)) });
          failed.push({ id: s.id, error: text });
          out.push({ id: s.id, state: 'UNREACHABLE', tools: [], error: text, attempts, remedy: remedyFor(text) });
        }
      }));
    }
    if (started.length || failed.length) { try { onToolsStarted({ started, failed }); } catch {} }
    return out;
  }

  async function run() {
    registry.ensureDefaults({ refreshExisting: false });
    for (const [id, baseUrl] of [['litert', env.JACO_LITERT_URL || 'http://127.0.0.1:9379/v1'], ['llamacpp', env.JACO_LLAMACPP_URL || 'http://127.0.0.1:9380/v1']]) {
      if (!registry.providers.has(id)) registry.register({ id, baseUrl, defaultModel: '' });
    }
    const [providers, tools] = await Promise.all([
      Promise.all(registry.list().map(async p => {
        const host = new URL(p.baseUrl).hostname;
        const local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
        if (!local && !p.credentialConfigured && p.apiKeyEnv) return { id: p.id, state: 'NO_KEY' };
        const result = await registry.probe(p.id);
        const models = (result.models || []).filter(m => !/embed|rerank|whisper|tts|image|moderation/i.test(m));
        // Keep an explicit operator choice; automatic defaults are adopted only when no model was chosen.
        if (result.ok && models.length && !p.defaultModel) registry.register({ ...p, defaultModel: models[0] });
        return { id: p.id, state: result.ok ? (models.length ? 'MODELS_AVAILABLE' : 'NO_CHAT_MODELS') : 'UNREACHABLE', models, toolCapability: 'UNTESTED' };
      })),
      connectTools(),
    ]);
    const problems = tools.filter(t => ['UNREACHABLE', 'RETRY_LATER', 'INVALID'].includes(t.state)).map(t => ({ kind: 'tool', id: t.id, state: t.state, error: t.error, remedy: t.remedy }));
    receipt = { observedAt: new Date(now()).toISOString(), providers, tools, problems, ok: problems.length === 0 && providers.some(p => p.state === 'MODELS_AVAILABLE') };
    at = now();
    return receipt;
  }
  return {
    snapshot: () => receipt,
    refresh: ({ force = false } = {}) => {
      if (inFlight) return inFlight;
      if (!force && now() - at < 30000) return Promise.resolve(receipt);
      inFlight = run().finally(() => { inFlight = null; }); return inFlight;
    },
  };
}
