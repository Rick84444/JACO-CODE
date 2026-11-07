// Google operator identity for the local JACO runtime. A real OAuth 2.0
// authorization-code+PKCE round trip; credentials and tokens never reach Aura.
// This establishes who authorized JACO, NOT third-party website login or
// authorization for Google API scopes beyond openid/email/profile.
import crypto from 'node:crypto';

const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const base64url = bytes => Buffer.from(bytes).toString('base64url');
const random = () => base64url(crypto.randomBytes(32));
const PKCE = verifier => base64url(crypto.createHash('sha256').update(verifier).digest());

export function googleOAuthConfig(env = process.env) {
  const clientId = String(env.JACO_GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = String(env.JACO_GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  const redirectUri = String(env.JACO_GOOGLE_OAUTH_REDIRECT_URI || 'http://127.0.0.1:3000/api/aura/google/callback');
  let url;
  try { url = new URL(redirectUri); } catch { throw Error('GOOGLE_REDIRECT_URI_INVALID'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.pathname !== '/api/aura/google/callback' || url.search || url.hash || url.username || url.password) {
    throw Error('GOOGLE_REDIRECT_URI_MUST_BE_LOOPBACK_CALLBACK');
  }
  return { configured:Boolean(clientId && clientSecret), clientId, clientSecret, redirectUri:url.href };
}

export function createGoogleOperatorOAuth({ env = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const pending = new Map();
  let verifiedAccount = null;
  function start() {
    const config=googleOAuthConfig(env);
    if (!config.configured) throw Error('GOOGLE_OAUTH_NOT_CONFIGURED');
    // A pending authorization is memory-only, short lived and single-use.
    for (const [k,v] of pending) if (v.expiresAt <= now()) pending.delete(k);
    if (pending.size >= 8) throw Error('GOOGLE_AUTH_TOO_MANY_PENDING');
    const state=random(), nonce=random(), verifier=random();
    pending.set(state,{nonce,verifier,expiresAt:now()+10*60_000});
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for (const [k,v] of Object.entries({
      client_id:config.clientId, redirect_uri:config.redirectUri, response_type:'code',
      scope:'openid email profile', state, nonce,
      code_challenge:PKCE(verifier), code_challenge_method:'S256',
      access_type:'online', prompt:'select_account'
    })) url.searchParams.set(k,v);
    return {url:url.href,expiresInSeconds:600};
  }
  async function complete({state,code,error}={}) {
    const entry=pending.get(String(state||''));
    if (entry) pending.delete(String(state));
    if (!entry || entry.expiresAt <= now()) throw Error('GOOGLE_AUTH_STATE_INVALID_OR_EXPIRED');
    if (error) throw Error('GOOGLE_AUTH_OPERATOR_DECLINED');
    if (!code || typeof code !== 'string' || code.length > 4096) throw Error('GOOGLE_AUTH_CODE_MISSING');
    const config=googleOAuthConfig(env);
    const token=await fetchImpl('https://oauth2.googleapis.com/token',{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({grant_type:'authorization_code',code,
        client_id:config.clientId,client_secret:config.clientSecret,
        code_verifier:entry.verifier,redirect_uri:config.redirectUri}),
      signal:AbortSignal.timeout(15000),
    });
    if (!token.ok) throw Error('GOOGLE_AUTH_TOKEN_EXCHANGE_FAILED');
    const payload=await token.json();
    if (typeof payload.id_token !== 'string') throw Error('GOOGLE_ID_TOKEN_MISSING');
    // Ask Google to verify the token signature and claims. Never decode
    // an unsigned JWT and treat it as an authenticated identity.
    const info=await fetchImpl('https://oauth2.googleapis.com/tokeninfo?id_token='+encodeURIComponent(payload.id_token),
      {signal:AbortSignal.timeout(15000)});
    if (!info.ok) throw Error('GOOGLE_ID_TOKEN_VERIFICATION_FAILED');
    const claims=await info.json();
    const expiry=Number(claims.exp);
    if (claims.aud !== config.clientId || !ISSUERS.has(claims.iss) ||
      claims.nonce !== entry.nonce || !Number.isFinite(expiry) || expiry * 1000 <= now() ||
      !claims.sub || claims.email_verified !== 'true') throw Error('GOOGLE_ID_TOKEN_CLAIMS_INVALID');
    verifiedAccount={sub:String(claims.sub),email:String(claims.email||''),verifiedAt:new Date(now()).toISOString()};
    return {connected:true,account:{email:verifiedAccount.email,verifiedAt:verifiedAccount.verifiedAt}};
  }
  function status() {
    let configured=false,reason=null;
    try {configured=googleOAuthConfig(env).configured;} catch(error){reason=error.message;}
    return {configured,connected:Boolean(verifiedAccount),identity:verifiedAccount
      ? {email:verifiedAccount.email,verifiedAt:verifiedAccount.verifiedAt} : null,
      scopes:['openid','email','profile'],permissions:'IDENTITY_ONLY',reason};
  }
  return {start,complete,status};
}

export function mountGoogleOperatorOAuth(app, requireLocalUi, options={}) {
  const provider=createGoogleOperatorOAuth(options);
  app.get('/api/aura/google/status',requireLocalUi,(_req,res)=>res.json({success:true,...provider.status()}));
  app.post('/api/aura/google/start',requireLocalUi,(_req,res)=>{
    try {res.set('Cache-Control','no-store');res.json({success:true,...provider.start()});}
    catch(error){res.status(409).json({success:false,error:error.message});}
  });
  app.get('/api/aura/google/callback',async(req,res)=>{
    res.set('Cache-Control','no-store');
    res.set('Referrer-Policy','no-referrer');
    try {
      // The redirect comes back through the operator's local browser.
      const cfg=googleOAuthConfig(options.env||process.env);
      if (String(req.get('host')||'').toLowerCase() !== new URL(cfg.redirectUri).host.toLowerCase()) throw Error('GOOGLE_CALLBACK_HOST_MISMATCH');
      await provider.complete({state:req.query.state,code:req.query.code,error:req.query.error});
      res.redirect(303,'/?googleConnection=connected');
    } catch {res.status(400).type('text/plain').send('Google authorization was not completed. Return to JACO Connections and try again.');}
  });
  return provider;
}
