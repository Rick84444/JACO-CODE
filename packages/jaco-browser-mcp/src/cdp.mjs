// A minimal Chrome DevTools Protocol client (Node 22 has WebSocket built in), plus starting Chrome when none is listening.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class CDPSession {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.ws.addEventListener('message', event => {
      let msg; try { msg = JSON.parse(event.data); } catch { return; }
      if (msg && typeof msg.method === 'string') for (const fn of this.handlers.get(msg.method) || []) { try { fn(msg.params || {}); } catch { /* listeners never break the session */ } }
      if (msg?.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }
  ready(timeoutMs = 5000) {
    if (this.ws.readyState === 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP_WEBSOCKET_TIMEOUT')), timeoutMs);
      this.ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP_WEBSOCKET_ERROR')); }, { once: true });
    });
  }
  send(method, params = {}, timeoutMs = 15000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, new Set());
    this.handlers.get(method).add(fn);
    return () => this.handlers.get(method)?.delete(fn);
  }
  close() { try { this.ws.close(); } catch { /* already closed */ } }
}

export async function evaluate(session, expression) {
  const r = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'CDP_EVALUATION_FAILED');
  return r.result?.value;
}

// What the agent sees of a page: address, title, readable text and the controls, visible ones first.
export async function observe(session) {
  const data = await evaluate(session, `(() => {
    const selector = e => { const parts=[]; while(e && e.nodeType===1) { let n=1,p=e; while((p=p.previousElementSibling)) if(p.tagName===e.tagName)n++; parts.unshift(e.tagName.toLowerCase()+':nth-of-type('+n+')'); e=e.parentElement; } return parts.join(' > '); };
    const all=[...document.querySelectorAll('a,button,input,select,textarea,[role=button],[role=link],[role=tab]')].map(e=>{
      const r=e.getBoundingClientRect(); const visible=r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';
      return {e,r,visible,text:(e.innerText || e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.name || '').trim().replace(/\\s+/g,' ').slice(0,100)};
    });
    const ranked=[...all.filter(x=>x.visible&&x.text), ...all.filter(x=>x.visible&&!x.text), ...all.filter(x=>!x.visible)].slice(0,80);
    const text=(document.body?.innerText||'').replace(/\\n{3,}/g,'\\n\\n').trim().slice(0,6000);
    return {url:location.href,title:document.title,text,targets:ranked.map(({e,r,visible,text})=>({selector:selector(e),text,role:e.getAttribute('role')||e.tagName.toLowerCase(),visible,bbox:[r.x,r.y,r.width,r.height]}))};
  })()`);
  if (!data?.url) throw new Error('OBSERVATION_MISSING');
  return { ok: true, observed: true, at: new Date().toISOString(), ...data };
}

export const cdpBase = port => `http://127.0.0.1:${port}`;

export async function cdpAvailable(port) {
  try { const r = await fetch(`${cdpBase(port)}/json/version`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
}

const CHROME_PATHS = {
  win32: [
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
};

export function findChrome(env = process.env) {
  if (env.JACO_BROWSER_CHROME && fs.existsSync(env.JACO_BROWSER_CHROME)) return env.JACO_BROWSER_CHROME;
  return (CHROME_PATHS[process.platform] || CHROME_PATHS.linux).find(p => p && fs.existsSync(p)) || null;
}

// A separate profile: the agent never sees the operator's own cookies, passwords or open tabs.
export async function ensureChrome(port, env = process.env) {
  if (await cdpAvailable(port)) return { started: false };
  if (env.JACO_BROWSER_LAUNCH === '0') throw new Error(`No browser on port ${port}. Start Chrome with --remote-debugging-port=${port}.`);
  const chrome = findChrome(env);
  if (!chrome) throw new Error('Chrome or Edge was not found. Install Chrome, or set JACO_BROWSER_CHROME to its path.');
  const profile = env.JACO_BROWSER_PROFILE || path.join(os.homedir(), '.jaco-browser-mcp', 'profile');
  fs.mkdirSync(profile, { recursive: true });
  const child = spawn(chrome, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 40; i++) { if (await cdpAvailable(port)) return { started: true, chrome, profile }; await new Promise(r => setTimeout(r, 250)); }
  throw new Error(`Started ${chrome}, but it did not open port ${port}.`);
}
