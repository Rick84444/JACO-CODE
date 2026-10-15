// JACO Remote Bridge — semantic actuator facade for IDE/remote operation.
//
// This is deliberately not a Chrome Remote Desktop scraper. It gives agents a
// small MCP surface that drives the existing verified runtime surfaces:
//   Remote Bridge -> ModelRelay -> Desktop/Android Hands-Off -> verified receipt
// CDP remains useful for browser DOM work, but Remote Bridge is the safer default
// for whole-app control because completion is tied to runtime receipts.

import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { buildAgentCard, joinWorkplace } from './lib/workplace-session.mjs';

const TOOL_DEFINITIONS = [
  ['remote_status', 'Read runtime, relay and hands-off status', 'GET', '/status', {}],
  ['remote_windows', 'List visible desktop windows through verified UI Automation', 'GET', '/desktop/windows', {}],
  ['remote_observe', 'Observe a desktop window or Android surface without mutation', 'POST', '/observe', {
    surface: { type: 'string' },
    hwnd: { type: 'number', optional: true },
    packageName: { type: 'string', optional: true },
  }],
  ['remote_action', 'Execute one signed semantic action through ModelRelay and return the verified receipt', 'POST', '/action', {
    surface: { type: 'string' },
    missionId: { type: 'string' },
    mandateId: { type: 'string' },
    action: { type: 'object' },
    consequence: { type: 'string', optional: true },
  }],
];

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

function authorized(req, token) {
  const a = Buffer.from(req.headers.authorization || '');
  const b = Buffer.from(`Bearer ${token}`);
  return token.length >= 24 && a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(req, maxBytes = 65_536) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString();
  return raw ? JSON.parse(raw) : {};
}

function validateArgs(definition, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid arguments');
  const schema = definition[4];
  for (const [key, rule] of Object.entries(schema)) {
    if (rule.optional && args[key] === undefined) continue;
    if (rule.type === 'object') {
      if (!args[key] || typeof args[key] !== 'object' || Array.isArray(args[key])) throw new Error(`Invalid ${key}`);
    } else if (typeof args[key] !== rule.type) {
      throw new Error(`Invalid ${key}`);
    }
  }
  for (const key of Object.keys(args)) {
    if (!(key in schema)) throw new Error(`Unexpected argument ${key}`);
  }
}

export function createRemoteBridge({
  token = process.env.JACO_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || '',
  runtime = process.env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000',
  fetchImpl = fetch,
  allowMutations = process.env.JACO_REMOTE_ALLOW_MUTATIONS === '1',
  modelId = process.env.JACO_REMOTE_MODEL_ID || `remote-bridge-${process.pid}`,
} = {}) {
  const runtimeUrl = runtime.replace(/\/$/, '');
  const requestRuntime = async (method, route, body, { mutation = false, timeoutMs = 20_000 } = {}) => {
    try {
      const response = await fetchImpl(`${runtimeUrl}${route}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-gateway-token': token },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      let payload;
      try { payload = text ? JSON.parse(text) : {}; }
      catch { payload = { raw: text.slice(0, 4000) }; }
      if (response.ok && payload?.success !== false && payload?.ok !== false) return payload;
      return {
        ...payload,
        success: false,
        ok: false,
        error: payload?.error || `RUNTIME_HTTP_${response.status}`,
        httpStatus: response.status,
        // 409 is the runtime's canonical "action executed but post-state could not
        // be verified" result. Treat it as unknown, never as a safe retry.
        outcomeUnknown: Boolean(mutation && (
          response.status >= 500 ||
          response.status === 409 ||
          payload?.receipt?.verified === false
        )),
      };
    } catch (error) {
      return {
        success: false,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        transportError: true,
        outcomeUnknown: mutation,
      };
    }
  };

  const handlers = {
    '/status': async () => {
      const [identity, relay, desktop, android, browser] = await Promise.allSettled([
        requestRuntime('GET', '/api/runtime/identity'),
        requestRuntime('GET', '/api/relay/status'),
        requestRuntime('GET', '/api/desktop/hands-off/status'),
        requestRuntime('GET', '/api/hands-off/status'),
        requestRuntime('GET', '/api/browser/hands-off/status'),
      ]);
      const value = result => result.status === 'fulfilled' ? result.value : { success: false, error: String(result.reason) };
      const status = {
        ok: true,
        service: 'jaco-remote-bridge',
        protocol: 'JACO-REMOTE-ACTUATOR/1',
        mutationGate: allowMutations ? 'enabled' : 'disabled',
        runtime: runtimeUrl,
        identity: value(identity),
        relay: value(relay),
        desktop: value(desktop),
        android: value(android),
        browser: value(browser),
      };
      status.ready = Boolean(status.relay?.singleWriter === true && (
        status.desktop?.status?.evidenceState === 'OBSERVED' || status.android?.status?.connected === true
      ));
      return status;
    },
    '/desktop/windows': async () => requestRuntime('GET', '/api/desktop/hands-off/windows'),
    '/observe': async body => {
      const surface = String(body.surface || '').toUpperCase();
      if (surface === 'DESKTOP') return requestRuntime('POST', '/api/desktop/hands-off/observe', body.hwnd ? { hwnd: body.hwnd } : {});
      if (surface === 'ANDROID') return requestRuntime('POST', '/api/nova/traction/android-action', {
        action: {
          type: 'observe_screen',
          ...(body.packageName ? { package_name: body.packageName } : {}),
        },
      });
      return { ok: false, success: false, error: 'surface must be DESKTOP or ANDROID for remote_observe' };
    },
    '/action': async body => {
      const surface = String(body.surface || '').toUpperCase();
      if (!['DESKTOP', 'ANDROID'].includes(surface)) return { ok: false, success: false, error: 'surface must be DESKTOP or ANDROID' };
      if (!allowMutations) return { ok: false, success: false, error: 'REMOTE_MUTATIONS_DISABLED' };
      return requestRuntime('POST', '/api/relay/action', {
        surface,
        modelId,
        missionId: body.missionId,
        mandateId: body.mandateId,
        action: body.action,
        consequence: body.consequence,
      }, { mutation: true, timeoutMs: 35_000 });
    },
  };

  return createServer(async (req, res) => {
    let id = null;
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/health') {
        return json(res, 200, { ok: true, service: 'jaco-remote-bridge', browserVerified: false });
      }
      if (!authorized(req, token)) return json(res, 401, { ok: false, error: 'UNAUTHORIZED' });
      if (req.headers.origin) return json(res, 403, { ok: false, error: 'BROWSER_ORIGIN_DENIED' });

      if (path === '/mcp') {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST_REQUIRED' });
        const msg = await readJson(req);
        id = msg.id ?? null;
        const reply = result => json(res, 200, { jsonrpc: '2.0', id, result });
        const error = (code, message) => json(res, 200, { jsonrpc: '2.0', id, error: { code, message } });
        if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return error(-32600, 'Invalid Request');
        if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
        if (msg.method === 'initialize') return reply({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'jaco-remote', version: '1.0.0' } });
        if (msg.method === 'ping') return reply({});
        if (msg.method === 'tools/list') {
          return reply({ tools: TOOL_DEFINITIONS.map(([name, description, method, route, properties]) => ({
            name,
            description,
            inputSchema: {
              type: 'object',
              properties: Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, { type: value.type }])),
              required: Object.entries(properties).filter(([, value]) => !value.optional).map(([key]) => key),
              additionalProperties: false,
            },
            annotations: { readOnlyHint: method === 'GET' || name === 'remote_observe', openWorldHint: true },
          })) });
        }
        if (msg.method !== 'tools/call') return error(-32601, 'Method not found');
        const definition = TOOL_DEFINITIONS.find(item => item[0] === msg.params?.name);
        if (!definition) return error(-32602, 'Unknown tool');
        const args = msg.params.arguments || {};
        try { validateArgs(definition, args); }
        catch (validationError) { return error(-32602, validationError.message); }
        const result = await handlers[definition[3]](args);
        const failed = result?.ok === false || result?.success === false;
        return reply({ content: [{ type: 'text', text: JSON.stringify(result) }], isError: failed });
      }

      const handler = handlers[path];
      if (!handler) return json(res, 404, { ok: false, error: 'NOT_FOUND' });
      const definition = TOOL_DEFINITIONS.find(item => item[3] === path);
      if (req.method !== definition[2]) return json(res, 405, { ok: false, error: `${definition[2]}_REQUIRED` });
      const body = definition[2] === 'POST' ? await readJson(req) : {};
      return json(res, 200, await handler(body));
    } catch (error) {
      return json(res, 500, { jsonrpc: '2.0', id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if ((process.env.JACO_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || '').length < 24) throw new Error('JACO_GATEWAY_TOKEN_REQUIRED_MIN_24');
  const port = Number(process.env.JACO_REMOTE_BRIDGE_PORT || 2994);
  const server = createRemoteBridge();
  let workplace = { allowed: false };
  server.listen(port, '127.0.0.1', async () => {
    console.log(`JACO Remote Bridge listening on loopback :${port}; /mcp requires Bearer authentication.`);
    workplace = await joinWorkplace({
      card: buildAgentCard({
        stableId: 'remote-bridge',
        name: 'Remote Bridge',
        agentType: 'runtime',
        role: 'semantic-remote-actuator',
        description: 'Authenticated semantic remote actuator facade for Desktop/Android Hands-Off through ModelRelay verified receipts.',
        capabilities: {
          desktop_control: true,
          android_control: true,
          browser_control: false,
          reasoning: false,
          terminal: false,
          filesystem_write: false,
          image_understanding: false,
        },
        tools: ['remote_status', 'remote_windows', 'remote_observe', 'remote_action'],
        constraints: [
          `Runtime: ${process.env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000'}`,
          `Mutations enabled: ${process.env.JACO_REMOTE_ALLOW_MUTATIONS === '1'}`,
          'Mutations must pass ModelRelay, active signed mandate and downstream verified receipt',
          'CDP is not used by this bridge; enable JACO_ENABLE_CDP=1 for browser-DOM automation',
        ],
        preferredTasks: ['whole-app remote operation', 'IDE operation through Desktop AgentOS', 'Android accessibility-backed app control'],
      }),
      log: (level, msg) => console.log(`${level.toUpperCase()} [workplace] ${msg}`),
    });
    if (!workplace.allowed) console.log('ERROR [workplace] Remote Bridge registered but not READY; startup gate will fail closed');
  });
  const stop = async () => { await workplace?.end?.(); process.exit(0); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
