// Google sign-in for jacocode.com: OAuth code flow with PKCE, state and nonce in a short-lived sealed cookie,
// and the session as one HMAC-signed HttpOnly cookie. Nothing is stored server side.
const enc = new TextEncoder();
const dec = new TextDecoder();
const REDIRECT = 'https://jacocode.com/auth/google/callback';
const SESSION_DAYS = 30;

const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const random = n => b64u(crypto.getRandomValues(new Uint8Array(n)));
const hmacKey = secret => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

async function seal(obj, secret) {
  const body = b64u(enc.encode(JSON.stringify(obj)));
  return `${body}.${b64u(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)))}`;
}

async function unseal(token, secret) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  try {
    if (!await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64u(sig), enc.encode(body))) return null;
    const obj = JSON.parse(dec.decode(fromB64u(body)));
    return obj.exp && obj.exp < Date.now() / 1e3 ? null : obj;
  } catch {
    return null;
  }
}

const cookieValue = (request, name) => (request.headers.get('cookie') || '').split(/;\s*/).map(c => c.split(/=(.*)/s)).find(([k]) => k === name)?.[1] || '';
const cookie = (name, value, { path = '/', maxAge }) => `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const message = (status, text, setCookie) => {
  const res = new Response(`${text}\n\nBack to https://jacocode.com/\n`, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  if (setCookie) res.headers.append('set-cookie', setCookie);
  return res;
};

function idTokenClaims(idToken) {
  try { return JSON.parse(dec.decode(fromB64u(String(idToken).split('.')[1]))); } catch { return null; }
}

export async function handleAuth(request, env, url, fetchImpl = fetch) {
  const path = url.pathname;
  if (!path.startsWith('/auth/')) return null;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SESSION_SECRET) return json({ error: 'login_not_configured' }, 503);
  if (path === '/auth/me') {
    const session = await unseal(cookieValue(request, 'jaco_session'), env.SESSION_SECRET);
    return session ? json({ signedIn: true, email: session.email, name: session.name }) : json({ signedIn: false });
  }
  if (path === '/auth/logout') {
    if (request.method !== 'POST' || request.headers.get('origin') !== 'https://jacocode.com') return json({ error: 'forbidden' }, 403);
    return new Response(null, { status: 204, headers: { 'set-cookie': cookie('jaco_session', '', { maxAge: 0 }) } });
  }
  if (path === '/auth/google') {
    const state = random(24), nonce = random(24), verifier = random(32);
    const challenge = b64u(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));
    const target = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for (const [k, v] of Object.entries({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code', scope: 'openid email profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' })) target.searchParams.set(k, v);
    const sealed = await seal({ state, nonce, verifier, exp: Math.floor(Date.now() / 1e3) + 600 }, env.SESSION_SECRET);
    return new Response(null, { status: 302, headers: { location: target.toString(), 'set-cookie': cookie('jaco_oauth', sealed, { path: '/auth', maxAge: 600 }) } });
  }
  if (path === '/auth/google/callback') {
    const clear = cookie('jaco_oauth', '', { path: '/auth', maxAge: 0 });
    const pending = await unseal(cookieValue(request, 'jaco_oauth'), env.SESSION_SECRET);
    const q = url.searchParams;
    if (q.get('error')) return message(400, 'Sign-in was cancelled.', clear);
    if (!pending || !q.get('code') || q.get('state') !== pending.state) return message(400, 'The sign-in expired or did not match. Please start again.', clear);
    const token = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: q.get('code'), client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: REDIRECT, grant_type: 'authorization_code', code_verifier: pending.verifier }),
    });
    if (!token.ok) return message(502, 'Google did not accept the sign-in. Please try again.', clear);
    const claims = idTokenClaims((await token.json()).id_token);
    const now = Math.floor(Date.now() / 1e3);
    const valid = claims && claims.aud === env.GOOGLE_CLIENT_ID && ['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) && claims.exp > now && claims.nonce === pending.nonce && claims.email_verified === true && claims.sub && claims.email;
    if (!valid) return message(400, 'The sign-in could not be verified.', clear);
    const session = await seal({ sub: claims.sub, email: claims.email, name: claims.name || claims.email, exp: now + SESSION_DAYS * 86400 }, env.SESSION_SECRET);
    const res = new Response(null, { status: 302, headers: { location: '/' } });
    res.headers.append('set-cookie', clear);
    res.headers.append('set-cookie', cookie('jaco_session', session, { maxAge: SESSION_DAYS * 86400 }));
    return res;
  }
  return json({ error: 'not_found' }, 404);
}
