// JACO Nova Bridge — Chrome CDP wrapper for agent browser control
// Listens on port 4243, connects to Chrome CDP at port 9222
// No external dependencies — uses Node.js 24+ built-in WebSocket + fetch

import { timingSafeEqual, createHash } from 'node:crypto';
import { createServer } from "http";
import { writeFileSync, existsSync, readFileSync, mkdirSync, renameSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { buildAgentCard, joinWorkplace } from "./lib/workplace-session.mjs";

const CDP_PORT = parseInt(process.env.CDP_PORT || "9222");
const BRIDGE_PORT = parseInt(process.env.NOVA_BRIDGE_PORT || "4243");
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTES_FILE = join(__dirname, ".agent-state", "nova-routes.json");

// ── CDP helpers ──────────────────────────────────────────────────────────────

let selectedTabId = process.env.CDP_TARGET_ID || null;
const TOKEN=process.env.JACO_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || '';
const ORIGINS=new Set((process.env.JACO_BROWSER_ALLOWED_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean));
function allowed(url) { try {return ORIGINS.has(new URL(url).origin);} catch {return false;} }
// Level-5 profile: Nova may READ the public web (navigate, observe, survey, screenshot). Input
// (click/type) stays limited to JACO_BROWSER_ALLOWED_ORIGINS and the server-side spend guard.
const READ_ANY_ORIGIN = process.env.JACO_BROWSER_READ_ANY_ORIGIN !== '0';
function readable(url) {
  try { const u=new URL(url); return u.href==='about:blank' || (READ_ANY_ORIGIN ? ['http:','https:'].includes(u.protocol) : ORIGINS.has(u.origin)); }
  catch { return false; }
}
function authorized(req) { const a=Buffer.from(req.headers.authorization || ''),b=Buffer.from('Bearer '+TOKEN);return TOKEN.length>=24 && a.length===b.length && timingSafeEqual(a,b); }
async function getTabs() {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json`, {signal:AbortSignal.timeout(5000)});
  if (!r.ok) throw new Error("CDP_HTTP_" + r.status);
  return r.json();
}

// Nova works in its own tab. It used to pin the only allowed tab, which was the operator's IDE,
// so every survey navigated the IDE away (and several open IDE tabs made the choice ambiguous).
// CDP_TARGET_ID still pins an explicit tab when the operator wants that.
let novaTabId = null;
async function getActiveTab() {
  const tabs = await getTabs();
  if (selectedTabId) {
    const pinned=tabs.find(t=>t.id===selectedTabId && t.type==='page' && t.webSocketDebuggerUrl && readable(t.url));
    if (!pinned) throw new Error('SELECTED_TAB_CLOSED_OR_ORIGIN_DENIED');
    return pinned;
  }
  const own = novaTabId && tabs.find(t=>t.id===novaTabId && t.type==='page' && t.webSocketDebuggerUrl);
  if (own) return own;
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method:'PUT', signal:AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error('CDP_NEW_TAB_FAILED_' + r.status);
  const created = await r.json();
  novaTabId = created.id;
  return created;
}

export class CDPSession {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.msgId = 0;
    this.pending = new Map();
    this.ws.addEventListener("message", (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg?.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else if (msg.result?.exceptionDetails) reject(new Error(msg.result.exceptionDetails.exception?.description || msg.result.exceptionDetails.text || "CDP_EVALUATION_FAILED"));
        else resolve(msg.result);
      }
    });
  }

  async ready(timeoutMs = 5000) {
    if (this.ws.readyState === 1) return;
    if (this.ws.readyState === 3) throw new Error('CDP_WEBSOCKET_CLOSED');
    await new Promise((resolve, reject) => {
      let done = false;
      const finish = error => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.ws.removeEventListener('open', onOpen);
        this.ws.removeEventListener('error', onError);
        this.ws.removeEventListener('close', onClose);
        error ? reject(error) : resolve();
      };
      const onOpen = () => finish();
      const onError = () => finish(new Error('CDP_WEBSOCKET_ERROR'));
      const onClose = () => finish(new Error('CDP_WEBSOCKET_CLOSED'));
      const timer = setTimeout(() => finish(new Error('CDP_WEBSOCKET_TIMEOUT')), timeoutMs);
      this.ws.addEventListener('open', onOpen);
      this.ws.addEventListener('error', onError);
      this.ws.addEventListener('close', onClose);
      if (this.ws.readyState === 1) onOpen();
      else if (this.ws.readyState === 3) onClose();
    });
  }

  send(method, params = {}, timeoutMs = 15000) {
    const id = ++this.msgId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject:  (e) => { clearTimeout(timer); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { try { this.ws.close(); } catch {} }
}

export async function captureSession(session) {
  // Background tabs may not submit compositor frames. Activate the owned Nova tab before capture.
  await session.send('Page.bringToFront');
  const result=await session.send('Page.captureScreenshot',{format:'png'});
  if(typeof result.data!=='string'||!result.data.length)throw new Error('SCREENSHOT_DATA_MISSING');
  return {ok:true,observed:true,mimeType:'image/png',...result};
}

async function withTab(fn, { input = false, missionOrigin = null } = {}) {
  const tab = await getActiveTab();
  const session = new CDPSession(tab.webSocketDebuggerUrl);
  await session.ready();
  try {
    const current=await evaluate(session,'location.href');
    if (!(input ? allowed(current) || (missionOrigin && new URL(current).origin===missionOrigin) : readable(current))) throw new Error('ORIGIN_DENIED');
    return await fn(session, tab);
  } finally {
    session.close();
  }
}

// Aura browser readiness is an observed CDP command, never just an HTTP listener.
// The probe is read-only and does not create tabs or navigate the operator's page.
export async function probeCdpBrowser({
  listTabs = getTabs,
  sessionFactory = url => new CDPSession(url),
  selectedId = selectedTabId,
} = {}) {
  let session = null;
  try {
    const tabs = await listTabs();
    if (!Array.isArray(tabs)) return { ok: false, state: 'BLOCKED', browserVerified: false, error: 'CDP_TARGET_LIST_INVALID' };
    const pages = tabs.filter(t => {
      if (t?.type !== 'page' || typeof t.webSocketDebuggerUrl !== 'string') return false;
      try {
        const ws = new URL(t.webSocketDebuggerUrl);
        return ws.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(ws.hostname)
          && Number(ws.port) === CDP_PORT && ws.pathname.startsWith('/devtools/page/')
          && !ws.username && !ws.password;
      } catch { return false; }
    });
    const target = selectedId ? pages.find(t => t.id === selectedId && readable(t.url)) : pages[0];
    if (!target) return {
      ok: false, state: 'BLOCKED', browserVerified: false,
      error: selectedId ? 'CDP_PINNED_TARGET_UNAVAILABLE' : 'CDP_NO_DEBUGGABLE_PAGE',
      targets: pages.length,
    };
    const socket = new URL(target.webSocketDebuggerUrl);
    // Chrome may advertise localhost even when the DevTools TCP forward is IPv4-only.
    if (socket.hostname === 'localhost') socket.hostname = '127.0.0.1';
    session = sessionFactory(socket.href);
    await session.ready(5000);
    const reply = await session.send('Runtime.evaluate', { expression: '1+1', returnByValue: true }, 5000);
    if (reply?.result?.value !== 2 || reply?.exceptionDetails) {
      return { ok: false, state: 'BLOCKED', browserVerified: false, error: 'CDP_EVALUATION_UNVERIFIED' };
    }
    return { ok: true, state: 'READY', browserVerified: true, targets: pages.length };
  } catch (error) {
    const code = String(error?.cause?.code || error?.code || error?.message || 'UNKNOWN').slice(0, 80);
    return { ok: false, state: 'BLOCKED', browserVerified: false, error: 'CDP_CONNECTION_FAILED',
      detail: /^CDP_[A-Z_]+$|^ECONN[A-Z_]+$/.test(code) ? code : 'TRANSPORT_ERROR' };
  } finally {
    try { session?.close(); } catch {}
  }
}

// One in-flight probe per bridge, with a short, bounded receipt lifetime.
// An expired receipt is never READY. Polling does not wait on a slow WebSocket.
export function createBrowserHealthMonitor(probe, {
  clock = Date.now, refreshMs = 1500, validityMs = 4000,
} = {}) {
  let latest = null, finishedAt = 0, pending = null;
  return {
    status() {
      const now = clock();
      if (!pending && (!latest || now - finishedAt >= refreshMs)) {
        pending = Promise.resolve().then(() => probe()).then(value => {
          latest = value?.ok === true && value?.browserVerified === true && value?.state === 'READY'
            ? value : { ok: false, state: 'BLOCKED', browserVerified: false,
              error: value?.error || 'CDP_PROBE_UNVERIFIED' };
          finishedAt = clock();
        }, () => {
          latest = { ok: false, state: 'BLOCKED', browserVerified: false, error: 'CDP_CONNECTION_FAILED' };
          finishedAt = clock();
        }).finally(() => { pending = null; });
      }
      const age = now - finishedAt;
      if (latest?.ok === true && age >= 0 && age <= validityMs) {
        return { ...latest, verifiedAt: new Date(finishedAt).toISOString(), verificationAgeMs: age };
      }
      return { ok: false, state: pending ? 'VERIFYING' : 'BLOCKED', browserVerified: false,
        error: pending && !latest ? 'CDP_PROBE_PENDING' : latest?.error || 'CDP_PROBE_NOT_VERIFIED' };
    },
    async settle() { if (pending) await pending; },
  };
}
const browserHealth = createBrowserHealthMonitor(probeCdpBrowser);

export function contractedBrowserOrigin(mission,{missionId,actionId,expectedUrl},kind) {
  if(!mission || mission.id!==missionId || mission.status!=='ACTIVE' || mission.phase!=='EXECUTING' || mission.activeTask?.id!==actionId || mission.activeTask?.type!==`browser-${kind}`) return null;
  let origin;try{const u=new URL(expectedUrl);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.username||u.password)return null;origin=u.origin;}catch{return null;}
  const receipts=mission.receipts||[],lastWrite=Math.max(-1,...receipts.filter(r=>['repo-write','repo-edit'].includes(r.type)&&r.ok&&r.verified).map(r=>Number(/:turn:(\d+)$/.exec(r.actionId||'')?.[1])||0));
  const lastService=receipts.findLast(r=>{try{return r.type==='repo-service'&&r.result?.url&&new URL(r.result.url).origin===origin;}catch{return false;}});
  const spec=mission.contract?.services?.find(s=>s.id===lastService?.input?.id);
  if(!spec || !lastService.ok || !lastService.verified || lastService.result.state!=='READY' || lastService.result.identity!==spec.identity || Number(/:turn:(\d+)$/.exec(lastService.actionId||'')?.[1])<=lastWrite)return null;
  const stopped=receipts.some(r=>r.type==='repo-service'&&r.input?.id===spec.id&&r.input?.action==='stop'&&r.ok&&Number(/:turn:(\d+)$/.exec(r.actionId||'')?.[1])>Number(/:turn:(\d+)$/.exec(lastService.actionId||'')?.[1]));
  return stopped?null:origin;
}

async function missionBrowserGrant(body,kind) {
  if(!/^mission-[A-Za-z0-9-]+$/.test(String(body.missionId||'')))return null;
  const base=process.env.JACO_RUNTIME_URL||'http://127.0.0.1:3000';
  const r=await fetch(base+`/api/connected/nova/missions/${encodeURIComponent(body.missionId)}`,{headers:{'x-gateway-token':TOKEN},signal:AbortSignal.timeout(5000)});
  if(!r.ok)return null;return contractedBrowserOrigin((await r.json()).mission,body,kind);
}

// ── Bridge operations ────────────────────────────────────────────────────────

export async function evaluate(session, expression) {
  const r = await session.send("Runtime.evaluate", {expression, returnByValue:true, awaitPromise:true});
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || "CDP_EVALUATION_FAILED");
  return r.result?.value;
}
export async function observeSession(session) {
  const data = await evaluate(session, `(() => {
    const selector = e => { const parts=[]; while(e && e.nodeType===1) { let n=1,p=e; while((p=p.previousElementSibling)) if(p.tagName===e.tagName)n++; parts.unshift(e.tagName.toLowerCase()+':nth-of-type('+n+')'); e=e.parentElement; } return parts.join(' > '); };
    // Visible controls first (viewport order), then the rest; plus the readable page text, so Nova
    // can report what a page says instead of only its first 40 links and buttons.
    const all=[...document.querySelectorAll('a,button,input,select,textarea,[role=button],[role=link],[role=tab]')].map(e=>{
      const r=e.getBoundingClientRect(); const visible=r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';
      return {e,r,visible,text:(e.innerText || e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.name || '').trim().replace(/\\s+/g,' ').slice(0,100)};
    });
    const ranked=[...all.filter(x=>x.visible&&x.text), ...all.filter(x=>x.visible&&!x.text), ...all.filter(x=>!x.visible)].slice(0,80);
    const text=(document.body?.innerText||'').replace(/\\n{3,}/g,'\\n\\n').trim().slice(0,6000);
    return {url:location.href,title:document.title,text,targets:ranked.map(({e,r,visible,text})=>({selector:selector(e),text,role:e.getAttribute('role')||e.tagName.toLowerCase(),visible,bbox:[r.x,r.y,r.width,r.height]}))};
  })()`);
  if (!data?.url) throw new Error('OBSERVATION_MISSING');
  return {ok:true, observed:true, at:new Date().toISOString(), ...data};
}
// Read-only page markup for the Aura stage. The page is cleaned inside the browser before anything
// leaves it: no scripts, comments, element values, hidden fields, token/nonce metadata, event handlers,
// data-* attributes, or URL query strings and fragments (where links, images and redirects carry
// tokens, signatures and session ids). Long opaque path segments are redacted for the same reason.
// The tool result reaches the calling agent, so this cleaning is what keeps such values out of model
// context; the durable receipt only keeps a digest. Text visible on the page is returned as shown.
// The copy is visually faithful (structure and styles), never a working replica.
export const MAX_HTML_BYTES = 550_000;
export const HTML_CLEANER = `(() => {
  const root = document.documentElement.cloneNode(true);
  root.querySelectorAll('script,noscript,template,iframe,object,embed,input[type=hidden]').forEach(e => e.remove());
  root.querySelectorAll('meta').forEach(m => {
    const n = (m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv') || '').toLowerCase();
    if (/csrf|xsrf|token|nonce|session|auth|key|secret|refresh/.test(n)) m.remove();
  });
  root.querySelectorAll('textarea').forEach(e => { e.textContent = ''; });
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const comments = []; while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach(c => c.remove());
  const opaque = /^[A-Za-z0-9_~-]{32,}$/;
  const plain = value => {
    const v = String(value || '').trim();
    if (/^#[A-Za-z0-9_-]{0,90}$/.test(v)) return v;
    if (/^data:image\\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+\\/=]+$/i.test(v)) return v;
    let u; try { u = new URL(v, location.href); } catch { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin + u.pathname.split('/').map(s => opaque.test(s) ? 'redacted' : s).join('/');
  };
  const cssUrls = css => String(css || '').replace(/url\\(\\s*(['"]?)(.*?)\\1\\s*\\)/gi, (_, q, inner) => {
    const p = plain(inner); return p ? 'url("' + p.replace(/"/g, '%22') + '")' : 'none';
  });
  const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'poster', 'cite', 'background', 'longdesc', 'manifest', 'xlink:href']);
  root.querySelectorAll('style').forEach(s => { s.textContent = cssUrls(s.textContent); });
  root.querySelectorAll('*').forEach(e => {
    for (const a of [...e.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith('data-') || n.startsWith('on') || n === 'nonce' || n === 'integrity' || n === 'ping') { e.removeAttribute(a.name); continue; }
      if (n === 'value') { e.removeAttribute('value'); continue; }
      if (n === 'checked' || n === 'selected') { e.removeAttribute(a.name); continue; }
      if (URL_ATTRS.has(n)) {
        const p = plain(a.value);
        if (p === null) e.removeAttribute(a.name); else if (p !== a.value) e.setAttribute(a.name, p);
        continue;
      }
      if (n === 'srcset' || n === 'imagesrcset') {
        const list = a.value.split(/\\s*,\\s+/).map(c => { const [u, ...d] = c.trim().split(/\\s+/); const p = plain(u); return p ? [p, ...d].join(' ') : ''; }).filter(Boolean);
        if (list.length) e.setAttribute(a.name, list.join(', ')); else e.removeAttribute(a.name);
        continue;
      }
      if (n === 'style') { e.setAttribute('style', cssUrls(a.value)); continue; }
      if (n === 'content' && e.tagName === 'META' && /^\\s*https?:/i.test(a.value)) {
        const p = plain(a.value); if (p) e.setAttribute('content', p); else e.removeAttribute('content');
      }
    }
  });
  return { url: location.href, title: document.title, html: '<!doctype html>' + root.outerHTML };
})()`;
// Defence in depth: the bridge refuses markup that still carries anything the cleaner should have removed.
const URL_ATTR_WITH_QUERY = /<[a-z][^>]*\s(?:href|src|action|formaction|poster|cite|background|longdesc|manifest|srcset|imagesrcset)\s*=\s*["']?(?!#)(?!data:image\/)[^"'>]*[?#]/i;
// A local fragment such as url(#paint0_linear) is what the cleaner keeps for SVG gradients and filters.
const CSS_URL_WITH_QUERY = /url\(\s*["']?(?!#[A-Za-z0-9_-]{0,90}["']?\s*\))(?!data:image\/)[^)"']*[?#]/i;
// outerHTML escapes quotes and ampersands in attribute values; read style attributes as the browser does.
const decodeAttr = v => v.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
const cssParts = html => [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1])
  .concat([...html.matchAll(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)].map(m => decodeAttr(m[2] ?? m[3] ?? '')));
export function uncleanHtmlReason(html) {
  if (typeof html !== 'string') return 'HTML_MISSING';
  if (/<script[\s>]/i.test(html)) return 'script';
  if (/<!--/.test(html)) return 'comment';
  if (/<input[^>]*\btype\s*=\s*["']?hidden/i.test(html)) return 'hidden-field';
  if (/<[a-z][^>]*\svalue\s*=/i.test(html)) return 'form-value';
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html)) return 'event-handler';
  if (/<[a-z][^>]*\sdata-[\w-]+\s*=/i.test(html)) return 'data-attribute';
  if (URL_ATTR_WITH_QUERY.test(html) || cssParts(html).some(css => CSS_URL_WITH_QUERY.test(css))) return 'url-query';
  return null;
}
export async function htmlSession(session, { isAllowed = allowed } = {}) {
  // Check the origin before the page is read, so a disallowed page's markup never reaches this process.
  const href = await evaluate(session, 'location.href');
  if (!isAllowed(href)) return { ok: false, error: 'ORIGIN_DENIED' };
  const data = await evaluate(session, HTML_CLEANER);
  if (!data?.url || !isAllowed(data.url)) return { ok: false, error: 'ORIGIN_DENIED' };
  const bytes = Buffer.byteLength(data.html || '');
  if (bytes > MAX_HTML_BYTES) return { ok: false, error: 'HTML_TOO_LARGE', bytes };
  const unclean = uncleanHtmlReason(data.html);
  if (unclean) return { ok: false, error: 'HTML_NOT_CLEAN:' + unclean };
  return { ok: true, observed: true, at: new Date().toISOString(), url: data.url, title: String(data.title || '').slice(0, 300),
    html: data.html, bytes, sha256: createHash('sha256').update(data.html).digest('hex') };
}
export async function navigateSession(session, url, settleMs=1000) {
  if (!['http:','https:'].includes(new URL(url).protocol)) throw new Error('INVALID_URL');
  await session.send('Page.enable');
  const result=await session.send('Page.navigate',{url});
  if (result.errorText || result.isDownload) throw new Error(result.errorText || 'UNEXPECTED_DOWNLOAD');
  await new Promise(r=>setTimeout(r,Math.min(5000,Math.max(0,settleMs))));
  const observation=await observeSession(session);
  const verified=observation.url===new URL(url).href;
  return {ok:verified, verified, observation, ...(verified?{}:{error:'NAVIGATION_NOT_VERIFIED'})};
}
export async function actSession(session, {selector,text,expectedUrl,expect}, kind) {
  if (typeof selector!=='string' || !selector) throw new Error('SELECTOR_REQUIRED');
  if (kind==='type' && typeof text!=='string') throw new Error('TEXT_REQUIRED');
  const before=await observeSession(session);
  if (expectedUrl && before.url!==expectedUrl) throw new Error('STALE_PAGE');
  const target=await evaluate(session, `(() => { const es=document.querySelectorAll(${JSON.stringify(selector)}); if(es.length!==1)return false; const e=es[0],r=e.getBoundingClientRect(); return !e.disabled&&r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'; })()`);
  if (!target) throw new Error('TARGET_NOT_UNIQUE_OR_ACTIONABLE');
  const predicate = expect?.url ? `location.href===${JSON.stringify(expect.url)}` : expect?.selector ? `(() => {const e=document.querySelector(${JSON.stringify(expect.selector)}); if(!e)return false; const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';})()` : null;
  const alreadySatisfied=predicate ? await evaluate(session,predicate) : false;
  try {
    await evaluate(session, `(() => { const es=document.querySelectorAll(${JSON.stringify(selector)});if(es.length!==1)throw new Error('TARGET_CHANGED');const e=es[0];e.focus();${kind==='click' ? 'e.click();' : `e.value=${JSON.stringify(text)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));`}return true; })()`);
    let verified=kind==='type' ? await evaluate(session, `document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(text)}`) : false;
    // Real asynchronous postcondition: a click may await an API response before rendering.
    if(kind==='click' && predicate && !alreadySatisfied){const deadline=Date.now()+5000;do{verified=Boolean(await evaluate(session,predicate));if(verified)break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);}
    return {ok:true,verified:Boolean(verified),observation:await observeSession(session)};
  } catch(error) { return {ok:false,verified:false,outcomeUnknown:true,error:error.message}; }
}
async function navigate(url,settleMs) { return withTab(s=>navigateSession(s,url,settleMs)); }
async function observe() { return withTab(observeSession); }
async function survey(label) {
  const data=await observe();
  const routes=existsSync(ROUTES_FILE)?JSON.parse(readFileSync(ROUTES_FILE,'utf8')):{};
  const key=label||data.title||data.url;
  routes[key]={...data,label:key,surveyedAt:data.at};
  mkdirSync(dirname(ROUTES_FILE),{recursive:true});
  const temp=ROUTES_FILE+'.tmp';writeFileSync(temp,JSON.stringify(routes,null,2));renameSync(temp,ROUTES_FILE);
  return {...data,label:key,elements:data.targets.length};
}

async function targets() {
  const tabs = await getTabs();
  return { ok: true, tabs: tabs.filter(t=>allowed(t.url)).map(t => ({ id:t.id, title: t.title, url: t.url, type: t.type })) };
}

// ── HTTP server ──────────────────────────────────────────────────────────────

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let size=0;const chunks=[];
  for await (const chunk of req) {size+=chunk.length;if(size>65536)throw new Error('BODY_TOO_LARGE');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

// Only the standalone process joins Workplace; importing the server (tests) leaves it ungated.
let workplace = { allowed: true };

export const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${BRIDGE_PORT}`);
  try {
    if (!authorized(req)) return json(res,{ok:false,error:'UNAUTHORIZED'},401);
    if (!workplace.allowed && url.pathname !== '/health') return json(res,{ok:false,error:'WORKPLACE_UNSYNCED',state:workplace.state},503);
    if (req.headers.origin) return json(res,{ok:false,error:'BROWSER_ORIGIN_DENIED'},403);
    if (req.method==='POST' && ['/navigate','click','type'].includes(url.pathname) && process.env.JACO_GATEWAY_ALLOW_MUTATIONS!=='1') return json(res,{ok:false,error:'MUTATIONS_DISABLED'},403);
    if (req.method === "GET" && url.pathname === "/health") {
      const result = workplace.allowed ? browserHealth.status() :
        { ok: false, state: 'BLOCKED', browserVerified: false, error: 'WORKPLACE_UNSYNCED' };
      const ready = result.ok === true && result.browserVerified === true && workplace.allowed;
      return json(res, { ...result, ok: ready, state: ready ? 'READY' : 'BLOCKED',
        service: 'nova-bridge', cdpPort: CDP_PORT }, ready ? 200 : 503);
    }
    if (req.method === "GET" && url.pathname === "/targets") {
      return json(res, await targets());
    }
    if (req.method === 'GET' && url.pathname === '/screenshot') {
      return json(res,await withTab(captureSession));
    }
    if (req.method === "GET" && url.pathname === "/observe") {
      return json(res, await observe());
    }
    if (req.method === "GET" && url.pathname === "/html") {
      return json(res, await withTab(s=>htmlSession(s)));
    }
    if (req.method === "POST" && url.pathname === "/navigate") {
      const b = await readBody(req);
      if (!readable(b.url)) return json(res,{ok:false,error:'ORIGIN_DENIED'},403);
      return json(res, await navigate(b.url, b.settleMs));
    }
    if (req.method === "POST" && url.pathname === "/click") {
      const b = await readBody(req);
      const missionOrigin=await missionBrowserGrant(b,'click');
      if (!b.expectedUrl || (!allowed(b.expectedUrl)&&!missionOrigin)) return json(res,{ok:false,error:'EXPECTED_ALLOWED_URL_REQUIRED'},400);
      return json(res, await withTab(s=>actSession(s,b,"click"), { input: true,missionOrigin }));
    }
    if (req.method === "POST" && url.pathname === "/type") {
      const b = await readBody(req);
      const missionOrigin=await missionBrowserGrant(b,'type');
      if (!b.expectedUrl || (!allowed(b.expectedUrl)&&!missionOrigin)) return json(res,{ok:false,error:'EXPECTED_ALLOWED_URL_REQUIRED'},400);
      return json(res, await withTab(s=>actSession(s,b,"type"), { input: true,missionOrigin }));
    }
    if (req.method === "POST" && url.pathname === "/survey") {
      const b = await readBody(req);
      return json(res, await survey(b.label));
    }
    json(res, { error: "not found" }, 404);
  } catch (e) {
    json(res, { ok: false, error: e.message }, 500);
  }
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  workplace = { allowed: false, state: 'REGISTERING' };
  server.listen(BRIDGE_PORT, "127.0.0.1", async () => {
    console.log(`JACO Nova Bridge -> http://localhost:${BRIDGE_PORT} (CDP :${CDP_PORT})`);
    let cdp = false;
    try { cdp = (await getTabs()).some(t => t.type === 'page' && t.webSocketDebuggerUrl); } catch {}
    workplace = await joinWorkplace({
      card: buildAgentCard({
        stableId: 'nova-bridge',
        name: 'Nova Bridge',
        agentType: 'runtime',
        role: 'browser-actuator',
        description: 'Authenticated Chrome CDP bridge used by Nova for observe, navigate, click, type and survey.',
        capabilities: { browser_control: cdp, reasoning: false, terminal: false, filesystem_write: false, image_understanding: false },
        tools: cdp ? ['targets', 'screenshot', 'observe', 'navigate', 'click', 'type', 'survey'] : [],
        constraints: [
          `CDP page reachable on :${CDP_PORT} at startup: ${cdp}`,
          `Allowed origins: ${[...ORIGINS].join(', ') || 'none'}`,
          `Mutations enabled: ${process.env.JACO_GATEWAY_ALLOW_MUTATIONS === '1'}`,
        ],
        preferredTasks: ['browser observation', 'browser actions on allowed origins'],
      }),
      log: (level, msg) => console.log(`${level.toUpperCase()} [workplace] ${msg}`),
    });
    if (!workplace.allowed) console.log('ERROR [workplace] Browser tools disabled until this process restarts with a READY Workplace session');
    const stop = async () => { await workplace.end?.(); process.exit(0); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

