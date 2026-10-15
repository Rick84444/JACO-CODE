// Remote IDE (operator 2026-10-04: "like vscode.dev, in our Android"). The IDE is reached from the phone
// through the tunnel at JACO_IDE_PUBLIC_HOST (explicitly configured). Every request that arrives through
// a proxy must carry a signed-in IDE session; nothing else from the outside reaches the runtime. A session
// is an 'ide' key from the device registry (deviceAccess.mjs), obtained once with a pairing code from the
// IDE's Devices view, kept in an HttpOnly cookie and revocable there. Requests from this computer itself
// (loopback, not proxied) are unchanged. The terminal stays local only (requireLocalUiSameOrigin).

export const IDE_COOKIE = 'jaco_ide';
export const PUBLIC_APP_FILES = new Set(['/manifest.webmanifest', '/branding/jaco-icon-192.png', '/branding/jaco-icon-512.png']);
const SESSION_DAYS = 30;
const PAIR_ATTEMPTS_PER_HOUR = 10;

export const isProxied = req => Boolean(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.headers['x-forwarded-host']);
export const ideHost = (env = process.env) => String(env.JACO_IDE_PUBLIC_HOST || '').trim().toLowerCase();

export function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
  }
  return null;
}

// The signed-in device for a proxied request, or null.
export function ideSessionOf(req, registry) {
  return registry.verify(readCookie(req.headers.cookie, IDE_COOKIE) || '', 'ide');
}

const loginPage = () => `<!doctype html>
<html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#050b11"><title>JACO IDE - logga in</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#050b11;color:#e2e8f0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px}
main{width:100%;max-width:380px}h1{font-size:22px;margin:0 0 4px;letter-spacing:.02em}p{color:#94a3b8;font-size:14px;margin:0 0 20px}
label{display:block;font-size:13px;color:#94a3b8;margin-bottom:6px}input{width:100%;padding:14px;border-radius:10px;border:1px solid #1e3a4c;background:#0b1520;color:#fff;font:600 22px/1 ui-monospace,monospace;letter-spacing:.15em;text-align:center;text-transform:uppercase}
button{width:100%;margin-top:14px;padding:14px;border:0;border-radius:10px;background:#0e7490;color:#fff;font-size:16px;font-weight:600}button:disabled{opacity:.5}
#msg{min-height:22px;margin-top:12px;font-size:14px;color:#fca5a5}small{display:block;margin-top:24px;color:#64748b;font-size:12px}
</style></head><body><main>
<h1>JACO IDE</h1><p>Skapa en kod på datorn: Enheter, Lägg till enhet, Webbläsare. Koden gäller en gång i 10 minuter.</p>
<form id="f"><label for="c">Parkopplingskod</label><input id="c" autocomplete="one-time-code" inputmode="text" placeholder="XXXXX-XXXXX" maxlength="11" required>
<button id="b" type="submit">Logga in</button><div id="msg" role="status"></div></form>
<small>Inloggningen gäller i ${SESSION_DAYS} dagar på den här enheten och kan spärras från datorn.</small>
</main><script src="/ide-login.js"></script></body></html>`;

// A file of its own: the production CSP is script-src 'self', which blocks inline scripts. Inline, the
// form fell back to a plain reload and nobody could sign in (2026-10-08, dist/server.cjs).
export const LOGIN_SCRIPT = `const f=document.getElementById('f'),b=document.getElementById('b'),m=document.getElementById('msg');
f.addEventListener('submit',async e=>{e.preventDefault();b.disabled=true;m.textContent='';
try{const r=await fetch('/ide-auth/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:document.getElementById('c').value})});
const d=await r.json().catch(()=>({}));if(r.ok&&d.success){location.replace('/');return}
m.textContent=d.error==='PAIRING_CODE_INVALID_OR_EXPIRED'?'Fel eller utgången kod. Skapa en ny på datorn.':d.error==='TOO_MANY_ATTEMPTS'||d.error==='PAIRING_LOCKED_TRY_LATER'?'För många försök. Vänta och försök igen.':'Inloggningen misslyckades ('+(d.error||r.status)+').'}
catch{m.textContent='Hubben svarar inte.'}b.disabled=false});
`;

// Mounted first, before every route, static file and the Vite dev server.
/**
 * @param {{ verify: (key: string, kind: string) => any, redeem: (code: string, kind: string) => any }} registry
 * @param {{ env?: Record<string, string | undefined>, onEvent?: (event: any) => void }} [options]
 */
export function createIdeRemoteGate(registry, { env = process.env, onEvent = () => {} } = {}) {
  const attempts = new Map();
  const allowed = ip => {
    const now = Date.now();
    const hits = (attempts.get(ip) || []).filter(t => now - t < 3_600_000);
    if (hits.length >= PAIR_ATTEMPTS_PER_HOUR) return false;
    hits.push(now); attempts.set(ip, hits);
    if (attempts.size > 10_000) attempts.clear();
    return true;
  };
  return function ideRemoteGate(req, res, next) {
    if (!isProxied(req)) return next();
    const host = String(req.headers.host || req.headers['x-forwarded-host'] || '').toLowerCase().replace(/:\d+$/, '');
    if (!ideHost(env) || host !== ideHost(env)) return res.status(403).json({ success: false, error: 'HOST_NOT_SERVED' });
    const path = req.path || '/';
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');

    // The browser fetches the app manifest and its icons without the session cookie when installing
    // the IDE as an app; they hold only the app name and logo.
    if (req.method === 'GET' && PUBLIC_APP_FILES.has(path)) return next();
    if (req.method === 'GET' && path === '/ide-login.js') {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      return res.end(LOGIN_SCRIPT);
    }
    if (req.method === 'GET' && path === '/ide-login') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(loginPage());
    }
    if (req.method === 'POST' && path === '/ide-auth/pair') {
      const ip = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (!allowed(ip)) return res.status(429).json({ success: false, error: 'TOO_MANY_ATTEMPTS' });
      try {
        const { device, key } = registry.redeem(req.body?.code, 'ide');
        res.setHeader('Set-Cookie', `${IDE_COOKIE}=${encodeURIComponent(key)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`);
        onEvent({ type: 'ide.session.paired', device: device.name });
        return res.json({ success: true, device: device.name });
      } catch (error) {
        return res.status(401).json({ success: false, error: error?.message || 'PAIRING_FAILED' });
      }
    }

    const session = ideSessionOf(req, registry);
    if (!session) {
      if (path.startsWith('/api/') || req.method !== 'GET') return res.status(401).json({ success: false, error: 'IDE_LOGIN_REQUIRED' });
      return res.redirect(302, '/ide-login');
    }
    // Changes only from the IDE page itself: the cookie is SameSite=Strict, and the browser's Origin
    // must be the IDE host.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = String(req.headers.origin || '');
      if (origin !== `https://${ideHost(env)}`) return res.status(403).json({ success: false, error: 'CROSS_ORIGIN_DENIED' });
    }
    if (req.method === 'POST' && path === '/ide-auth/logout') {
      res.setHeader('Set-Cookie', `${IDE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
      return res.json({ success: true });
    }
    // Command execution stays on this computer: these routes run commands from the request body, and
    // some accept a loopback caller without a token (the tunnel connects from loopback).
    if (COMMAND_ROUTES.test(path)) return res.status(403).json({ success: false, error: 'TERMINAL_LOCAL_ONLY' });
    req.ideSession = session;
    return next();
  };
}

// Case-insensitive like Express routing, so /API/Terminal/exec is caught too.
export const COMMAND_ROUTES = /^\/+api\/+(terminal|termux|openclaw)(\/|$)|^\/+api\/+plans\/+[^/]+\/+step\/+execute-live\/?$/i;

// For WebSocket upgrades, which do not pass through Express middleware.
export function upgradeAllowed(request, registry, env = process.env) {
  if (!isProxied(request)) return true;
  const host = String(request.headers.host || request.headers['x-forwarded-host'] || '').toLowerCase().replace(/:\d+$/, '');
  if (!ideHost(env) || host !== ideHost(env)) return false;
  const origin = String(request.headers.origin || '');
  if (origin && origin !== `https://${ideHost(env)}`) return false;
  return Boolean(ideSessionOf(request, registry));
}
