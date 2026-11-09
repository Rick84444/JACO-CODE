// JACO-LINK/1: shared transport contract. This is a *remote operator* interface,
// not a second agent, shell, file editor or new mission owner.
export const LINK_PROTOCOL = 'JACO-LINK/1';
export const MAX_REQUEST_BYTES = 48 * 1024;
export const MAX_MESSAGE_BYTES = 320 * 1024;
export const MAX_RESPONSE_BYTES = 256 * 1024;
const ID = /^[A-Za-z0-9_-]{8,100}$/;
const DEVICE = /^[A-Za-z0-9_-]{8,100}$/;

// Explicit API delegation; do not forward arbitrary /api, shell, Git or model credentials.
const READS = new Set([
  '/api/aura/plan',
  '/api/aura/workbench/local-memory',
  '/api/aura/chat/session',
  '/api/aura/workbench/approvals',
]);
const WRITES = new Set([
  '/api/aura/chat',
  '/api/aura/plan/comments',
]);
const MISSION = /^\/api\/aura\/workbench\/missions\/([A-Za-z0-9_.:-]{1,120})\/(cancel|steer)$/;
const APPROVAL = /^\/api\/aura\/workbench\/approvals\/([A-Za-z0-9_.:-]{1,120})\/decision$/;

export function permittedRemoteCall(method, path) {
  if (typeof path !== 'string' || path.length > 220 ||
      path.includes('?') || path.includes('#') || path.includes('%') ||
      path.includes('//') || path.includes('\\')) return false;
  if (method === 'GET') return READS.has(path);
  if (method !== 'POST') return false;
  return WRITES.has(path) || MISSION.test(path) || APPROVAL.test(path);
}
export function validateRemoteCall(value) {
  if (!value || value.type !== 'rpc' || !ID.test(String(value.id || '')) ||
      !['GET','POST'].includes(value.method) || !permittedRemoteCall(value.method, value.path) ||
      (value.target !== undefined && !DEVICE.test(String(value.target))) ||
      (value.method === 'GET' && value.body !== undefined)) {
    return { ok: false, error: 'REMOTE_CALL_NOT_PERMITTED' };
  }
  try {
    if (JSON.stringify(value).length > MAX_REQUEST_BYTES) return {ok:false,error:'REMOTE_CALL_TOO_LARGE'};
  } catch {return {ok:false,error:'REMOTE_CALL_INVALID'};}
  if (value.method === 'POST' && (!value.body || typeof value.body !== 'object' ||
      Array.isArray(value.body))) return {ok:false,error:'REMOTE_BODY_REQUIRED'};
  return {ok:true,method:value.method,path:value.path,id:value.id,body:value.body||null,target:value.target||null};
}
export function validateHostResponse(value) {
  return Boolean(value && value.type === 'rpc_result' &&
    ID.test(String(value.id || '')) &&
    Number.isInteger(value.status) && value.status >= 100 && value.status <= 599 &&
    JSON.stringify(value).length <= MAX_MESSAGE_BYTES);
}
