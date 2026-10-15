// Joins JACO Workplace at process start: register -> sync -> ack -> STATUS READY.
// Contract: JACO_AGENT_BOOTSTRAP.md. A process that is not READY must not use JACO tools
// unless the operator explicitly sets JACO_WORKPLACE_REQUIRED=0.

import { bootstrapJacoAgent } from '../../gateway/src/workplace/workplace-client.mjs';

export function buildAgentCard({ stableId, name, agentType, role, description, environment = 'jaco-runtime', capabilities = {}, tools = [], constraints = [], preferredTasks = [], version = 'unknown' }) {
  return {
    schema: 'jaco.agent-card/v1',
    identity: { stable_id: stableId, requested_name: name, provider: 'local', model: 'unknown', agent_type: agentType },
    session: { environment, persistent: true, sandboxed: false },
    role: { primary: role, description },
    capabilities: { ...capabilities, tools },
    constraints,
    preferred_tasks: preferredTasks,
    communication: { can_receive_messages: true, can_receive_missions: true, can_be_mentioned: true },
    runtime: { started_at: new Date().toISOString(), version, pid: process.pid }
  };
}

export async function joinWorkplace({
  card,
  log = () => {},
  env = process.env,
  bootstrap = bootstrapJacoAgent,
  heartbeatMs = 60_000,
  syncMs = null,
  onEvents = null,
  disabled = 'JACO tools stay disabled'
}) {
  const required = env.JACO_WORKPLACE_REQUIRED !== '0';
  // A locally supervised agent can receive missions from a remote Hub while
  // maintaining a strictly authenticated session with its local Workplace.
  // Only explicit local supervision overrides the standard joined-device route.
  const linked = env.JACO_WORKPLACE_SCOPE !== 'local' && Boolean(env.JACO_HUB_URL && env.JACO_DEVICE_KEY);
  const baseUrl = linked ? String(env.JACO_HUB_URL).replace(/\/+$/, '') + '/v1/device/workplace' : env.JACO_WORKPLACE_URL || '';
  if (linked) { const u=new URL(baseUrl); if (u.protocol!=='https:' && !['127.0.0.1','localhost','::1'].includes(u.hostname)) throw Error('WORKPLACE_HUB_HTTPS_REQUIRED'); }
  const liveSyncMs = Math.max(250, Math.min(Number(syncMs ?? env.JACO_WORKPLACE_SYNC_MS ?? 2_000) || 2_000, 60_000));
  let heartbeatTimer = null;
  let syncTimer = null;
  let syncing = false;
  const remember = events => {
    for (const event of events) {
      if (!['DECISION','HANDOFF','FINDING'].includes(event.kind)) continue;
      const record={eventId:event.eventId,kind:event.kind,body:event.body,at:event.createdAt,agentId:event.sender?.agentId,verification:event.payload?.status || 'UNVERIFIED'};
      session.memory = [...session.memory.filter(e => e.eventId !== record.eventId),record].slice(-100);
    }
  };

  const session = {
    memory: [],
    recall() { return this.memory.map(record => structuredClone(record)); },
    state: 'DEGRADED_UNSYNCED',
    required,
    client: null,
    registration: null,
    error: null,
    lastSyncAt: null,
    lastEventSeq: 0,
    activity: { status: 'READY', activeMission: null },
    async setActivity(status, activeMission = null) {
      this.activity = { status, activeMission };
      if (this.client && this.allowed) await this.client.heartbeat(this.activity);
    },
    get allowed() { return this.state === 'READY' || !this.required; },
    async syncNow() {
      if (!this.client?.sessionId || syncing) return null;
      syncing = true;
      try {
        const page = await this.client.sync();
        const events = Array.isArray(page.events) ? page.events : [];
        remember(events);
        if (events.length && typeof onEvents === 'function') {
          // Process before ACK so a failed handler is retried instead of silently losing work.
          await onEvents(events, page, session);
        }
        if (Number(page.scannedCursor || 0) > Number(this.client.cursor || 0)) {
          await this.client.ack(page.scannedCursor);
        }
        session.lastSyncAt = new Date().toISOString();
        session.lastEventSeq = Number(page.scannedCursor || session.lastEventSeq || 0);
        if (session.state !== 'READY') {
          await this.client.heartbeat({ status: 'READY' });
          session.state = 'READY';
          session.error = null;
          log('ok', 'Workplace live sync restored');
        }
        return page;
      } catch (error) {
        session.error = error.message;
        // Transport/sync failures mean the agent is no longer current with the control plane.
        if (/WORKPLACE_|fetch|ECONN|HTTP_|SESSION_|SYNC_|CURSOR_/i.test(String(error?.message || ''))) {
          session.state = 'DEGRADED_UNSYNCED';
          log('warn', `DEGRADED_UNSYNCED: Workplace live sync failed: ${error.message}`);
        } else {
          // Handler failures are retried without ACK; keep the connection state truthful.
          log('error', `Workplace event handling failed; event remains unacknowledged: ${error.message}`);
        }
        return null;
      } finally {
        syncing = false;
      }
    },
    async end(handoff = null) {
      clearInterval(heartbeatTimer);
      clearInterval(syncTimer);
      if (!this.client?.sessionId) return null;
      try { return await this.client.end(handoff); }
      catch (error) { log('warn', `Workplace session end failed: ${error.message}`); return null; }
      finally { this.state = 'OFFLINE'; }
    }
  };

  if (!baseUrl) {
    session.error = 'WORKPLACE_URL_NOT_CONFIGURED';
    log(required ? 'error' : 'warn', `DEGRADED_UNSYNCED: JACO_WORKPLACE_URL is not set${required ? `; ${disabled}` : ''}`);
    return session;
  }

  try {
    const { client, registration, sync } = await bootstrap(card, {
      baseUrl,
      token: linked ? env.JACO_DEVICE_KEY : env.JACO_WORKPLACE_TOKEN || '',
      onEvents: async (events, page) => { remember(events); if (typeof onEvents === 'function') await onEvents(events,page,session); },
    });
    Object.assign(session, {
      client,
      registration,
      state: 'READY',
      lastSyncAt: new Date().toISOString(),
      lastEventSeq: Number(client.cursor || sync.scannedCursor || 0)
    });
    const decisions = (sync.decisions || []).length;
    log('ok', `READY as ${registration.agentId} (${registration.sessionId}), cursor ${client.cursor}, ${sync.events.length} events, ${decisions} decisions`);
  } catch (error) {
    session.error = error.message;
    log(required ? 'error' : 'warn', `DEGRADED_UNSYNCED: ${error.message}${required ? `; ${disabled}` : ''}`);
    return session;
  }

  heartbeatTimer = setInterval(async () => {
    try {
      await session.client.heartbeat(session.state === 'READY' ? session.activity : { status: 'DEGRADED_UNSYNCED' });
    } catch (error) {
      session.state = 'DEGRADED_UNSYNCED';
      session.error = error.message;
      log('warn', `DEGRADED_UNSYNCED: Workplace heartbeat failed: ${error.message}`);
    }
  }, heartbeatMs);
  heartbeatTimer.unref?.();

  syncTimer = setInterval(() => { void session.syncNow(); }, liveSyncMs);
  syncTimer.unref?.();

  return session;
}
