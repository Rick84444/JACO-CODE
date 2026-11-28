// PostgreSQL persistence adapter for the JACO Cloud handoff application service.
// pool is an injected node-postgres-compatible Pool; this module opens no
// listeners, handles no credentials, and never dispatches to an Aura host.
const FIELDS = [
  'id',
  'tenant_id AS "tenantId"',
  'device_id AS "deviceId"',
  'goal',
  'request_hash AS "requestHash"',
  'idempotency_key AS "idempotencyKey"',
  'state',
  'dispatch_state AS "dispatchState"',
  'receipt_id AS "receiptId"',
  'evidence_ref AS "evidenceRef"',
  'created_at AS "createdAt"',
  'updated_at AS "updatedAt"',
].join(', ');

function record(row) {
  if (!row) return null;
  return {...row,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}
function queryOrThrow(pool, text, values) {
  return pool.query(text, values);
}
export function createPostgresHandoffStore(pool) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('POSTGRES_POOL_REQUIRED');
  return Object.freeze({
    async reserveUnique(task) {
      // Two concurrent requests with the same tenant+key cannot both insert.
      // DO NOTHING avoids rewriting an existing mission. Under READ COMMITTED
      // a separate SELECT observes the winner after the conflicting INSERT.
      const inserted = await queryOrThrow(pool,
        'INSERT INTO jaco_cloud_missions ' +
        '(id,tenant_id,device_id,goal,request_hash,idempotency_key,state,dispatch_state,receipt_id,evidence_ref,created_at,updated_at) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ' +
        'ON CONFLICT (tenant_id,idempotency_key) DO NOTHING RETURNING '+FIELDS,
        [task.id,task.tenantId,task.deviceId,task.goal,task.requestHash,task.idempotencyKey,
         task.state,task.dispatchState,task.receiptId,task.evidenceRef,task.createdAt,task.updatedAt]);
      if (inserted.rows[0]) return record(inserted.rows[0]);
      const existing = await queryOrThrow(pool,
        'SELECT '+FIELDS+' FROM jaco_cloud_missions WHERE tenant_id=$1 AND idempotency_key=$2',
        [task.tenantId,task.idempotencyKey]);
      return record(existing.rows[0]);
    },
    async get(tenantId, jobId) {
      const found = await queryOrThrow(pool,
        'SELECT '+FIELDS+' FROM jaco_cloud_missions WHERE tenant_id=$1 AND id=$2::uuid',
        [tenantId,jobId]);
      return record(found.rows[0]);
    },
    async beginDispatch(jobId, time) {
      // Mark outcome UNKNOWN *before* socket transmission, atomically.
      // No automatic retry is permitted after unknown delivery.
      const changed = await queryOrThrow(pool,
        "UPDATE jaco_cloud_missions SET state='DELIVERY_UNKNOWN',dispatch_state='UNKNOWN',updated_at=$2 " +
        "WHERE id=$1::uuid AND state='ACCEPTED' AND dispatch_state='NOT_DISPATCHED' RETURNING "+FIELDS,
        [jobId,time]);
      return record(changed.rows[0]);
    },
    async applyHostEvent(e) {
      // Transaction-free single-row CAS. Exactly the same receipt can be read
      // again; a later/conflicting receipt cannot overwrite terminal outcomes.
      // All identity, ordering, and receipt comparison occurs inside SQL,
      // never in a stale read-modify-write JavaScript sequence.
      const changed = await queryOrThrow(pool,
        "UPDATE jaco_cloud_missions SET " +
        "state=CASE WHEN state=$4 THEN state ELSE $4 END, " +
        "dispatch_state=CASE WHEN state=$4 THEN dispatch_state ELSE 'DELIVERED' END, " +
        "receipt_id=CASE WHEN state=$4 THEN receipt_id ELSE $5 END, " +
        "evidence_ref=CASE WHEN state=$4 THEN evidence_ref ELSE $6 END, " +
        "updated_at=CASE WHEN state=$4 THEN updated_at ELSE $7 END " +
        "WHERE tenant_id=$1 AND id=$2::uuid AND device_id=$3 AND dispatch_state<>'NOT_DISPATCHED' " +
        "AND ((state=$4 AND receipt_id=$5 AND evidence_ref IS NOT DISTINCT FROM $6) " +
        "OR (state=ANY($8::text[]) AND state<>$4 AND state NOT IN ('VERIFIED','FAILED'))) " +
        "RETURNING "+FIELDS,
        [e.tenantId,e.jobId,e.deviceId,e.state,e.receiptId,e.evidenceRef,
         e.updatedAt,e.allowedFrom]);
      return record(changed.rows[0]);
    },
  });
}
