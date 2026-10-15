import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const nowIso = () => new Date().toISOString();
const id = prefix => `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
const json = value => JSON.stringify(value ?? null);
const parse = (value, fallback = null) => {
  try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; }
};

export class DurableMissionBus {
  constructor(workspaceRoot, options = {}) {
    this.workspaceRoot = workspaceRoot;
    this.stateDir = options.stateDir || path.join(workspaceRoot, '.jaco', 'mission-bus');
    fs.mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
    this.dbPath = options.dbPath || path.join(this.stateDir, 'mission-bus.sqlite');
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS missions (
        id TEXT PRIMARY KEY, goal TEXT NOT NULL, source TEXT NOT NULL,
        status TEXT NOT NULL, metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, parent_ticket_id TEXT,
        capability TEXT NOT NULL, title TEXT NOT NULL, payload_json TEXT NOT NULL,
        status TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 50,
        depends_on_json TEXT NOT NULL DEFAULT '[]', attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3, worker_id TEXT, lease_token TEXT,
        lease_expires_at TEXT, heartbeat_at TEXT, result_json TEXT, evidence_json TEXT,
        error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY(mission_id) REFERENCES missions(id)
      );
      CREATE TABLE IF NOT EXISTS workers (
        id TEXT PRIMARY KEY, capabilities_json TEXT NOT NULL, status TEXT NOT NULL,
        active_ticket_id TEXT, heartbeat_at TEXT NOT NULL, metadata_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS learning (
        id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, ticket_id TEXT NOT NULL,
        delta_json TEXT NOT NULL, consumed_by_seer INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, consumed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, type TEXT NOT NULL,
        mission_id TEXT, ticket_id TEXT, worker_id TEXT, payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status, priority DESC, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_tickets_mission ON tickets(mission_id);
      CREATE INDEX IF NOT EXISTS idx_events_mission_type ON events(mission_id, type, seq);
    `);
    this.requeueExpiredLeases();
  }

  close() { try { this.db.close(); } catch {} }

  event(type, { missionId = null, ticketId = null, workerId = null, payload = {} } = {}) {
    this.db.prepare('INSERT INTO events(ts,type,mission_id,ticket_id,worker_id,payload_json) VALUES(?,?,?,?,?,?)')
      .run(nowIso(), type, missionId, ticketId, workerId, json(payload));
  }

  createMission({ goal, source = 'operator', metadata = {}, idempotencyKey = null } = {}) {
    if (!String(goal || '').trim()) throw new Error('MISSION_GOAL_REQUIRED');
    if (idempotencyKey) {
      const existing = this.db.prepare("SELECT * FROM missions WHERE json_extract(metadata_json,'$.idempotencyKey')=? ORDER BY created_at DESC LIMIT 1").get(String(idempotencyKey));
      if (existing) return this.hydrateMission(existing);
    }
    const missionId = id('mission');
    const ts = nowIso();
    const fullMetadata = { ...metadata, ...(idempotencyKey ? { idempotencyKey } : {}) };
    this.db.prepare('INSERT INTO missions(id,goal,source,status,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(missionId, String(goal).trim(), String(source), 'ACTIVE', json(fullMetadata), ts, ts);
    this.event('MISSION_CREATED', { missionId, payload: { goal, source } });
    return this.getMission(missionId);
  }

  enqueueTicket({ missionId, capability, title, payload = {}, priority = 50, dependsOn = [], parentTicketId = null, maxAttempts = 3 } = {}) {
    if (!this.getMission(missionId)) throw new Error('MISSION_NOT_FOUND');
    if (!String(capability || '').trim()) throw new Error('CAPABILITY_REQUIRED');
    const ticketId = id('ticket');
    const ts = nowIso();
    this.db.prepare(`INSERT INTO tickets(id,mission_id,parent_ticket_id,capability,title,payload_json,status,priority,depends_on_json,max_attempts,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(ticketId, missionId, parentTicketId, String(capability), String(title || capability), json(payload), 'READY', Number(priority) || 50, json(dependsOn), Math.max(1, Number(maxAttempts) || 3), ts, ts);
    this.event('TICKET_ENQUEUED', { missionId, ticketId, payload: { capability, title, dependsOn } });
    return this.getTicket(ticketId);
  }

  registerWorker(workerId, capabilities = [], metadata = {}) {
    if (!workerId) throw new Error('WORKER_ID_REQUIRED');
    const ts = nowIso();
    this.db.prepare(`INSERT INTO workers(id,capabilities_json,status,active_ticket_id,heartbeat_at,metadata_json)
      VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET capabilities_json=excluded.capabilities_json, heartbeat_at=excluded.heartbeat_at, metadata_json=excluded.metadata_json`)
      .run(String(workerId), json([...new Set(capabilities.map(String))]), 'IDLE', null, ts, json(metadata));
    return this.getWorker(workerId);
  }

  heartbeatWorker(workerId) {
    const ts = nowIso();
    this.db.prepare('UPDATE workers SET heartbeat_at=? WHERE id=?').run(ts, String(workerId));
    return this.getWorker(workerId);
  }

  dependenciesDone(ticket) {
    const deps = ticket.dependsOn || [];
    if (!deps.length) return true;
    const stmt = this.db.prepare('SELECT status FROM tickets WHERE id=?');
    return deps.every(dep => stmt.get(dep)?.status === 'DONE');
  }

  requeueExpiredLeases() {
    const expired = this.db.prepare("SELECT id,mission_id,worker_id FROM tickets WHERE status IN ('CLAIMED','RUNNING','VERIFYING') AND lease_expires_at IS NOT NULL AND lease_expires_at < ?").all(nowIso());
    for (const row of expired) {
      this.db.prepare("UPDATE tickets SET status='READY', worker_id=NULL, lease_token=NULL, lease_expires_at=NULL, heartbeat_at=NULL, updated_at=? WHERE id=?").run(nowIso(), row.id);
      if (row.worker_id) this.db.prepare("UPDATE workers SET status='IDLE', active_ticket_id=NULL WHERE id=?").run(row.worker_id);
      this.event('LEASE_EXPIRED_REQUEUED', { missionId: row.mission_id, ticketId: row.id, workerId: row.worker_id, payload: {} });
    }
    return expired.length;
  }

  claimNext(workerId, capabilities, leaseMs = 30_000) {
    this.requeueExpiredLeases();
    const caps = new Set(capabilities.map(String));
    const candidates = this.db.prepare("SELECT * FROM tickets WHERE status='READY' ORDER BY priority DESC, created_at ASC").all();
    for (const row of candidates) {
      const ticket = this.hydrateTicket(row);
      if (!caps.has(ticket.capability) || !this.dependenciesDone(ticket)) continue;
      const token = crypto.randomBytes(18).toString('base64url');
      const expires = new Date(Date.now() + Math.max(5_000, leaseMs)).toISOString();
      const result = this.db.prepare("UPDATE tickets SET status='CLAIMED', worker_id=?, lease_token=?, lease_expires_at=?, heartbeat_at=?, attempts=attempts+1, updated_at=? WHERE id=? AND status='READY'")
        .run(String(workerId), token, expires, nowIso(), nowIso(), ticket.id);
      if (result.changes !== 1) continue;
      this.db.prepare("UPDATE workers SET status='CLAIMED', active_ticket_id=?, heartbeat_at=? WHERE id=?").run(ticket.id, nowIso(), String(workerId));
      this.event('TICKET_CLAIMED', { missionId: ticket.missionId, ticketId: ticket.id, workerId, payload: { leaseExpiresAt: expires } });
      return { ...this.getTicket(ticket.id), leaseToken: token };
    }
    return null;
  }

  assertLease(ticketId, workerId, leaseToken) {
    const row = this.db.prepare('SELECT * FROM tickets WHERE id=?').get(String(ticketId));
    if (!row) throw new Error('TICKET_NOT_FOUND');
    if (row.worker_id !== String(workerId) || row.lease_token !== String(leaseToken || '')) throw new Error('LEASE_MISMATCH');
    if (!row.lease_expires_at || Date.parse(row.lease_expires_at) <= Date.now()) throw new Error('LEASE_EXPIRED');
    return row;
  }

  start(ticketId, workerId, leaseToken) {
    const row = this.assertLease(ticketId, workerId, leaseToken);
    this.db.prepare("UPDATE tickets SET status='RUNNING', updated_at=?, heartbeat_at=? WHERE id=?").run(nowIso(), nowIso(), ticketId);
    this.db.prepare("UPDATE workers SET status='RUNNING', heartbeat_at=? WHERE id=?").run(nowIso(), workerId);
    this.event('TICKET_RUNNING', { missionId: row.mission_id, ticketId, workerId, payload: {} });
    return this.getTicket(ticketId);
  }

  heartbeat(ticketId, workerId, leaseToken, leaseMs = 30_000) {
    this.assertLease(ticketId, workerId, leaseToken);
    const expires = new Date(Date.now() + Math.max(5_000, leaseMs)).toISOString();
    this.db.prepare('UPDATE tickets SET lease_expires_at=?, heartbeat_at=?, updated_at=? WHERE id=?').run(expires, nowIso(), nowIso(), ticketId);
    this.db.prepare('UPDATE workers SET heartbeat_at=? WHERE id=?').run(nowIso(), workerId);
    return this.getTicket(ticketId);
  }

  complete(ticketId, workerId, leaseToken, { result = {}, evidence = [], learning = null } = {}) {
    const row = this.assertLease(ticketId, workerId, leaseToken);
    if (!Array.isArray(evidence) || evidence.length === 0) throw new Error('EVIDENCE_REQUIRED');
    const ts = nowIso();
    this.db.prepare("UPDATE tickets SET status='DONE', result_json=?, evidence_json=?, lease_token=NULL, lease_expires_at=NULL, heartbeat_at=?, updated_at=? WHERE id=?")
      .run(json(result), json(evidence), ts, ts, ticketId);
    this.db.prepare("UPDATE workers SET status='IDLE', active_ticket_id=NULL, heartbeat_at=? WHERE id=?").run(ts, workerId);
    if (learning) {
      const learningId = id('learn');
      this.db.prepare('INSERT INTO learning(id,mission_id,ticket_id,delta_json,created_at) VALUES(?,?,?,?,?)').run(learningId, row.mission_id, ticketId, json(learning), ts);
    }
    this.event('TICKET_DONE', { missionId: row.mission_id, ticketId, workerId, payload: { evidenceCount: evidence.length } });
    this.refreshMission(row.mission_id);
    return this.getTicket(ticketId);
  }

  fail(ticketId, workerId, leaseToken, error, { retry = true } = {}) {
    const row = this.assertLease(ticketId, workerId, leaseToken);
    const canRetry = retry && Number(row.attempts) < Number(row.max_attempts);
    const next = canRetry ? 'READY' : 'FAILED';
    this.db.prepare('UPDATE tickets SET status=?, error=?, worker_id=NULL, lease_token=NULL, lease_expires_at=NULL, heartbeat_at=NULL, updated_at=? WHERE id=?')
      .run(next, String(error || 'worker failed'), nowIso(), ticketId);
    this.db.prepare("UPDATE workers SET status='IDLE', active_ticket_id=NULL, heartbeat_at=? WHERE id=?").run(nowIso(), workerId);
    this.event(canRetry ? 'TICKET_RETRY' : 'TICKET_FAILED', { missionId: row.mission_id, ticketId, workerId, payload: { error: String(error || '') } });
    this.refreshMission(row.mission_id);
    return this.getTicket(ticketId);
  }

  refreshMission(missionId) {
    const counts = this.db.prepare("SELECT status,COUNT(*) AS n FROM tickets WHERE mission_id=? GROUP BY status").all(missionId);
    const map = Object.fromEntries(counts.map(r => [r.status, Number(r.n)]));
    const total = Object.values(map).reduce((a, b) => a + b, 0);
    let status = 'ACTIVE';
    if ((map.FAILED || 0) > 0 && (map.READY || 0) === 0 && (map.CLAIMED || 0) === 0 && (map.RUNNING || 0) === 0) status = 'FAILED';
    else if (total > 0 && (map.DONE || 0) === total) status = 'DONE';
    this.db.prepare('UPDATE missions SET status=?, updated_at=? WHERE id=?').run(status, nowIso(), missionId);
    return this.getMission(missionId);
  }

  consumeLearningForSeer(limit = 50) {
    const rows = this.db.prepare('SELECT * FROM learning WHERE consumed_by_seer=0 ORDER BY created_at ASC LIMIT ?').all(Math.max(1, Math.min(200, Number(limit) || 50)));
    const ts = nowIso();
    const stmt = this.db.prepare('UPDATE learning SET consumed_by_seer=1, consumed_at=? WHERE id=?');
    for (const row of rows) stmt.run(ts, row.id);
    if (rows.length) this.event('SEER_LEARNING_CONSUMED', { payload: { count: rows.length } });
    return rows.map(r => ({ id: r.id, missionId: r.mission_id, ticketId: r.ticket_id, delta: parse(r.delta_json, {}), createdAt: r.created_at }));
  }

  dispatchPressure() {
    const workers = this.listWorkers();
    const ready = this.listTickets({ status: 'READY' });
    let runnable = 0;
    for (const t of ready) {
      if (!this.dependenciesDone(t)) continue;
      if (workers.some(w => w.status === 'IDLE' && w.capabilities.includes(t.capability))) runnable++;
    }
    return { runnableReadyTickets: runnable, idleCapableWorkerAvailable: runnable > 0, invariant: runnable > 0 ? 'DISPATCH_REQUIRED' : 'CLEAR' };
  }

  getMission(missionId) { const r = this.db.prepare('SELECT * FROM missions WHERE id=?').get(String(missionId)); return r ? this.hydrateMission(r) : null; }
  getTicket(ticketId) { const r = this.db.prepare('SELECT * FROM tickets WHERE id=?').get(String(ticketId)); return r ? this.hydrateTicket(r) : null; }
  getWorker(workerId) { const r = this.db.prepare('SELECT * FROM workers WHERE id=?').get(String(workerId)); return r ? this.hydrateWorker(r) : null; }
  missionStatusCounts() { return Object.fromEntries(this.db.prepare('SELECT status, COUNT(*) AS count FROM missions GROUP BY status').all().map(r => [r.status, Number(r.count)])); }
  listMissions(limit = 100) { return this.db.prepare('SELECT * FROM missions ORDER BY created_at DESC LIMIT ?').all(Math.max(1, Math.min(500, Number(limit) || 100))).map(r => this.hydrateMission(r)); }
  missionsAwaitingResolution() { return this.db.prepare("SELECT * FROM missions WHERE status IN ('BLOCKED','AWAITING_VERIFICATION') ORDER BY created_at DESC").all().map(r => this.hydrateMission(r)); }
  listTickets({ status = null, missionId = null, limit = 200 } = {}) {
    let sql = 'SELECT * FROM tickets'; const args = []; const where = [];
    if (status) { where.push('status=?'); args.push(String(status)); }
    if (missionId) { where.push('mission_id=?'); args.push(String(missionId)); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY priority DESC, created_at ASC LIMIT ?'; args.push(Math.max(1, Math.min(1000, Number(limit) || 200)));
    return this.db.prepare(sql).all(...args).map(r => this.hydrateTicket(r));
  }
  listWorkers() { return this.db.prepare('SELECT * FROM workers ORDER BY id').all().map(r => this.hydrateWorker(r)); }
  lastMissionEvent(missionId, type) {
    const r = this.db.prepare('SELECT * FROM events WHERE mission_id=? AND type=? ORDER BY seq DESC LIMIT 1').get(String(missionId), String(type));
    return r ? { seq: r.seq, ts: r.ts, type: r.type, missionId: r.mission_id, payload: parse(r.payload_json, {}) } : null;
  }
  listEvents(limit = 200) { return this.db.prepare('SELECT * FROM events ORDER BY seq DESC LIMIT ?').all(Math.max(1, Math.min(1000, Number(limit) || 200))).map(r => ({ seq: r.seq, ts: r.ts, type: r.type, missionId: r.mission_id, ticketId: r.ticket_id, workerId: r.worker_id, payload: parse(r.payload_json, {}) })); }

  hydrateMission(r) { return { id: r.id, goal: r.goal, source: r.source, status: r.status, metadata: parse(r.metadata_json, {}), createdAt: r.created_at, updatedAt: r.updated_at }; }
  hydrateTicket(r) { return { id: r.id, missionId: r.mission_id, parentTicketId: r.parent_ticket_id, capability: r.capability, title: r.title, payload: parse(r.payload_json, {}), status: r.status, priority: Number(r.priority), dependsOn: parse(r.depends_on_json, []), attempts: Number(r.attempts), maxAttempts: Number(r.max_attempts), workerId: r.worker_id, leaseExpiresAt: r.lease_expires_at, heartbeatAt: r.heartbeat_at, result: parse(r.result_json, null), evidence: parse(r.evidence_json, []), error: r.error, createdAt: r.created_at, updatedAt: r.updated_at }; }
  hydrateWorker(r) { return { id: r.id, capabilities: parse(r.capabilities_json, []), status: r.status, activeTicketId: r.active_ticket_id, heartbeatAt: r.heartbeat_at, metadata: parse(r.metadata_json, {}) }; }
}
