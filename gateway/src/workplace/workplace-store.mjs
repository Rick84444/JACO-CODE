import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { privateContent } from './private-content.mjs';

const nowIso = () => new Date().toISOString();
const json = value => JSON.stringify(value ?? null);
const parse = (value, fallback = null) => {
  try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; }
};
const id = prefix => `${prefix}:${crypto.randomUUID()}`;
const slug = value => String(value || 'agent').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'agent';

export const WORKPLACE_EVENT_KINDS = Object.freeze([
  'MESSAGE', 'QUESTION', 'ANSWER', 'MISSION', 'CLAIM', 'PROGRESS', 'RESULT',
  'FINDING', 'DECISION', 'PROPOSAL', 'ERROR', 'WARNING', 'ARTIFACT',
  'HANDOFF', 'HEARTBEAT', 'STATUS'
]);

// Lifecycle: REGISTERED -> SYNCED (ack reaches the log head seen at registration) -> READY (STATUS READY).
// Only these kinds may be posted before READY; everything else is work and needs a synchronized session.
const PRE_READY_KINDS = Object.freeze(['STATUS', 'HEARTBEAT']);
const WORKING_STATES = Object.freeze(['READY', 'AVAILABLE', 'BUSY']);
const HEARTBEAT_STATES = Object.freeze(['READY', 'AVAILABLE', 'BUSY', 'DEGRADED_UNSYNCED']);
export const RESULT_STATES = Object.freeze(['DONE', 'PARTIAL', 'BLOCKED', 'FAILED', 'UNVERIFIED']);

// Permissions are server policy. An Agent Card describes capabilities; it never grants authority.
export const DEFAULT_PERMISSIONS = Object.freeze({
  'workplace.read': true,
  'workplace.post': true,
  'workplace.claim': true,
  'decision.publish': true,
  // Mission creation is a normal autonomous coordination capability. External
  // deployment remains separately gated by deployment.execute.
  'mission.create': true,
  'deployment.execute': true
});
const KIND_PERMISSION = Object.freeze({ MISSION: 'mission.create', DECISION: 'decision.publish', CLAIM: 'workplace.claim' });

const hashToken = token => crypto.createHash('sha256').update(String(token)).digest();

export const WORKPLACE_POLICIES = Object.freeze([
  'truthful-capabilities',
  'sync-before-work',
  'claim-before-shared-mutation',
  'decision-awareness',
  'evidence-before-done',
  'handoff-on-exit',
  'no-false-coordination'
]);

function requireObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value;
}

function normalizeAgentCard(card) {
  requireObject(card, 'AGENT_CARD_REQUIRED');
  if (card.schema !== 'jaco.agent-card/v1') throw new Error('AGENT_CARD_SCHEMA_UNSUPPORTED');
  const identity = requireObject(card.identity, 'AGENT_IDENTITY_REQUIRED');
  const requestedName = String(identity.requested_name || '').trim();
  if (!requestedName) throw new Error('AGENT_NAME_REQUIRED');
  return {
    ...card,
    identity: {
      ...identity,
      requested_name: requestedName,
      provider: String(identity.provider || 'unknown'),
      model: identity.model == null ? 'unknown' : String(identity.model),
      agent_type: String(identity.agent_type || 'other')
    },
    capabilities: requireObject(card.capabilities || {}, 'AGENT_CAPABILITIES_REQUIRED'),
    constraints: Array.isArray(card.constraints) ? card.constraints : [],
    preferred_tasks: Array.isArray(card.preferred_tasks) ? card.preferred_tasks : [],
    communication: requireObject(card.communication || {}, 'AGENT_COMMUNICATION_REQUIRED')
  };
}

function agentKey(card) {
  const explicit = card.identity?.stable_id || card.identity?.agent_key;
  if (explicit) return slug(explicit);
  return [card.identity.provider, card.identity.agent_type, card.identity.requested_name].map(slug).join(':');
}

function hydrateAgent(row, codec) {
  if (!row) return null;
  return {
    agentId: row.id,
    agentKey: row.agent_key,
    requestedName: row.requested_name,
    provider: row.provider,
    model: row.model,
    agentType: row.agent_type,
    card: parse(codec.open(row.card_json), {}),
    status: row.status,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at
  };
}

function hydrateSession(row) {
  if (!row) return null;
  return {
    sessionId: row.id,
    agentId: row.agent_id,
    environment: row.environment,
    sandboxed: Boolean(row.sandboxed),
    status: row.status,
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at,
    endedAt: row.ended_at
  };
}

function hydrateEvent(row, codec) {
  return {
    seq: Number(row.seq),
    eventId: row.event_id,
    workspace: row.workspace,
    thread: row.thread,
    kind: row.kind,
    sender: { agentId: row.sender_agent_id, sessionId: row.sender_session_id },
    targets: parse(row.targets_json, ['*']),
    body: codec.open(row.body),
    payload: parse(codec.open(row.payload_json), {}),
    references: parse(codec.open(row.references_json), {}),
    missionId: row.mission_id,
    createdAt: row.created_at
  };
}

function hydrateClaim(row) {
  if (!row) return null;
  return {
    claimId: row.id,
    workspace: row.workspace,
    resource: row.resource,
    agentId: row.agent_id,
    sessionId: row.session_id,
    intent: row.intent,
    status: row.status,
    acquiredAt: row.acquired_at,
    expiresAt: row.expires_at,
    releasedAt: row.released_at
  };
}

export class WorkplaceStore extends EventEmitter {
  constructor(workspaceRoot = process.cwd(), options = {}) {
    super();
    this.workspaceRoot = workspaceRoot;
    this.stateDir = options.stateDir || path.join(workspaceRoot, '.jaco', 'workplace');
    fs.mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
    this.codec = privateContent(this.stateDir);
    this.dbPath = options.dbPath || path.join(this.stateDir, 'workplace.sqlite');
    this.staleAfterMs = Number(options.staleAfterMs ?? process.env.JACO_WORKPLACE_STALE_AFTER_MS ?? 180_000);
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        agent_key TEXT NOT NULL UNIQUE,
        requested_name TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        agent_type TEXT NOT NULL,
        card_json TEXT NOT NULL,
        status TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        environment TEXT NOT NULL,
        sandboxed INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        ended_at TEXT,
        FOREIGN KEY(agent_id) REFERENCES agents(id)
      );
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        workspace TEXT NOT NULL,
        thread TEXT NOT NULL,
        kind TEXT NOT NULL,
        sender_agent_id TEXT NOT NULL,
        sender_session_id TEXT NOT NULL,
        targets_json TEXT NOT NULL,
        body TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        references_json TEXT NOT NULL,
        mission_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(sender_agent_id) REFERENCES agents(id),
        FOREIGN KEY(sender_session_id) REFERENCES sessions(id)
      );
      CREATE TABLE IF NOT EXISTS cursors (
        session_id TEXT NOT NULL,
        workspace TEXT NOT NULL,
        last_seq INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(session_id, workspace),
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      );
      CREATE TABLE IF NOT EXISTS claims (
        id TEXT PRIMARY KEY,
        workspace TEXT NOT NULL,
        resource TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        intent TEXT NOT NULL,
        status TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        released_at TEXT,
        FOREIGN KEY(agent_id) REFERENCES agents(id),
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_events_workspace_seq ON events(workspace, seq);
      CREATE INDEX IF NOT EXISTS idx_events_thread_seq ON events(workspace, thread, seq);
      CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_claims_resource ON claims(workspace, resource, status, expires_at);
    `);
    this.addColumn('sessions', 'token_hash', 'TEXT');
    this.addColumn('sessions', 'required_seq', 'INTEGER NOT NULL DEFAULT 0');
    this.migratePrivateContent();
    this.addColumn('agents', 'permissions_json', 'TEXT');
  }

  addColumn(table, column, definition) {
    const exists = this.db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
    if (!exists) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  permissions(agentId) {
    const row = this.db.prepare('SELECT permissions_json FROM agents WHERE id=?').get(String(agentId));
    return { ...DEFAULT_PERMISSIONS, ...parse(row?.permissions_json, {}) };
  }

  setPermissions(agentId, changes = {}) {
    if (!this.getAgent(agentId)) throw new Error('AGENT_NOT_FOUND');
    const next = this.permissions(agentId);
    for (const [key, value] of Object.entries(requireObject(changes, 'PERMISSIONS_REQUIRED'))) {
      if (!(key in DEFAULT_PERMISSIONS)) throw new Error('PERMISSION_UNSUPPORTED');
      if (typeof value !== 'boolean') throw new Error('PERMISSION_VALUE_REQUIRED');
      next[key] = value;
    }
    this.db.prepare('UPDATE agents SET permissions_json=? WHERE id=?').run(json(next), String(agentId));
    return { agentId: String(agentId), permissions: next };
  }

  close() { try { this.db.close(); } catch {} }

  migratePrivateContent() {
    // Transactional migration, then remove plaintext free pages/WAL from this DB.
    let changed = false;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const [table, key, columns] of [['agents','id',['card_json']],['events','seq',['body','payload_json','references_json']]]) {
        for (const row of this.db.prepare('SELECT * FROM ' + table).all()) {
          for (const column of columns) {
            if (this.codec.encrypted(row[column])) { this.codec.open(row[column]); continue; }
            this.db.prepare('UPDATE ' + table + ' SET ' + column + '=? WHERE ' + key + '=?').run(this.codec.seal(row[column]), row[key]); changed = true;
          }
        }
      }
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); this.db.close(); throw e; }
    if (changed) { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);'); }
    fs.writeFileSync(path.join(this.stateDir, 'content.encrypted'), 'jaco.workplace-content/v1', {mode:0o600});
  }

  overview({workspace='JACO'}={}) {
    const memory = this.db.prepare("SELECT * FROM events WHERE workspace=? AND kind IN ('DECISION','HANDOFF','FINDING') ORDER BY seq DESC LIMIT 100").all(String(workspace))
      .map(row => hydrateEvent(row, this.codec)).filter(event => event.targets.includes('*')).slice(0,30);
    return {agents:this.listAgents(), memory, memoryState:{owner:'Workplace',storage:'local-encrypted-content',transport:'authenticated-hub',git:false,latestSeq:Number(this.db.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM events WHERE workspace=?').get(String(workspace)).n)}};
  }

  getAgent(agentId) {
    return hydrateAgent(this.db.prepare('SELECT * FROM agents WHERE id=?').get(String(agentId)), this.codec);
  }

  getSession(sessionId) {
    return hydrateSession(this.db.prepare('SELECT * FROM sessions WHERE id=?').get(String(sessionId)));
  }

  // A session id is visible to other agents; only the token returned at registration proves ownership.
  assertSession(sessionId, sessionToken) {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id=?').get(String(sessionId));
    if (!row) throw new Error('SESSION_NOT_REGISTERED');
    if (!row.token_hash || !sessionToken) throw new Error('SESSION_TOKEN_INVALID');
    const expected = Buffer.from(row.token_hash, 'hex');
    const actual = hashToken(sessionToken);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) throw new Error('SESSION_TOKEN_INVALID');
    const session = hydrateSession(row);
    if (session.status === 'ENDED') throw new Error('SESSION_ENDED');
    session.requiredSeq = Number(row.required_seq || 0);
    return session;
  }

  assertWorking(session) {
    if (!WORKING_STATES.includes(session.status)) {
      const error = new Error('SESSION_NOT_READY');
      error.state = session.status;
      throw error;
    }
  }

  registerAgent(rawCard, { workspace = 'JACO' } = {}) {
    const card = normalizeAgentCard(rawCard);
    const key = agentKey(card);
    const ts = nowIso();
    let row = this.db.prepare('SELECT * FROM agents WHERE agent_key=?').get(key);
    let agentId;
    if (row) {
      agentId = row.id;
      this.db.prepare(`UPDATE agents SET requested_name=?,provider=?,model=?,agent_type=?,card_json=?,status='ONLINE',last_seen_at=? WHERE id=?`)
        .run(card.identity.requested_name, card.identity.provider, card.identity.model, card.identity.agent_type, this.codec.seal(json(card)), ts, agentId);
    } else {
      agentId = `agent:${slug(card.identity.requested_name)}:${crypto.randomBytes(4).toString('hex')}`;
      this.db.prepare(`INSERT INTO agents(id,agent_key,requested_name,provider,model,agent_type,card_json,status,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
        .run(agentId, key, card.identity.requested_name, card.identity.provider, card.identity.model, card.identity.agent_type, this.codec.seal(json(card)), 'ONLINE', ts, ts);
    }

    const sessionId = id('session');
    const sessionToken = `wps_${crypto.randomBytes(32).toString('base64url')}`;
    const environment = String(card.session?.environment || 'unknown');
    const sandboxed = card.session?.sandboxed ? 1 : 0;
    const latestSeq = Number(this.db.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM events WHERE workspace=?').get(String(workspace))?.n || 0);
    this.db.prepare(`INSERT INTO sessions(id,agent_id,environment,sandboxed,status,started_at,last_seen_at,token_hash,required_seq) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(sessionId, agentId, environment, sandboxed, 'REGISTERED', ts, ts, hashToken(sessionToken).toString('hex'), latestSeq);
    this.db.prepare(`INSERT INTO cursors(session_id,workspace,last_seq,updated_at) VALUES(?,?,0,?)`).run(sessionId, String(workspace), ts);

    return {
      status: 'REGISTERED',
      agentId,
      sessionId,
      sessionToken,
      workspace: String(workspace),
      cursor: 0,
      latestSeq,
      syncUntilCursor: latestSeq,
      requiredSync: true,
      permissions: this.permissions(agentId),
      capabilitiesVerified: false,
      policies: [...WORKPLACE_POLICIES]
    };
  }

  listAgents({ includeEndedSessions = false } = {}) {
    const agents = this.db.prepare('SELECT * FROM agents ORDER BY last_seen_at DESC').all().map(row => hydrateAgent(row, this.codec));
    // A process that died without ending its session stops heartbeating; report it OFFLINE instead of its last state.
    const staleBefore = Date.now() - this.staleAfterMs;
    const sessions = this.db.prepare(`SELECT * FROM sessions ${includeEndedSessions ? '' : "WHERE status!='ENDED'"} ORDER BY started_at DESC`).all().map(hydrateSession)
      .map(s => (s.status !== 'ENDED' && Date.parse(s.lastSeenAt) < staleBefore ? { ...s, recordedStatus: s.status, status: 'OFFLINE' } : s));
    return agents.map(agent => ({
      ...agent,
      // Capability advertisement lives in Agent Card; permissions are the
      // runtime authority granted by Workplace. Expose only booleans here —
      // never session tokens or token hashes.
      permissions: this.permissions(agent.agentId),
      sessions: sessions.filter(s => s.agentId === agent.agentId),
    }));
  }

  postEvent({ sessionId, sessionToken, workspace = 'JACO', thread = 'general', kind = 'MESSAGE', targets = ['*'], body = '', payload = {}, references = {}, missionId = null, eventId = null } = {}, { session: trusted = null } = {}) {
    const session = trusted || this.assertSession(sessionId, sessionToken);
    const normalizedKind = String(kind || 'MESSAGE').toUpperCase();
    if (!WORKPLACE_EVENT_KINDS.includes(normalizedKind)) throw new Error('EVENT_KIND_UNSUPPORTED');
    const data = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const permissions = this.permissions(session.agentId);
    if (!permissions['workplace.post']) throw Object.assign(new Error('PERMISSION_DENIED'), { permission: 'workplace.post' });
    const needed = KIND_PERMISSION[normalizedKind];
    if (needed && !permissions[needed]) throw Object.assign(new Error('PERMISSION_DENIED'), { permission: needed });
    if (!trusted && !PRE_READY_KINDS.includes(normalizedKind)) this.assertWorking(session);

    let nextStatus = null;
    if (normalizedKind === 'STATUS') {
      if (!HEARTBEAT_STATES.includes(data.status)) throw new Error('STATUS_VALUE_UNSUPPORTED');
      nextStatus = data.status;
    }
    if (normalizedKind === 'HEARTBEAT' && data.status !== undefined && !HEARTBEAT_STATES.includes(data.status)) throw new Error('STATUS_VALUE_UNSUPPORTED');
    if ((normalizedKind === 'PROGRESS' || normalizedKind === 'RESULT') && missionId == null) throw new Error('MISSION_ID_REQUIRED');
    if (normalizedKind === 'RESULT') {
      if (!RESULT_STATES.includes(data.status)) throw new Error('RESULT_STATUS_UNSUPPORTED');
      const evidence = data.evidence;
      if (data.status === 'DONE' && !(evidence && typeof evidence === 'object' && Object.keys(evidence).length)) throw new Error('EVIDENCE_REQUIRED_FOR_DONE');
    }

    // A caller-chosen event id makes retries safe: the same sender gets the original event back.
    const requestedId = eventId == null ? null : String(eventId).trim().slice(0, 160);
    if (requestedId) {
      const prior = this.db.prepare('SELECT * FROM events WHERE event_id=?').get(requestedId);
      if (prior) {
        if (prior.sender_agent_id !== session.agentId || prior.kind !== normalizedKind) throw new Error('EVENT_ID_CONFLICT');
        return { ...hydrateEvent(prior, this.codec), duplicate: true };
      }
    }

    const normalizedTargets = Array.isArray(targets) && targets.length ? [...new Set(targets.map(String))] : ['*'];
    const finalId = requestedId || id('event');
    const ts = nowIso();
    const result = this.db.prepare(`INSERT INTO events(event_id,workspace,thread,kind,sender_agent_id,sender_session_id,targets_json,body,payload_json,references_json,mission_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(finalId, String(workspace), String(thread || 'general'), normalizedKind, session.agentId, session.sessionId, json(normalizedTargets), this.codec.seal(String(body || '')), this.codec.seal(json(data)), this.codec.seal(json(references)), missionId == null ? null : String(missionId), ts);
    if (nextStatus) this.db.prepare('UPDATE sessions SET status=?,last_seen_at=? WHERE id=?').run(nextStatus, ts, session.sessionId);
    else this.db.prepare('UPDATE sessions SET last_seen_at=? WHERE id=?').run(ts, session.sessionId);
    this.db.prepare("UPDATE agents SET status='ONLINE',last_seen_at=? WHERE id=?").run(ts, session.agentId);
    const event = hydrateEvent(this.db.prepare('SELECT * FROM events WHERE seq=?').get(Number(result.lastInsertRowid)), this.codec);
    this.emit('event', event);
    return { ...event, duplicate: false };
  }

  sync({ sessionId, sessionToken, workspace = 'JACO', after = null, limit = 500 } = {}) {
    const session = this.assertSession(sessionId, sessionToken);
    const cursorRow = this.db.prepare('SELECT last_seq FROM cursors WHERE session_id=? AND workspace=?').get(sessionId, String(workspace));
    const start = after == null ? Number(cursorRow?.last_seq || 0) : Math.max(0, Number(after) || 0);
    const bounded = Math.max(1, Math.min(2000, Number(limit) || 500));
    const rows = this.db.prepare('SELECT * FROM events WHERE workspace=? AND seq>? ORDER BY seq ASC LIMIT ?').all(String(workspace), start, bounded);
    const scannedCursor = rows.length ? Number(rows.at(-1).seq) : start;
    const events = rows.map(row => hydrateEvent(row, this.codec)).filter(event => {
      const targets = event.targets || ['*'];
      return targets.includes('*') || targets.includes(session.agentId) || event.sender.agentId === session.agentId;
    });
    const activeClaims = this.listClaims({ workspace, activeOnly: true });
    const decisions = this.db.prepare("SELECT * FROM events WHERE workspace=? AND kind='DECISION' ORDER BY seq DESC LIMIT 50").all(String(workspace)).map(row => hydrateEvent(row, this.codec)).filter(event => event.targets.includes('*') || event.targets.includes(session.agentId) || event.sender.agentId === session.agentId).reverse();
    this.db.prepare('UPDATE sessions SET last_seen_at=? WHERE id=?').run(nowIso(), sessionId);
    return {
      status: 'SYNCED',
      agentId: session.agentId,
      sessionId,
      workspace: String(workspace),
      fromCursor: start,
      scannedCursor,
      events,
      decisions,
      activeClaims,
      syncUntilCursor: session.requiredSeq
    };
  }

  ack({ sessionId, sessionToken, workspace = 'JACO', cursor } = {}) {
    const session = this.assertSession(sessionId, sessionToken);
    const requested = Math.max(0, Number(cursor) || 0);
    const max = Number(this.db.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM events WHERE workspace=?').get(String(workspace))?.n || 0);
    if (requested > max) throw new Error('CURSOR_AHEAD_OF_LOG');
    const current = Number(this.db.prepare('SELECT last_seq FROM cursors WHERE session_id=? AND workspace=?').get(sessionId, String(workspace))?.last_seq || 0);
    const next = Math.max(current, requested);
    this.db.prepare(`INSERT INTO cursors(session_id,workspace,last_seq,updated_at) VALUES(?,?,?,?) ON CONFLICT(session_id,workspace) DO UPDATE SET last_seq=excluded.last_seq,updated_at=excluded.updated_at`)
      .run(sessionId, String(workspace), next, nowIso());
    let sessionStatus = session.status;
    if (['REGISTERED', 'DEGRADED_UNSYNCED'].includes(session.status)) {
      this.db.prepare("UPDATE sessions SET status='SYNCED' WHERE id=?").run(sessionId);
      sessionStatus = 'SYNCED';
    }
    return { status: 'ACKNOWLEDGED', sessionId, workspace: String(workspace), cursor: next, sessionStatus };
  }

  purgeExpiredClaims() {
    const ts = nowIso();
    const expired = this.db.prepare("SELECT * FROM claims WHERE status='ACTIVE' AND expires_at<=?").all(ts);
    if (expired.length) this.db.prepare("UPDATE claims SET status='EXPIRED',released_at=? WHERE status='ACTIVE' AND expires_at<=?").run(ts, ts);
    return expired.length;
  }

  listClaims({ workspace = 'JACO', activeOnly = true } = {}) {
    this.purgeExpiredClaims();
    const sql = `SELECT * FROM claims WHERE workspace=? ${activeOnly ? "AND status='ACTIVE'" : ''} ORDER BY acquired_at DESC`;
    return this.db.prepare(sql).all(String(workspace)).map(hydrateClaim);
  }

  claim({ sessionId, sessionToken, workspace = 'JACO', resource, intent = '', leaseSeconds = 900 } = {}) {
    const session = this.assertSession(sessionId, sessionToken);
    this.assertWorking(session);
    if (!this.permissions(session.agentId)['workplace.claim']) throw Object.assign(new Error('PERMISSION_DENIED'), { permission: 'workplace.claim' });
    const normalizedResource = String(resource || '').trim().replace(/\\/g, '/');
    if (!normalizedResource) throw new Error('CLAIM_RESOURCE_REQUIRED');
    this.purgeExpiredClaims();
    const existing = this.db.prepare("SELECT * FROM claims WHERE workspace=? AND resource=? AND status='ACTIVE' AND expires_at>?").get(String(workspace), normalizedResource, nowIso());
    if (existing && existing.session_id !== sessionId) {
      const error = new Error('RESOURCE_ALREADY_CLAIMED');
      error.claim = hydrateClaim(existing);
      throw error;
    }
    if (existing) return hydrateClaim(existing);
    const seconds = Math.max(30, Math.min(86400, Number(leaseSeconds) || 900));
    const claimId = id('claim');
    const acquiredAt = nowIso();
    const expiresAt = new Date(Date.now() + seconds * 1000).toISOString();
    this.db.prepare(`INSERT INTO claims(id,workspace,resource,agent_id,session_id,intent,status,acquired_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(claimId, String(workspace), normalizedResource, session.agentId, sessionId, String(intent || ''), 'ACTIVE', acquiredAt, expiresAt);
    const claim = hydrateClaim(this.db.prepare('SELECT * FROM claims WHERE id=?').get(claimId));
    this.postEvent({ sessionId, workspace, thread: 'claims', kind: 'CLAIM', body: `${normalizedResource} claimed`, payload: claim }, { session });
    return claim;
  }

  releaseClaim({ sessionId, sessionToken, claimId } = {}) {
    const session = this.assertSession(sessionId, sessionToken);
    const row = this.db.prepare('SELECT * FROM claims WHERE id=?').get(String(claimId));
    if (!row) throw new Error('CLAIM_NOT_FOUND');
    if (row.session_id !== sessionId && row.agent_id !== session.agentId) throw new Error('CLAIM_OWNER_MISMATCH');
    const ts = nowIso();
    this.db.prepare("UPDATE claims SET status='RELEASED',released_at=? WHERE id=?").run(ts, row.id);
    return hydrateClaim(this.db.prepare('SELECT * FROM claims WHERE id=?').get(row.id));
  }

  heartbeat({ sessionId, sessionToken, status = 'READY', workspace = 'JACO', activeMission = null } = {}) {
    const session = this.assertSession(sessionId, sessionToken);
    if (!HEARTBEAT_STATES.includes(status)) throw new Error('STATUS_VALUE_UNSUPPORTED');
    const ts = nowIso();
    this.db.prepare('UPDATE sessions SET status=?,last_seen_at=? WHERE id=?').run(String(status), ts, sessionId);
    this.db.prepare("UPDATE agents SET status='ONLINE',last_seen_at=? WHERE id=?").run(ts, session.agentId);
    return { status: String(status), agentId: session.agentId, sessionId, workspace: String(workspace), activeMission, at: ts };
  }

  endSession({ sessionId, sessionToken, workspace = 'JACO', handoff = null } = {}) {
    const session = this.assertSession(sessionId, sessionToken);
    if (typeof handoff === 'string') handoff = {body:handoff};
    if (handoff) this.postEvent({ sessionId, workspace, thread: handoff.thread || 'handoff', kind: 'HANDOFF', body: handoff.body || 'Session handoff', payload: handoff }, { session });
    const ts = nowIso();
    this.db.prepare("UPDATE sessions SET status='ENDED',ended_at=?,last_seen_at=? WHERE id=?").run(ts, ts, sessionId);
    this.db.prepare("UPDATE claims SET status='RELEASED',released_at=? WHERE session_id=? AND status='ACTIVE'").run(ts, sessionId);
    const active = Number(this.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE agent_id=? AND status!='ENDED'").get(session.agentId)?.n || 0);
    if (!active) this.db.prepare("UPDATE agents SET status='OFFLINE',last_seen_at=? WHERE id=?").run(ts, session.agentId);
    return { status: 'ENDED', agentId: session.agentId, sessionId, at: ts };
  }
}
