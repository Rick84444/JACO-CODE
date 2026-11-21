// JACO Cloud control plane: durable handoff contract, not a second Aura runtime.
// Auth and storage are injected. Never use HTTP-supplied tenant identifiers as authority.
import crypto from 'node:crypto';

const DEVICE = /^[A-Za-z0-9_-]{8,100}$/;
const KEY = /^[A-Za-z0-9_-]{12,100}$/;
const TASK = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECEIPT = /^[A-Za-z0-9._:-]{8,160}$/;
const SCOPE = 'missions:write';
const STATES = new Set(['ACCEPTED','DELIVERY_UNKNOWN','RECEIVED','RUNNING','VERIFIED','FAILED']);
const HOST_EVENTS = new Set(['RECEIVED','RUNNING','VERIFIED','FAILED']);
const allowed = {
  ACCEPTED: new Set(['RECEIVED','RUNNING','FAILED']),
  DELIVERY_UNKNOWN: new Set(['RECEIVED','RUNNING','FAILED']),
  RECEIVED: new Set(['RUNNING','VERIFIED','FAILED']),
  RUNNING: new Set(['VERIFIED','FAILED']),
  VERIFIED: new Set(),
  FAILED: new Set(),
};
export class HandoffError extends Error {
  constructor(code) { super(code); this.name = 'HandoffError'; this.code = code; }
}
const requireValue = (value, re, code) => {
  if (typeof value !== 'string' || !re.test(value)) throw new HandoffError(code);
  return value;
};
function principal(value, scope) {
  // ONLY a trusted OAuth verifier can produce this object. The caller must
  // never accept principal fields from client JSON.
  if (!value || typeof value.tenantId !== 'string' || !value.tenantId ||
      typeof value.subject !== 'string' || !value.subject ||
      !Array.isArray(value.scopes) || !value.scopes.includes(scope)) {
    throw new HandoffError('AUTH_SCOPE_DENIED');
  }
  return value;
}
function hostIdentity(value) {
  // Only a verified, revocation-checked paired host transport may attest this.
  if (!value || typeof value.tenantId !== 'string' || !value.tenantId ||
      !DEVICE.test(String(value.deviceId || ''))) throw new HandoffError('HOST_AUTH_DENIED');
  return value;
}
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function safePublic(task) {
  return {
    schema:'jaco.cloud-handoff/v1', id:task.id, deviceId:task.deviceId,
    state:task.state, dispatchState:task.dispatchState,
    createdAt:task.createdAt, updatedAt:task.updatedAt,
    receiptId:task.receiptId || null, evidenceRef:task.evidenceRef || null,
  };
}

/**
 * Strict application contract for a future hosted HTTPS/MCP handler.
 * authenticateUser: validates OAuth token, audience, expiry, scopes, revocation.
 * authenticateHost: validates paired device signature/socket identity and revocation.
 * authorizeDispatch: authenticates server-internal worker credential (never caller function).
 * verifyEvidence: independently validates a canonical Aura receipt before VERIFIED.
 * ownsDevice: checks immutable tenant/device membership and per-device authorization.
 * store: must provide atomic, durable reserveUnique(), get(), beginDispatch(),
 *        and applyHostEvent() transactions. In-memory stores are NOT production safe.
 * No HTTP listener or unauthenticated mutation route is exported here.
 */
export function createCloudHandoff({authenticateUser, authenticateHost, authorizeDispatch, verifyEvidence, ownsDevice, store, clock = () => new Date().toISOString()}) {
  if ([authenticateUser,authenticateHost,authorizeDispatch,verifyEvidence,ownsDevice,store?.reserveUnique,store?.get,
       store?.beginDispatch,store?.applyHostEvent].some(f => typeof f !== 'function')) {
    throw new HandoffError('CLOUD_DEPENDENCIES_MISSING');
  }

  async function submit({bearer, deviceId, goal, idempotencyKey}) {
    const identity = principal(await authenticateUser(bearer), SCOPE);
    requireValue(deviceId, DEVICE, 'DEVICE_INVALID');
    requireValue(idempotencyKey, KEY, 'IDEMPOTENCY_KEY_REQUIRED');
    if (typeof goal !== 'string' || goal.trim().length < 2 || goal.length > 8000) {
      throw new HandoffError('GOAL_INVALID');
    }
    if (!await ownsDevice(identity, deviceId, SCOPE)) throw new HandoffError('DEVICE_ACCESS_DENIED');
    const requestHash = digest({deviceId,goal});
    const proposed = {
      id:crypto.randomUUID(),tenantId:identity.tenantId,deviceId,
      goal,requestHash,idempotencyKey,createdAt:clock(),updatedAt:clock(),
      state:'ACCEPTED',dispatchState:'NOT_DISPATCHED',receiptId:null,evidenceRef:null,
    };
    // Atomic uniqueness: (tenantId, idempotencyKey). Existing differing hash
    // MUST be rejected even when another request races with this one.
    const stored = await store.reserveUnique(proposed);
    if (!stored || stored.tenantId !== identity.tenantId ||
        stored.idempotencyKey !== idempotencyKey) throw new HandoffError('STORE_INTEGRITY_ERROR');
    if (stored.requestHash !== requestHash) throw new HandoffError('IDEMPOTENCY_CONFLICT');
    return safePublic(stored);
  }

  async function status({bearer, jobId}) {
    const identity = principal(await authenticateUser(bearer), 'missions:read');
    requireValue(jobId, TASK, 'TASK_ID_INVALID');
    const task = await store.get(identity.tenantId, jobId);
    if (!task) throw new HandoffError('TASK_NOT_FOUND');
    if (!await ownsDevice(identity, task.deviceId, 'missions:read')) {
      throw new HandoffError('TASK_NOT_FOUND');
    }
    return safePublic(task);
  }

  async function beginDispatch({jobId, dispatchCredential}) {
    // The caller cannot inject an authorization callback; only server-side
    // transport configuration can validate an internal dispatcher credential.
    if (!await authorizeDispatch(dispatchCredential)) throw new HandoffError('DISPATCHER_AUTH_DENIED');
    requireValue(jobId, TASK, 'TASK_ID_INVALID');
    // Atomic state change BEFORE sending through the customer-scoped transport.
    // If send/ack is ambiguous, do NOT silently retry with a second request.
    const task = await store.beginDispatch(jobId, clock());
    if (!task || task.dispatchState !== 'UNKNOWN') throw new HandoffError('DISPATCH_ALREADY_CLAIMED');
    return {id:task.id,tenantId:task.tenantId,deviceId:task.deviceId,goal:task.goal};
  }

  async function hostReceipt({hostCredential, jobId, event}) {
    const host = hostIdentity(await authenticateHost(hostCredential));
    requireValue(jobId, TASK, 'TASK_ID_INVALID');
    if (!event || typeof event !== 'object' || Array.isArray(event) ||
        !HOST_EVENTS.has(event.type)) throw new HandoffError('HOST_EVENT_INVALID');
    const receiptId = requireValue(event.receiptId, RECEIPT, 'HOST_RECEIPT_ID_INVALID');
    if (event.type === 'VERIFIED' &&
        (event.verified !== true ||
         !RECEIPT.test(String(event.evidenceRef || '')))) {
      throw new HandoffError('VERIFICATION_EVIDENCE_REQUIRED');
    }
    if (event.type !== 'VERIFIED' && (event.verified === true || event.evidenceRef !== undefined)) {
      throw new HandoffError('UNVERIFIED_RESULT_CLAIM');
    }
    const task = await store.get(host.tenantId, jobId);
    if (!task || task.deviceId !== host.deviceId) throw new HandoffError('TASK_NOT_FOUND');
    if (!STATES.has(task.state) || task.dispatchState === 'NOT_DISPATCHED') {
      throw new HandoffError('TASK_NOT_DELIVERED');
    }
    if (task.state !== event.type && !allowed[task.state]?.has(event.type)) {
      throw new HandoffError('HOST_STATE_TRANSITION_DENIED');
    }
    // A host-provided boolean and evidenceRef string do NOT prove completion.
    // Verify against a trusted canonical Aura evidence source (signature, ledger
    // ownership, exact mission and device binding) before a terminal write.
    if (event.type === 'VERIFIED' && !await verifyEvidence({
      tenantId:host.tenantId,deviceId:host.deviceId,jobId,
      receiptId,evidenceRef:event.evidenceRef,
    })) throw new HandoffError('EVIDENCE_NOT_VERIFIED');
    // Must compare/dedupe receiptId and state atomically in persistent store,
    // including the existing terminal state. Only a host receipt can resolve
    // unknown delivery; an HTTP timeout cannot.
    const updated = await store.applyHostEvent({
      tenantId:host.tenantId,jobId,deviceId:host.deviceId,
      state:event.type,receiptId,
      evidenceRef:event.type==='VERIFIED'?event.evidenceRef:null,
      updatedAt:clock(),allowedFrom:[...Object.entries(allowed)
        .filter(([,to])=>to.has(event.type)).map(([from])=>from),event.type],
    });
    if (!updated) throw new HandoffError('HOST_EVENT_CONFLICT');
    return safePublic(updated);
  }
  return Object.freeze({submit,status,beginDispatch,hostReceipt});
}
