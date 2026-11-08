// Aura's window: the operator watches Aura work in her own Chrome window (operator 2026-11-08: "a CDP window where you
// can see Aura steer the mouse and the page; it should glow faint blue like when Claude or Codex borrows the browser,
// with a blue arrow; the user can see and stop it; a small chat window where you can write without the mission
// ending; the user can work in another window meanwhile").
//
// The overlay is drawn by JACO, not by the site: it runs in an isolated world named jaco-aura, which the page's own
// scripts cannot reach, and the binding it reports through exists only in that world. Its buttons act only on the
// operator's real (trusted) clicks, so a page cannot press Stop or post into the chat. Nothing the overlay shows or
// sends is a credential.
export const OVERLAY_WORLD = 'jaco-aura';
export const OVERLAY_BINDING = '__jacoAura';

const WORDS = {
  sv: { title: 'Aura', working: 'Arbetar i det här fönstret', idle: 'Väntar', placeholder: 'Skriv till Aura, uppdraget fortsätter…', send: 'Skicka', stop: 'Stoppa', sure: 'Ja, stoppa', stopped: 'Uppdraget stoppas.', hide: 'Dölj', show: 'Aura' },
  en: { title: 'Aura', working: 'Working in this window', idle: 'Waiting', placeholder: 'Write to Aura, the mission continues…', send: 'Send', stop: 'Stop', sure: 'Yes, stop', stopped: 'The mission is stopping.', hide: 'Hide', show: 'Aura' },
};

export function overlaySource(language = 'en') {
  const w = WORDS[language === 'sv' ? 'sv' : 'en'];
  return `(() => {
  if (window.__jacoAuraUi || document.querySelector('jaco-aura-overlay')) return;
  const W = ${JSON.stringify(w)};
  const send = message => { try { ${OVERLAY_BINDING}(JSON.stringify(message)); } catch {} };
  const host = document.createElement('jaco-aura-overlay');
  // Not part of the page Aura reads: she must never take her own chat box for a field on the site.
  host.setAttribute('aria-hidden', 'true');
  const root = host.attachShadow({ mode: 'closed' });
  // A constructed stylesheet: a site whose CSP forbids inline <style> (jacocode.com does) would otherwise leave the
  // overlay unstyled at the bottom of the page.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(\`
    :host { all: initial; }
    .edge { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; border-radius: 6px; opacity: 0; transition: opacity .4s; box-shadow: inset 0 0 0 2px rgba(56,189,248,.55), inset 0 0 22px rgba(56,189,248,.25); }
    .edge.on { opacity: 1; animation: pulse 2.2s ease-in-out infinite; }
    @keyframes pulse { 50% { box-shadow: inset 0 0 0 2px rgba(56,189,248,.95), inset 0 0 36px rgba(56,189,248,.4); } }
    @media (prefers-reduced-motion: reduce) { .edge.on { animation: none; } }
    .cursor { position: fixed; left: 0; top: 0; width: 26px; height: 26px; pointer-events: none; z-index: 2147483647; opacity: 0; transition: transform .45s cubic-bezier(.2,.8,.2,1), opacity .3s; filter: drop-shadow(0 0 6px rgba(56,189,248,.95)); }
    .cursor.on { opacity: 1; }
    .ring { position: absolute; left: -9px; top: -9px; width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(56,189,248,.9); opacity: 0; }
    .ring.go { animation: ring .6s ease-out; }
    @keyframes ring { from { opacity: 1; transform: scale(.4); } to { opacity: 0; transform: scale(2.2); } }
    .panel { position: fixed; right: 16px; bottom: 16px; width: 290px; z-index: 2147483647; font: 13px/1.45 system-ui, sans-serif; color: #e5e7eb; background: rgba(10,12,16,.94); border: 1px solid rgba(148,163,184,.35); border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.45); }
    .head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid rgba(148,163,184,.2); }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #64748b; }
    .on .dot { background: #38bdf8; box-shadow: 0 0 8px #38bdf8; }
    .name { font-weight: 600; } .state { color: #94a3b8; font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hide { background: none; border: 0; color: #94a3b8; cursor: pointer; font: inherit; }
    .body { padding: 8px 10px; display: grid; gap: 6px; }
    .log { max-height: 160px; overflow-y: auto; display: grid; gap: 4px; font-size: 12px; }
    .log p { margin: 0; } .log .you { color: #cbd5e1; } .log .aura { color: #7dd3fc; }
    textarea { resize: none; height: 46px; border-radius: 6px; border: 1px solid rgba(148,163,184,.35); background: #0b0f14; color: #e5e7eb; padding: 6px; font: inherit; }
    .row { display: flex; gap: 6px; }
    button.b { flex: 1; border-radius: 6px; border: 1px solid rgba(148,163,184,.4); background: #111827; color: #e5e7eb; padding: 5px 8px; cursor: pointer; font: inherit; }
    button.send { background: #0e639c; border-color: #0e639c; }
    button.stop.sure { background: #7f1d1d; border-color: #b91c1c; }
    .small .body { display: none; } .small { width: auto; }\`);
  root.adoptedStyleSheets = [sheet];
  root.innerHTML = \`<div class="edge"></div>
  <div class="cursor"><svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 2l17 9.5-7.4 1.6L9.6 21z" fill="#38bdf8" stroke="#e0f2fe" stroke-width="1.2" stroke-linejoin="round"/></svg><div class="ring"></div></div>
  <div class="panel"><div class="head"><span class="dot"></span><span class="name">\${W.title}</span><span class="state">\${W.idle}</span><button class="hide" type="button">\${W.hide}</button></div>
    <div class="body"><div class="log" aria-live="polite"></div><textarea placeholder="\${W.placeholder}"></textarea>
      <div class="row"><button class="b send" type="button">\${W.send}</button><button class="b stop" type="button">\${W.stop}</button></div></div></div>\`;
  const $ = s => root.querySelector(s);
  const edge = $('.edge'), cursor = $('.cursor'), ring = $('.ring'), panel = $('.panel'), state = $('.state'), log = $('.log'), text = $('textarea'), stop = $('.stop');
  let idleTimer = null, sure = false;
  const line = (who, words) => { const p = document.createElement('p'); p.className = who; p.textContent = words; log.append(p); while (log.children.length > 30) log.firstChild.remove(); log.scrollTop = log.scrollHeight; };
  const working = words => {
    // Keep what she said she is doing while she keeps working; the plain "working" line only when nothing was said.
    const wasOn = edge.classList.contains('on');
    edge.classList.add('on'); panel.classList.add('on'); state.textContent = words || (wasOn ? state.textContent : W.working);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { edge.classList.remove('on'); panel.classList.remove('on'); cursor.classList.remove('on'); state.textContent = W.idle; }, 20000);
  };
  const submit = () => { const t = text.value.trim(); if (!t) return; text.value = ''; line('you', t); send({ type: 'chat', text: t.slice(0, 2000) }); };
  // Only the operator's own clicks and keys count: a page script cannot produce a trusted event.
  $('.send').addEventListener('click', e => { if (e.isTrusted) submit(); });
  text.addEventListener('keydown', e => { if (e.isTrusted && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } e.stopPropagation(); });
  text.addEventListener('keyup', e => e.stopPropagation()); text.addEventListener('keypress', e => e.stopPropagation());
  stop.addEventListener('click', e => {
    if (!e.isTrusted) return;
    if (!sure) { sure = true; stop.classList.add('sure'); stop.textContent = W.sure; setTimeout(() => { sure = false; stop.classList.remove('sure'); stop.textContent = W.stop; }, 5000); return; }
    sure = false; stop.classList.remove('sure'); stop.textContent = W.stop; line('aura', W.stopped); send({ type: 'stop' });
  });
  $('.hide').addEventListener('click', e => { if (!e.isTrusted) return; panel.classList.toggle('small'); e.target.textContent = panel.classList.contains('small') ? W.show : W.hide; });
  const mount = () => { if (!host.isConnected) (document.body || document.documentElement).append(host); };
  mount(); new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: false });
  window.__jacoAuraUi = {
    point(x, y, click) {
      // A click under the panel goes to the page: the panel steps aside for a moment.
      const r = panel.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { panel.style.visibility = 'hidden'; setTimeout(() => { panel.style.visibility = ''; }, 1500); }
      cursor.classList.add('on'); cursor.style.transform = 'translate(' + (x - 3) + 'px,' + (y - 2) + 'px)'; working(); if (click) { ring.classList.remove('go'); void ring.offsetWidth; ring.classList.add('go'); } },
    working, line,
  };
})();`;
}

// Keeps one connection to the tab Aura works in, draws the overlay there, and turns the operator's actions in it into
// runtime calls: chat steers the running mission (it does not end it) and gets an answer, Stop cancels the mission.
export function createAuraOverlay({ CDPSession, runtimeUrl = 'http://127.0.0.1:3000', fetchImpl = fetch, language = () => 'en', missionId = () => null, log = () => {} }) {
  let tabId = null, session = null, contextId = null, mainFrame = null;
  const reset = () => { try { session?.close(); } catch {} tabId = null; session = null; contextId = null; mainFrame = null; };
  const runtime = (path, body) => fetchImpl(runtimeUrl + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) }).then(r => r.json()).catch(error => ({ success: false, error: String(error?.message || error) }));
  async function evaluateUi(expression) {
    if (!session || !contextId) return;
    try { await session.send('Runtime.evaluate', { expression, contextId }, 3000); } catch { /* the page is navigating; the next action redraws it */ }
  }
  async function onMessage(raw) {
    let message; try { message = JSON.parse(raw); } catch { return; }
    const id = missionId();
    if (message.type === 'stop') {
      if (id) await runtime(`/api/aura/workbench/missions/${encodeURIComponent(id)}/cancel`, { reason: 'Stopped from Aura\'s window' });
      return;
    }
    if (message.type !== 'chat' || typeof message.text !== 'string' || !message.text.trim()) return;
    const text = message.text.trim().slice(0, 2000);
    const at = new Date().toISOString();
    await runtime('/api/aura/chat/session/messages', { id: crypto.randomUUID(), role: 'user', content: text, meta: 'From Aura\'s window', at });
    if (id) await runtime(`/api/aura/workbench/missions/${encodeURIComponent(id)}/steer`, { instruction: text, requestId: crypto.randomUUID() });
    const answer = await runtime('/api/aura/chat', { message: text, interactionMode: 'question', connectedSession: { id: crypto.randomUUID(), source: 'Aura window' }, messagesHistory: [] });
    const reply = String(answer?.reply || answer?.text || '').trim();
    if (reply) {
      await runtime('/api/aura/chat/session/messages', { id: crypto.randomUUID(), role: 'assistant', content: reply, meta: 'Answered in Aura\'s window', at: new Date().toISOString() });
      await evaluateUi(`window.__jacoAuraUi && window.__jacoAuraUi.line('aura', ${JSON.stringify(reply.slice(0, 1200))})`);
    }
  }
  async function attach(tab) {
    if (!tab?.webSocketDebuggerUrl) return;
    if (session && tabId === tab.id) return;
    reset();
    const next = new CDPSession(tab.webSocketDebuggerUrl);
    await next.ready();
    session = next; tabId = tab.id;
    next.ws.addEventListener?.('close', () => { if (session === next) reset(); });
    next.on('Runtime.executionContextCreated', ({ context }) => {
      if (context?.name === OVERLAY_WORLD && (!mainFrame || context.auxData?.frameId === mainFrame)) contextId = context.id;
    });
    next.on('Runtime.bindingCalled', ({ name, payload, executionContextId }) => {
      if (name === OVERLAY_BINDING && executionContextId === contextId) onMessage(payload).catch(error => log('overlay', String(error?.message || error)));
    });
    try {
      mainFrame = (await next.send('Page.getFrameTree')).frameTree?.frame?.id || null;
      await next.send('Runtime.enable');
      await next.send('Runtime.addBinding', { name: OVERLAY_BINDING, executionContextName: OVERLAY_WORLD });
      await next.send('Page.addScriptToEvaluateOnNewDocument', { source: overlaySource(language()), worldName: OVERLAY_WORLD, runImmediately: true });
      // runImmediately draws it in the open page too; only an older Chrome needs the world made by hand.
      await new Promise(r => setTimeout(r, 300));
      if (!contextId && mainFrame) {
        const world = await next.send('Page.createIsolatedWorld', { frameId: mainFrame, worldName: OVERLAY_WORLD });
        contextId = world.executionContextId;
        await next.send('Runtime.evaluate', { expression: overlaySource(language()), contextId });
      }
    } catch (error) { log('overlay', String(error?.message || error)); }
  }
  return {
    attach,
    point: (x, y, click = false) => evaluateUi(`window.__jacoAuraUi && window.__jacoAuraUi.point(${Number(x) || 0}, ${Number(y) || 0}, ${click ? 'true' : 'false'})`),
    working: words => evaluateUi(`window.__jacoAuraUi && window.__jacoAuraUi.working(${JSON.stringify(String(words || '').slice(0, 120))})`),
    close: reset,
  };
}
