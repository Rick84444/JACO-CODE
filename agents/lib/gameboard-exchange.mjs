import { createHash } from 'node:crypto';
import { gameboardNumericId } from './gameboard-fabric.mjs';

export const GAMEBOARD_EXCHANGE_SCHEMA = 'jaco.gameboard-exchange/v1';
const bounded = (value, length = 160) => String(value ?? '').trim().slice(0, length);
const metric = (value, key) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
    throw Error('GAMEBOARD_METRIC_INVALID:' + key);
  return value;
};
const encoded = data => JSON.stringify(data);
const fingerprint = value => createHash('sha256').update(encoded(value)).digest('hex');

export function validateGameboardMessage(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('GAMEBOARD_MESSAGE_INVALID');
  const kind = bounded(raw.kind, 24);
  if (!['OBSERVATION','HYPOTHESIS','MOVE_PROPOSAL'].includes(kind)) throw Error('GAMEBOARD_KIND_DENIED');
  const eventId = bounded(raw.eventId, 120);
  const scope = bounded(raw.scope || 'global', 160);
  const actorId = bounded(raw.actorId, 160);
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(eventId) || !/^[A-Za-z0-9._:-]{1,160}$/.test(scope) || !/^[A-Za-z0-9._:-]{1,160}$/.test(actorId))
    throw Error('GAMEBOARD_IDENTITY_INVALID');
  const expectedRevision = raw.expectedRevision;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw Error('GAMEBOARD_REVISION_REQUIRED');
  const statement = bounded(raw.statement, 800);
  if (!statement) throw Error('GAMEBOARD_STATEMENT_REQUIRED');
  const evidenceRefs = Array.isArray(raw.evidenceRefs) ? [...new Set(raw.evidenceRefs.map(ref => bounded(ref, 260)))] : [];
  if (evidenceRefs.length > 20 || evidenceRefs.some(ref => !ref)) throw Error('GAMEBOARD_EVIDENCE_INVALID');
  const target = bounded(raw.target, 200) || null;
  let metrics = null;
  if (kind === 'MOVE_PROPOSAL') {
    if (!target) throw Error('GAMEBOARD_MOVE_TARGET_REQUIRED');
    const props = ['goalImpact','informationGain','verificationGain','confidence','risk','effort'];
    metrics = Object.fromEntries(props.map(key => [key, metric(raw.metrics?.[key], key)]));
  } else if (raw.metrics !== undefined) throw Error('GAMEBOARD_METRICS_NOT_APPLICABLE');
  return {
    schema: GAMEBOARD_EXCHANGE_SCHEMA,
    eventId, scope, actorId, actorNumericId: gameboardNumericId('agent', actorId),
    kind, statement, target, metrics, evidenceRefs,
    evidenceStatus: 'UNVERIFIED_CLAIM', // References are not validated receipts here.
    expectedRevision,
  };
}

export function createGameboardExchange(db) {
  if (!db?.prepare || !db?.exec) throw Error('GAMEBOARD_DATABASE_REQUIRED');
  db.exec(`
    CREATE TABLE IF NOT EXISTS gameboard_positions (
      scope TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS gameboard_exchange (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE, scope TEXT NOT NULL,
      revision INTEGER NOT NULL, digest TEXT NOT NULL,
      message_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gameboard_scope ON gameboard_exchange(scope, revision);
  `);
  const entry = row => row && ({
    ...JSON.parse(row.message_json),
    revision: row.revision, seq: row.seq, createdAt: row.created_at,
  });
  function position(scope = 'global', limit = 60) {
    const key = bounded(scope, 160);
    const row = db.prepare('SELECT revision FROM gameboard_positions WHERE scope=?').get(key);
    const rows = db.prepare('SELECT * FROM gameboard_exchange WHERE scope=? ORDER BY revision DESC LIMIT ?')
      .all(key, Math.max(1, Math.min(200, Number(limit) || 60)));
    return { schema: GAMEBOARD_EXCHANGE_SCHEMA, scope: key, revision: Number(row?.revision || 0),
      entries: rows.reverse().map(entry), truncated: Number(row?.revision || 0) > rows.length };
  }
  function publish(raw) {
    const msg = validateGameboardMessage(raw);
    const digest = fingerprint(msg);
    db.exec('BEGIN IMMEDIATE');
    try {
      const prior = db.prepare('SELECT * FROM gameboard_exchange WHERE event_id=?').get(msg.eventId);
      if (prior) {
        if (prior.digest !== digest) throw Error('GAMEBOARD_EVENT_REPLAY_CONFLICT');
        db.exec('COMMIT');
        return { accepted: true, replay: true, entry: entry(prior), ...position(msg.scope) };
      }
      db.prepare('INSERT OR IGNORE INTO gameboard_positions(scope,revision) VALUES(?,0)').run(msg.scope);
      const row = db.prepare('SELECT revision FROM gameboard_positions WHERE scope=?').get(msg.scope);
      if (Number(row.revision) !== msg.expectedRevision)
        throw Error('GAMEBOARD_STALE_REVISION:' + row.revision);
      const revision = row.revision + 1;
      db.prepare('UPDATE gameboard_positions SET revision=? WHERE scope=? AND revision=?')
        .run(revision, msg.scope, row.revision);
      const at = new Date().toISOString();
      db.prepare('INSERT INTO gameboard_exchange(event_id,scope,revision,digest,message_json,created_at) VALUES(?,?,?,?,?,?)')
        .run(msg.eventId,msg.scope,revision,digest,encoded(msg),at);
      db.exec('COMMIT');
      return { accepted: true, replay: false, ...position(msg.scope) };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return { position, publish };
}
