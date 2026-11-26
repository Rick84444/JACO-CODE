// Official SIWC protocol primitives; caller owns local callback, account vault and consent.
// No API key fallback, no environment credentials, no private endpoints.
// https://developers.openai.com/siwc/token-sharing-open-source/
import { randomBytes, createHash, createPublicKey, verify, timingSafeEqual } from 'node:crypto';

const AUTH = 'https://auth.openai.com';
const API = 'https://api.openai.com/v1';
const PLAN = 'chatgpt.tokens.use.direct';
const SCOPES = 'openid profile email offline_access resource.invoke ' + PLAN;
const nonempty = x => typeof x === 'string' && x.trim().length > 0;
const fail = code => { throw new Error(code); };
const random = () => randomBytes(32).toString('base64url');
const equal = (a,b) => typeof a === 'string' && typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const validClient = id => typeof id === 'string' && /^oaiapp_[A-Za-z0-9_-]+$/.test(id);

export function beginAuthorization({ hostId, redirectUri, clientId } = {}) {
  if (!/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hostId || '')) fail('SIWC_HOST_ID_INVALID');
  if (!/^http:\/\/127\.0\.0\.1:[0-9]+\/auth\/callback$/.test(redirectUri || '')) fail('SIWC_CALLBACK_INVALID');
  if (clientId && !validClient(clientId)) fail('SIWC_CLIENT_INVALID');
  const state = random(), nonce = random(), verifier = random();
  const params = new URLSearchParams({
    client_id: clientId || 'dynamic_agent_client', ext_agent_host_id: hostId,
    response_type: 'code', redirect_uri: redirectUri, scope: SCOPES, resource: API,
    state, nonce, code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    ...(!clientId ? { agent_name_hint: 'JACO CODE' } : {})
  });
  return { url: AUTH + '/api/accounts/authorize?' + params, state, nonce, verifier, redirectUri, clientId, expiresAt: Date.now() + 300000, consumed: false };
}

export function acceptCallback(attempt, callbackUrl) {
  if (!attempt || attempt.consumed || Date.now() >= attempt.expiresAt) fail('SIWC_ATTEMPT_EXPIRED');
  const u = new URL(callbackUrl);
  if (u.origin + u.pathname !== attempt.redirectUri) fail('SIWC_CALLBACK_INVALID');
  for (const k of ['state','code','client_id','error']) if (u.searchParams.getAll(k).length > 1) fail('SIWC_CALLBACK_INVALID');
  if (!equal(attempt.state, u.searchParams.get('state'))) fail('SIWC_STATE_MISMATCH');
  attempt.consumed = true;
  if (u.searchParams.has('error')) fail('SIWC_AUTHORIZATION_DENIED');
  const issued = u.searchParams.get('client_id') || attempt.clientId;
  if (!validClient(issued) || (attempt.clientId && attempt.clientId !== issued)) fail('SIWC_CLIENT_INVALID');
  const code = u.searchParams.get('code');
  if (!nonempty(code)) fail('SIWC_CODE_MISSING');
  return { grant_type: 'authorization_code', client_id: issued, code, code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource: API };
}

async function jsonRequest(url, init, fetchImpl) {
  const r = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!r.ok) fail('SIWC_HTTP_' + r.status);
  return r.json();
}

export function verifyIdentity(token, jwks, clientId, nonce, now = Date.now()/1000) {
  if (!nonempty(token) || token.length > 32000 || !validClient(clientId) || !nonempty(nonce)) fail('SIWC_IDENTITY_INVALID');
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) fail('SIWC_IDENTITY_INVALID');
  const [h,p,s] = parts;
  let header, claims;
  try { header = JSON.parse(Buffer.from(h,'base64url')); claims = JSON.parse(Buffer.from(p,'base64url')); } catch { fail('SIWC_IDENTITY_INVALID'); }
  if (header?.alg !== 'RS256' || !nonempty(header.kid) || header.crit) fail('SIWC_IDENTITY_INVALID');
  const keys = (jwks?.keys || []).filter(k => k.kid === header.kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256') && (!k.use || k.use === 'sig'));
  if (keys.length !== 1 || !verify('RSA-SHA256', Buffer.from(h+'.'+p), createPublicKey({key:keys[0],format:'jwk'}),Buffer.from(s,'base64url'))) fail('SIWC_SIGNATURE_INVALID');
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== AUTH || !audiences.includes(clientId) ||
    ((audiences.length > 1 || claims.azp) && claims.azp !== clientId) ||
    !Number.isFinite(claims.exp) || claims.exp <= now || !Number.isFinite(claims.iat) || claims.iat > now+5 ||
    (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now+5)) ||
    !equal(nonce,claims.nonce) || !nonempty(claims.sub)) fail('SIWC_IDENTITY_INVALID');
  return { issuer: claims.iss, subject: claims.sub, email: typeof claims.email === 'string' ? claims.email : '' };
}

const verifiedSessions = new WeakSet();
export async function exchangeAuthorization(attempt, callbackUrl, { fetchImpl = fetch, expectedSubject } = {}) {
  if (attempt?.clientId && !nonempty(expectedSubject)) fail('SIWC_EXPECTED_ACCOUNT_REQUIRED');
  const grant = acceptCallback(attempt,callbackUrl);
  const data = await jsonRequest(AUTH+'/api/accounts/oauth/token', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(grant)},fetchImpl);
  const jwks = await jsonRequest(AUTH+'/.well-known/jwks.json',{},fetchImpl);
  const identity = verifyIdentity(data.id_token,jwks,grant.client_id,attempt.nonce);
  if (expectedSubject && identity.subject !== expectedSubject) fail('SIWC_ACCOUNT_MISMATCH');
  const scopes = typeof data.scope === 'string' ? data.scope.split(/\s+/) : [];
  if (!scopes.includes(PLAN) || !scopes.includes('resource.invoke')) fail('SIWC_PLAN_NOT_GRANTED');
  if (!nonempty(data.access_token) || !nonempty(data.refresh_token) || String(data.token_type).toLowerCase() !== 'bearer' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) fail('SIWC_TOKEN_INVALID');
  const session = Object.freeze({ ...identity, clientId:grant.client_id, accessToken:data.access_token, refreshToken:data.refresh_token, idToken:data.id_token, scopes:Object.freeze(scopes),expiresAt:Date.now()+data.expires_in*1000 });
  verifiedSessions.add(session);
  return session;
}

function headers(session) {
  if (!verifiedSessions.has(session) || session.expiresAt <= Date.now()) fail('SIWC_SESSION_REQUIRED');
  return { authorization:'Bearer '+session.accessToken, 'content-type':'application/json' };
}
export async function listPlanModels(session, {fetchImpl=fetch}={}) {
  const data = await jsonRequest(API+'/models',{headers:headers(session)},fetchImpl);
  if (!Array.isArray(data.models)) fail('SIWC_MODELS_INVALID');
  return data.models.filter(m => m.visibility === 'list' && nonempty(m.slug)).map(m => ({id:m.slug,label:nonempty(m.display_name)?m.display_name:m.slug}));
}

export async function readCompletedResponse(body) {
  if (!body) fail('SIWC_STREAM_MISSING');
  const decoder = new TextDecoder();
  let buffer='', text='', size=0, completed=false, usage=null;
  function event(block) {
    const data = block.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).replace(/^ /,'')).join('\n');
    if (!data || data === '[DONE]') return;
    const e = JSON.parse(data);
    if (['error','response.failed','response.incomplete'].includes(e.type)) {
      const code=e.response?.error?.code ?? e.code;
      fail(['subscription_sharing_usage_limit_exceeded','subscription_sharing_usage_unavailable'].includes(code)?'SIWC_PLAN_LIMIT':'SIWC_RESPONSE_FAILED');
    }
    if (e.type === 'response.output_text.delta' && typeof e.delta === 'string') text += e.delta;
    if (e.type === 'response.completed') { completed=true; usage=e.response?.usage ?? null; }
  }
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > 8*1024*1024) fail('SIWC_STREAM_LIMIT');
    buffer += decoder.decode(chunk,{stream:true});
    let match;
    while ((match=/\r?\n\r?\n/.exec(buffer))) {
      event(buffer.slice(0,match.index)); buffer=buffer.slice(match.index+match[0].length);
      if (completed) { if (!text.trim()) fail('SIWC_EMPTY_RESPONSE'); return {content:text,usage}; }
    }
  }
  fail('SIWC_STREAM_INCOMPLETE');
}

export async function completePlan(session,{model,messages,fetchImpl=fetch,signal}={}) {
  if (!nonempty(model) || !Array.isArray(messages) || !messages.length || messages.some(m=>!['user','assistant','system','developer'].includes(m?.role)||typeof m.content!=='string')) fail('SIWC_INPUT_INVALID');
  const started=Date.now();
  const r=await fetchImpl(API+'/responses',{method:'POST',headers:headers(session),redirect:'error',
    signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000),
    body:JSON.stringify({model,input:messages,store:false,stream:true})});
  if (!r.ok) fail('SIWC_HTTP_'+r.status);
  const result=await readCompletedResponse(r.body);
  return {...result,model,providerId:'chatgpt-plan',finishReason:'stop',latencyMs:Date.now()-started};
}
