// JACO Connect: an MCP server for connections (operator 2026-10-08: connecting a service should be
// autonomous; when a page is built, the operator signs in or asks for a connection, agents create the
// login and the API key themselves). Any agent with MCP (Nova via JACO's host, Claude Code, ChatGPT)
// can connect a model provider from a URL, store or generate a secret, and ask Nova to create an
// account and an API key on a site. Values go in and never come out: no tool returns a secret.
//
//   node tools/jaco-connect-mcp.mjs                 stdio (newline-delimited JSON-RPC)
//   node tools/jaco-connect-mcp.mjs --http [port]   its own endpoint, POST /mcp on 127.0.0.1 (default
//                                                    2993), Bearer JACO_GATEWAY_TOKEN; put a tunnel in
//                                                    front of it to reach it from outside
import http from 'node:http';
import readline from 'node:readline';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { SecretStore, generateSecretValue, validateSecretName } from '../../agents/lib/secret-store.mjs';
import { listVoices, pickAuraVoice, saveAuraVoice, readAuraVoice, blandConfigured } from '../../agents/lib/bland.mjs';

const RUNTIME = String(process.env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const store = new SecretStore();

async function runtime(method, route, body) {
  const res = await fetch(`${RUNTIME}${route}`, {
    method, headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(90_000),
  }).catch(error => { throw new Error(`JACO runtime unreachable at ${RUNTIME}: ${error?.message || error}`); });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(typeof data.error === 'string' ? data.error : `RUNTIME_HTTP_${res.status}`);
  return data;
}

const text = value => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));
const SERVICE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,60}$/;

const TOOLS = [
  {
    name: 'connect_provider',
    description: 'Connect a model provider from a URL alone (e.g. "deepseek.com", "openrouter.ai", "http://10.0.0.5:8080"). JACO recognises or probes the service, lists its models, picks a default and registers it. Returns state READY, NEEDS_KEY (store the key with store_secret under apiKeyEnv, or ask for an account with request_account), KEY_REJECTED or UNREACHABLE, plus every request tried.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    run: async ({ url }) => {
      const { discovery, provider } = await runtime('POST', '/api/aura/workbench/providers/connect', { url });
      return { ...discovery, registered: Boolean(provider), models: discovery.models.slice(0, 30) };
    },
  },
  {
    name: 'list_connections',
    description: 'The model providers JACO knows, with base URL, default model and whether a key is configured. Read only.',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    run: async () => (await runtime('GET', '/api/aura/workbench')).providers
      .map(p => ({ id: p.id, baseUrl: p.baseUrl, defaultModel: p.defaultModel, apiKeyEnv: p.apiKeyEnv, credentialConfigured: p.credentialConfigured, status: p.status })),
  },
  {
    name: 'store_secret',
    description: 'Store an API key, token or password in JACO\'s encrypted store under an UPPER_SNAKE name (e.g. DEEPSEEK_API_KEY). Write-only: the value is never returned by any tool. Use the name a connect_provider result gives as apiKeyEnv.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' }, purpose: { type: 'string' } }, required: ['name', 'value'] },
    run: ({ name, value, purpose }) => store.set(name, value, { source: 'mcp', purpose }),
  },
  {
    name: 'generate_secret',
    description: 'Create a strong password for an account an agent is about to make and store it under a name (e.g. NOVA_GITHUB_PASSWORD). The value is never returned; agents type it with vault:<name>.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, length: { type: 'integer', minimum: 16, maximum: 64 }, purpose: { type: 'string' } }, required: ['name'] },
    run: ({ name, length, purpose }) => {
      const key = validateSecretName(name);
      if (store.has(key)) return { ...store.describe(key), created: false, note: 'already exists; not replaced' };
      return { ...store.set(key, generateSecretValue(length), { source: 'generated', purpose }), created: true };
    },
  },
  {
    name: 'secret_status',
    description: 'Whether secrets exist, with length and dates, never values. Without a name, lists every stored secret. Read only.',
    readOnly: true,
    inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
    run: ({ name }) => (name ? store.describe(name) : store.list()),
  },
  {
    name: 'phone_voices',
    description: 'Phone voices on Bland AI (key BLAND_API_KEY in the encrypted store), optionally for one language such as "Swedish", with the voice currently chosen for Aura. Read only; no call is made and nothing is spent.',
    readOnly: true,
    inputSchema: { type: 'object', properties: { language: { type: 'string' } } },
    run: async ({ language } = {}) => {
      if (!blandConfigured()) return { configured: false, hint: 'Store the Bland key with store_secret under BLAND_API_KEY.' };
      const voices = await listVoices({ language });
      return { configured: true, auraVoice: readAuraVoice(), count: voices.length, suggested: pickAuraVoice(voices, { language: language || 'Swedish' }), voices: voices.slice(0, 40) };
    },
  },
  {
    name: 'phone_set_aura_voice',
    description: 'Choose the voice Aura speaks with on the phone: a voiceId from phone_voices, or leave it out to take the best match for the language (default Swedish, female, best rated). Local setting only; no call is made. Placing calls is not an agent tool: it needs the operator to confirm the number.',
    inputSchema: { type: 'object', properties: { voiceId: { type: 'string' }, language: { type: 'string' } } },
    run: async ({ voiceId, language = 'Swedish' } = {}) => {
      const voices = await listVoices({});
      const voice = voiceId ? voices.find(v => v.id === voiceId) : pickAuraVoice(voices, { language });
      if (!voice) throw new Error(voiceId ? 'VOICE_NOT_FOUND' : `NO_VOICE_FOR_LANGUAGE:${language}`);
      return { ...saveAuraVoice(voice, { language }), tags: voice.tags };
    },
  },
  {
    name: 'request_account',
    description: 'Ask Nova to create an account on a service and an API key for JACO, autonomously: JACO\'s own e-mail address and inbox for verification, a generated password, the key captured from the page into the encrypted store under keyName, then connect_provider when the service is a model API. Nova stops and asks the operator where a CAPTCHA, phone number, payment card or identity document is required, and never accepts terms that cost money. Returns the mission id; follow it in the IDE (Bygg).',
    inputSchema: { type: 'object', properties: {
      service: { type: 'string', description: 'service name, e.g. "Groq"' },
      url: { type: 'string', description: 'sign-up or console URL' },
      keyName: { type: 'string', description: 'where to store the API key, e.g. GROQ_API_KEY' },
    }, required: ['service', 'url'] },
    run: async ({ service, url, keyName }) => {
      if (!SERVICE.test(String(service || ''))) throw new Error('INVALID_SERVICE_NAME');
      const target = new URL(String(url));
      if (target.protocol !== 'https:') throw new Error('HTTPS_URL_REQUIRED');
      const slug = String(service).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const key = validateSecretName(keyName || `${slug}_API_KEY`);
      const goal = [
        `Skapa ett konto för JACO på ${service} (${target.href}) och en API-nyckel.`,
        `Använd JACOs egen e-postadress enligt state.inbox.addressPattern (jaco-${slug.toLowerCase()}@...) och ett lösenord från vault-generate-secret {key:"NOVA_${slug}_PASSWORD"}; verifiera e-posten med email-inbox.`,
        `Skapa sedan en API-nyckel i tjänstens konsol och spara den med secret-store under ${key}. Skriv aldrig ut nyckeln.`,
        'Stanna och fråga operatören om CAPTCHA, telefonnummer, betalkort eller ID-handling krävs, och godkänn aldrig villkor som kostar pengar.',
      ].join(' ');
      const { mission } = await runtime('POST', '/api/aura/missions', { goal, idempotencyKey: `request-account-${slug.toLowerCase()}-${Date.now()}` });
      return { missionId: mission.id, status: mission.status, keyName: key, follow: 'IDE > Bygg, or GET /api/aura/missions/:id/stream' };
    },
  },
];

async function handle(msg) {
  if (msg?.id === undefined) return null;
  const reply = result => ({ jsonrpc: '2.0', id: msg.id, result });
  if (msg.method === 'initialize') return reply({ protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'jaco-connect', version: '1.0.0' } });
  if (msg.method === 'tools/list') return reply({ tools: TOOLS.map(({ run, readOnly, ...t }) => ({ ...t, annotations: { readOnlyHint: Boolean(readOnly), destructiveHint: false } })) });
  if (msg.method === 'tools/call') {
    const tool = TOOLS.find(t => t.name === msg.params?.name);
    if (!tool) return { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `unknown tool ${msg.params?.name}` } };
    try { return reply({ content: [{ type: 'text', text: text(await tool.run(msg.params?.arguments || {})) }] }); }
    // Errors never echo arguments: a value passed to store_secret must not come back in a message.
    catch (error) { return reply({ isError: true, content: [{ type: 'text', text: String(error?.message || error).split('\n')[0].slice(0, 300) }] }); }
  }
  if (msg.method === 'ping') return reply({});
  return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } };
}

export { TOOLS, handle };

const httpIndex = process.argv.indexOf('--http');
if (httpIndex >= 0) {
  const port = Number(process.argv[httpIndex + 1]) || Number(process.env.JACO_CONNECT_PORT) || 2993;
  const token = String(process.env.JACO_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || '');
  if (token.length < 24) { console.error('JACO_GATEWAY_TOKEN (24+ chars) is required for --http'); process.exit(1); }
  const authorized = header => {
    const given = Buffer.from(String(header || '').replace(/^Bearer\s+/i, ''));
    const want = Buffer.from(token);
    return given.length === want.length && timingSafeEqual(given, want);
  };
  http.createServer((req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const path = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && path === '/health') return send(200, { ok: true, service: 'jaco-connect', tools: TOOLS.length });
    if (path !== '/mcp' || req.method !== 'POST') return send(404, { error: 'NOT_FOUND' });
    if (!authorized(req.headers.authorization)) return send(401, { error: 'UNAUTHORIZED' });
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 64 * 1024) req.destroy(); });
    req.on('end', async () => {
      let msg; try { msg = JSON.parse(body); } catch { return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
      const out = await handle(msg);
      if (!out) { res.writeHead(202); return res.end(); }
      send(200, out);
    });
  }).listen(port, '127.0.0.1', () => console.log(`JACO Connect MCP on http://127.0.0.1:${port}/mcp (Bearer gateway token)`));
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const send = message => process.stdout.write(JSON.stringify(message) + '\n');
  readline.createInterface({ input: process.stdin }).on('line', async line => {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    const out = await handle(msg);
    if (out) send(out);
  });
}
