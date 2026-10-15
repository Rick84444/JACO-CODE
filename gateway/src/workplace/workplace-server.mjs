// Match the SEER/Nova entry points: load the installation's .env before
// reading configuration. Explicit launcher environment values take precedence.
import 'dotenv/config';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { WorkplaceStore } from './workplace-store.mjs';
import { createWorkplaceAgentSupervisor } from './workplace-agent-supervisor.mjs';
import { createChatGptGithubRelay } from './chatgpt-github-relay.mjs';

const HOST = process.env.JACO_WORKPLACE_HOST || '127.0.0.1';
const PORT = Number(process.env.JACO_WORKPLACE_PORT || 2995);
const TOKEN = process.env.JACO_WORKPLACE_TOKEN || '';
// Agents share TOKEN to reach the API. Changing permissions needs a separate token that agents never receive.
const OPERATOR_TOKEN = process.env.JACO_WORKPLACE_OPERATOR_TOKEN || '';
const ROOT = resolve(process.env.JACO_WORKSPACE_ROOT || process.cwd());

const isLoopback = host => ['127.0.0.1', 'localhost', '::1'].includes(host);
if (!TOKEN && !isLoopback(HOST)) {
  console.error('JACO Workplace refuses non-loopback binding without JACO_WORKPLACE_TOKEN');
  process.exit(1);
}

const store = new WorkplaceStore(ROOT);
const supervisor = createWorkplaceAgentSupervisor({ root: ROOT, env: process.env });
const chatgptRelay = createChatGptGithubRelay({ store, root: ROOT, env: process.env });
const streams = new Map();

function send(res, status, data, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers
  });
  res.end(JSON.stringify(data));
}

function errorCode(error) {
  const code = String(error?.message || 'INTERNAL_ERROR');
  if (code === 'SYNC_REQUIRED_BEFORE_READY') return 409;
  if (code.includes('REQUIRED') || code.includes('UNSUPPORTED') || code === 'CURSOR_AHEAD_OF_LOG') return 400;
  if (code === 'SESSION_NOT_REGISTERED' || code === 'SESSION_TOKEN_INVALID') return 401;
  if (code === 'PERMISSION_DENIED') return 403;
  if (code === 'AGENT_NOT_FOUND') return 404;
  if (code === 'SESSION_ENDED' || code === 'SESSION_NOT_READY' || code === 'EVENT_ID_CONFLICT') return 409;
  if (code === 'RESOURCE_ALREADY_CLAIMED') return 409;
  if (code === 'CLAIM_NOT_FOUND') return 404;
  if (code === 'CLAIM_OWNER_MISMATCH') return 403;
  return 500;
}

function operatorAuthorized(req) {
  if (OPERATOR_TOKEN.length < 24) return false;
  const got = Buffer.from(String(req.headers['x-jaco-operator-token'] || ''));
  const expected = Buffer.from(OPERATOR_TOKEN);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

function authorized(req) {
  if (!TOKEN) return true;
  return req.headers.authorization === `Bearer ${TOKEN}`;
}

async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) throw new Error('REQUEST_TOO_LARGE');
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('INVALID_JSON'); }
}

function routeKey(req, url) {
  return `${req.method || 'GET'} ${url.pathname}`;
}

// The shared bearer token only reaches the server; the session token proves which agent is calling.
function sessionToken(req, input = {}) {
  return req.headers['x-jaco-session-token'] || input.sessionToken || input.session_token || '';
}

function openStream(req, res, url) {
  const sessionId = url.searchParams.get('session_id');
  if (!sessionId) return send(res, 400, { error: 'SESSION_ID_REQUIRED' });
  let session;
  try { session = store.assertSession(sessionId, req.headers['x-jaco-session-token'] || url.searchParams.get('session_token')); } catch (error) { return send(res, errorCode(error), { error: error.message }); }
  const workspace = url.searchParams.get('workspace') || 'JACO';
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  });
  res.write(`event: ready\ndata: ${JSON.stringify({ status: 'STREAM_READY', agentId: session.agentId, sessionId, workspace })}\n\n`);
  const key = `${sessionId}:${Date.now()}:${Math.random()}`;
  streams.set(key, { res, sessionId, agentId: session.agentId, workspace });
  const timer = setInterval(() => {
    try { res.write(`event: ping\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`); } catch {}
  }, 25_000);
  req.on('close', () => {
    clearInterval(timer);
    streams.delete(key);
  });
}

store.on('event', event => {
  for (const stream of streams.values()) {
    if (stream.workspace !== event.workspace) continue;
    const targets = event.targets || ['*'];
    if (!targets.includes('*') && !targets.includes(stream.agentId) && event.sender.agentId !== stream.agentId) continue;
    try {
      stream.res.write(`id: ${event.seq}\nevent: workplace\ndata: ${JSON.stringify(event)}\n\n`);
    } catch {}
  }
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return send(res, 200, {
      product: 'JACO Workplace',
      schema: 'jaco.workplace/v1',
      status: 'READY',
      transport: ['HTTP', 'SSE'],
      auth: TOKEN ? 'bearer' : 'loopback-local',
      port: server.address()?.port || PORT,
      supervisedAgents: supervisor.snapshot(),
      chatgptRelay: chatgptRelay.status()
    });
  }

  if (!authorized(req)) return send(res, 401, { error: 'UNAUTHORIZED' });
  if (req.method === 'GET' && url.pathname === '/v1/stream') return openStream(req, res, url);

  try {
    const key = routeKey(req, url);
    const input = ['POST', 'PUT', 'PATCH'].includes(req.method || '') ? await body(req) : {};

    if (key === 'POST /v1/linked/register') {
      const card = input.agentCard;
      if (!card?.session?.device || !card?.identity?.stable_id?.startsWith('linked-')) return send(res,400,{error:'LINKED_DEVICE_IDENTITY_REQUIRED'});
      const registration = store.registerAgent(card, {workspace:'JACO'});
      store.setPermissions(registration.agentId, {'workplace.read':true,'workplace.post':true,'workplace.claim':false,'decision.publish':false,'mission.create':false,'deployment.execute':false});
      registration.permissions = store.permissions(registration.agentId);
      return send(res,201,registration);
    }
    if (key === 'POST /v1/register') {
      return send(res, 201, store.registerAgent(input.agentCard ?? input.agent_card, { workspace: input.workspace || 'JACO' }));
    }
    if (key === 'POST /v1/sync') {
      return send(res, 200, store.sync({
        sessionId: input.sessionId ?? input.session_id,
        sessionToken: sessionToken(req, input),
        workspace: input.workspace || 'JACO',
        after: input.after ?? null,
        limit: input.limit ?? 500
      }));
    }
    if (key === 'POST /v1/ack') {
      return send(res, 200, store.ack({
        sessionId: input.sessionId ?? input.session_id,
        sessionToken: sessionToken(req, input),
        workspace: input.workspace || 'JACO',
        cursor: input.cursor
      }));
    }
    if (key === 'POST /v1/events') {
      const event = store.postEvent({
        sessionId: input.sessionId ?? input.session_id,
        sessionToken: sessionToken(req, input),
        workspace: input.workspace || 'JACO',
        thread: input.thread || 'general',
        kind: input.kind || 'MESSAGE',
        targets: input.targets || ['*'],
        body: input.body || '',
        payload: input.payload || {},
        references: input.references || {},
        missionId: input.missionId ?? input.mission_id ?? null,
        eventId: input.eventId ?? input.event_id ?? null
      });
      return send(res, event.duplicate ? 200 : 201, event);
    }
    if (key === 'GET /v1/overview') return send(res, 200, store.overview({workspace:url.searchParams.get('workspace') || 'JACO'}));
    if (key === 'GET /v1/agents') {
      return send(res, 200, { agents: store.listAgents({ includeEndedSessions: url.searchParams.get('all') === '1' }) });
    }
    if (key === 'POST /v1/agents/permissions') {
      if (OPERATOR_TOKEN.length < 24) return send(res, 403, { error: 'OPERATOR_TOKEN_NOT_CONFIGURED' });
      if (!operatorAuthorized(req)) return send(res, 403, { error: 'OPERATOR_TOKEN_REQUIRED' });
      return send(res, 200, store.setPermissions(input.agentId ?? input.agent_id, input.permissions));
    }
    if (key === 'GET /v1/claims') {
      return send(res, 200, { claims: store.listClaims({ workspace: url.searchParams.get('workspace') || 'JACO', activeOnly: url.searchParams.get('all') !== '1' }) });
    }
    if (key === 'POST /v1/claims') {
      return send(res, 201, store.claim({
        sessionId: input.sessionId ?? input.session_id,
        sessionToken: sessionToken(req, input),
        workspace: input.workspace || 'JACO',
        resource: input.resource,
        intent: input.intent || '',
        leaseSeconds: input.leaseSeconds ?? input.lease_seconds ?? 900
      }));
    }
    if (key === 'POST /v1/claims/release') {
      return send(res, 200, store.releaseClaim({
        sessionId: input.sessionId ?? input.session_id,
        sessionToken: sessionToken(req, input),
        claimId: input.claimId ?? input.claim_id
      }));
    }
    if (key === 'POST /v1/heartbeat') {
      return send(res, 200, store.heartbeat({
        sessionId: input.sessionId ?? input.session_id,
        sessionToken: sessionToken(req, input),
        workspace: input.workspace || 'JACO',
        status: input.status || 'READY',
        activeMission: input.activeMission ?? input.active_mission ?? null
      }));
    }
    if (key === 'POST /v1/session/end') {
      return send(res, 200, store.endSession({
        sessionId: input.sessionId ?? input.session_id,
        sessionToken: sessionToken(req, input),
        workspace: input.workspace || 'JACO',
        handoff: input.handoff || null
      }));
    }

    return send(res, 404, { error: 'NOT_FOUND', path: url.pathname });
  } catch (error) {
    const response = { error: String(error?.message || 'INTERNAL_ERROR') };
    if (error?.claim) response.claim = error.claim;
    if (error?.permission) response.permission = error.permission;
    if (error?.state) response.state = error.state;
    return send(res, errorCode(error), response);
  }
});

async function shutdown(signal) {
  console.log(`[JACO Workplace] ${signal} received; shutting down`);
  await chatgptRelay.stop().catch(error => console.error('[JACO Workplace] ChatGPT relay stop failed:', error?.message || error));
  await supervisor.stop().catch(error => console.error('[JACO Workplace] supervisor stop failed:', error?.message || error));
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.listen(PORT, HOST, () => {
  const actualPort = server.address().port;
  const workplaceUrl = `http://${HOST}:${actualPort}`;
  console.log(`[JACO Workplace] READY ${workplaceUrl}`);
  console.log(`[JACO Workplace] DB ${store.dbPath}`);
  console.log(`[JACO Workplace] auth=${TOKEN ? 'bearer' : 'loopback-local'}`);
  void supervisor.start(workplaceUrl);
  void chatgptRelay.start();
});
