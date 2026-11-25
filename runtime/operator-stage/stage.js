// Aura Operator Stage: Aura in the middle and the conversation as the focus. Beside her, glass holograms of
// what she works with: the strategy board, her browser and the tools she calls. A panel lights up blue while she
// uses it or talks about it, then fades; she looks at it, then back at the operator. Everything shown comes from
// real runtime receipts (MCP call log, live mission stream, gameboard, browser frames) and the IDE's chat session.
import { extractWorkspaceActions, workspaceReplyText } from '/vendor/workspace-actions.mjs';
import { speechParts } from '/vendor/speech-parts.mjs';

const $ = id => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- The room: small glowing points at three depths ----------
(function starfield() {
  const canvas = $('stars'), ctx = canvas.getContext('2d');
  let w = 0, h = 0, stars = [];
  function resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    w = canvas.width = innerWidth * dpr; h = canvas.height = innerHeight * dpr;
    const count = Math.round((innerWidth * innerHeight) / 2600);
    stars = Array.from({ length: count }, () => {
      const depth = Math.random() ** 2; // most points far away, a few near
      return { x: Math.random() * w, y: Math.random() * h, depth, r: (0.4 + depth * 1.6) * dpr, phase: Math.random() * 6.28, speed: 0.4 + Math.random() * 1.6 };
    });
  }
  resize(); addEventListener('resize', resize);
  let t = 0;
  (function frame() {
    t += reduceMotion ? 0 : 0.016;
    ctx.clearRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(w / 2, h * 0.3, 0, w / 2, h * 0.3, Math.max(w, h) * 0.6);
    glow.addColorStop(0, 'rgba(20,48,90,0.35)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    for (const s of stars) {
      // Near points drift faster than far ones: parallax gives the room depth.
      s.y -= (0.02 + s.depth * 0.12) * (reduceMotion ? 0 : 1); if (s.y < -4) s.y = h + 4;
      const a = (0.18 + s.depth * 0.6) * (0.65 + 0.35 * Math.sin(t * s.speed + s.phase));
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283);
      ctx.fillStyle = `rgba(${150 + s.depth * 80 | 0},${205 + s.depth * 40 | 0},255,${a})`; ctx.fill();
    }
    requestAnimationFrame(frame);
  })();
})();

// ---------- Aura: her 3D lightform (the IDE portrait's rig) ----------
// She looks at the panel she works in, then back at the operator (eye contact); she does not follow the mouse.
const aura = (() => {
  let rig = null, fallback = null, idle = 0, held = false, gazeTimer = 0;
  const state = { active: false, speaking: false, listening: false, x: 0, y: 0 };
  const apply = () => rig?.setState({ active: state.active });
  import('/vendor/aura-rig.mjs')
    .then(({ createAuraRigLightform }) => createAuraRigLightform($('orb'), { trackPointer: false, onError: () => { fallback ??= particleOrb(); } }))
    .then(instance => { rig = instance; rig.setState(state); })
    .catch(error => { console.warn('Aura rig unavailable, using particle fallback:', error?.message || error); fallback ??= particleOrb(); });
  return {
    pulse(amount = 0.6) {
      fallback?.pulse(amount);
      state.active = true; apply();
      clearTimeout(idle); idle = setTimeout(() => { state.active = held; apply(); }, 4000);
    },
    hold(on) { held = on; if (on) state.active = true; else { clearTimeout(idle); idle = setTimeout(() => { state.active = false; apply(); }, 1500); } apply(); fallback?.pulse(on ? 0.5 : 0); },
    voice(stream) { state.speaking = Boolean(stream); rig?.setState({ audioSource: stream || null, speaking: state.speaking }); fallback?.pulse(stream ? 0.4 : 0); },
    listening(on) { state.listening = on; rig?.setState({ listening: on }); },
    // Turn toward an element on screen, hold, then look straight ahead again.
    lookAt(el, ms = 2400) {
      const c = $('orb').getBoundingClientRect(), r = el.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, ((r.left + r.width / 2) - (c.left + c.width / 2)) / (innerWidth / 2)));
      const y = Math.max(-1, Math.min(1, ((r.top + r.height / 2) - (c.top + c.height / 2)) / (innerHeight / 2)));
      rig?.setState({ x, y });
      clearTimeout(gazeTimer); gazeTimer = setTimeout(() => rig?.setState({ x: 0, y: 0 }), ms);
    },
  };
})();

function particleOrb() {
  // A fresh canvas: one that already handed out a WebGL context cannot give a 2D one.
  const used = $('orb'), canvas = used.cloneNode(); used.replaceWith(canvas);
  const ctx = canvas.getContext('2d');
  const N = 700, pts = Array.from({ length: N }, (_, i) => {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), phi = i * Math.PI * (3 - Math.sqrt(5));
    return { x: Math.cos(phi) * r, y, z: Math.sin(phi) * r };
  });
  let energy = 0.15, target = 0.15, t = 0;
  (function frame() {
    t += reduceMotion ? 0 : 0.006 + energy * 0.02;
    energy += (target - energy) * 0.05; target = Math.max(0.15, target * 0.985);
    const w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2, R = w * 0.3 * (1 + energy * 0.12);
    ctx.clearRect(0, 0, w, h);
    const ca = Math.cos(t), sa = Math.sin(t), cb = Math.cos(t * 0.6), sb = Math.sin(t * 0.6);
    for (const p of pts) {
      const x = p.x * ca - p.z * sa; let z = p.x * sa + p.z * ca; const y = p.y * cb - z * sb; z = p.y * sb + z * cb;
      const s = (z + 2) / 3;
      ctx.fillStyle = `rgba(${170 + 85 * energy | 0},220,255,${0.25 + s * 0.6})`;
      ctx.fillRect(cx + x * R, cy + y * R, 1.2 + s * 1.6, 1.2 + s * 1.6);
    }
    requestAnimationFrame(frame);
  })();
  return { pulse: (amount = 0.6) => { target = Math.min(1, target + amount); } };
}

// ---------- Holograms beside Aura ----------
const PANELS = {
  mission: { title: 'Strategy', rail: 'railLeft', board: true },
  browser: { title: 'Browser', rail: 'railRight', view: true },
  tools: { title: 'Tools', rail: 'railRight' },
};
const holos = new Map();
function holo(id) {
  if (holos.has(id)) return holos.get(id);
  const spec = PANELS[id];
  const el = document.createElement('section');
  el.className = 'holo' + (spec.board ? ' board' : '') + (spec.view ? ' browser' : ''); el.dataset.panel = id; el.tabIndex = 0;
  el.setAttribute('aria-label', spec.title);
  el.innerHTML = `<div class="holo-head"><span class="light"></span><span class="grow"></span>${spec.view ? '<button type="button" data-a="enlarge">Enlarge</button><button type="button" data-a="window">Open window</button>' : ''}</div>`
    + (spec.view ? '<div class="holo-view"><img alt="What Aura sees in her browser"><span class="cap">No frame yet</span></div>' : '')
    + `<div class="holo-body">${spec.board ? '<div class="board-host"></div>' : ''}<ol></ol><div class="none">Nothing yet</div></div>`;
  el.querySelector('.grow').textContent = spec.title;
  $(spec.rail).appendChild(el);
  const h = { id, el, list: el.querySelector('ol'), none: el.querySelector('.none'), liveTimer: 0 };
  el.addEventListener('click', e => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'enlarge') return openViewer();
    if (a === 'window') return openRealWindow();
    el.classList.contains('focus') ? unfocus(id) : focus([id], { by: 'operator' });
  });
  el.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); el.click(); } });
  holos.set(id, h);
  return h;
}
// A panel Aura uses lights up blue (the glow then fades out over a few seconds), she glances at it,
// and a beam shows the action.
function activate(id, { look = true } = {}) {
  const h = holo(id);
  h.el.classList.add('live'); clearTimeout(h.liveTimer); h.liveTimer = setTimeout(() => h.el.classList.remove('live'), 2200);
  if (look) aura.lookAt(h.el);
}
function addLine(id, text, tone = '', { max = 9, quiet = false } = {}) {
  const h = holo(id);
  const li = document.createElement('li'); li.textContent = text; li.title = text;
  li.className = [tone, quiet ? '' : 'new'].filter(Boolean).join(' ');
  h.list.appendChild(li); while (h.list.children.length > max) h.list.firstElementChild.remove();
  h.none.hidden = true;
  if (!quiet) activate(id);
}
// What Aura is talking about: enlarged with a glow, turned toward her, until the conversation moves on.
let focusTimer = 0;
function focus(ids, { by = 'aura' } = {}) {
  const wanted = new Set(ids.filter(id => PANELS[id]).slice(0, 2));
  if (!wanted.size) return;
  for (const h of holos.values()) h.el.classList.toggle('focus', wanted.has(h.id));
  for (const id of wanted) holo(id).el.classList.add('focus');
  aura.lookAt(holo([...wanted][0]).el, 3000);
  if (wanted.has('browser')) refreshBrowserView();
  if (wanted.has('mission')) { boardKey = ''; refreshBoard(); } // replay the strategy line when it is shown
  clearTimeout(focusTimer);
  if (by === 'aura') focusTimer = setTimeout(() => unfocus(), 45000);
}
function unfocus(id) { for (const h of holos.values()) if (!id || h.id === id) h.el.classList.remove('focus'); }
const MENTIONS = {
  mission: /(pågår|pågående|uppdrag|mission|planen|strategi|nästa steg|arbetar med|jobbar med|current work|in progress)/i,
  browser: /(webbläsar|browser|wikipedia|google|webbsida|webbplats|fliken|the page)/i,
  tools: /(verktyg|terminal|kommando|tool call|verktygsanrop)/i,
};
function mentioned(text) { return Object.entries(MENTIONS).filter(([, re]) => re.test(text)).map(([id]) => id); }

// ---------- Strategy board: only the steps, and a blue line into the step being worked on ----------
let boardKey = '', lastPlan = null, missionActions = [];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function renderBoard(plan, subs) {
  const h = holo('mission'), host = h.el.querySelector('.board-host');
  if (!plan?.nodes?.length) { host.innerHTML = ''; return; }
  const key = JSON.stringify([plan.identity, plan.nodes.map(n => n.status), subs]);
  if (key === boardKey) return; boardKey = key;
  const nodes = plan.nodes.slice(0, 8), rowH = 34, top = 34;
  const running = nodes.findIndex(n => n.status === 'RUNNING');
  const subH = running >= 0 ? subs.length * 20 + 8 : 0;
  const y = i => top + i * rowH + (running >= 0 && i > running ? subH : 0);
  let svg = `<text class="goal" x="0" y="14">${esc(String(plan.objective || '').slice(0, 52))}</text>`;
  // The strategy as a line: a glowing point leads it from the first step to where Aura is now, each step lights up
  // as the line reaches it, and at the step being worked on the line opens into its sub-steps.
  const done = n => ['VERIFIED', 'DONE'].includes(n.status);
  const reach = running >= 0 ? running : Math.max(0, nodes.map(done).lastIndexOf(true));
  const STEP = 0.4, traceDur = Math.max(0.4, reach * STEP);
  svg += `<line class="spine" x1="10" y1="${y(0)}" x2="10" y2="${y(nodes.length - 1)}"/>`;
  if (reach > 0) {
    const trace = `M10,${y(0)}` + nodes.slice(1, reach + 1).map((_, k) => ` L10,${y(k + 1)}`).join('');
    svg += `<path class="trace" d="${trace}" pathLength="1" style="animation-duration:${traceDur}s"/>`
      + `<circle class="lead" r="3.6" style="animation-delay:${traceDur}s"><animateMotion dur="${traceDur}s" fill="freeze" path="${trace}"/></circle>`;
  }
  nodes.forEach((n, i) => {
    svg += `<g class="step ${esc(n.status)}" style="animation-delay:${Math.min(i, reach) * STEP}s"><circle class="node" cx="10" cy="${y(i)}" r="6"/><text x="26" y="${y(i) + 4}">${esc(String(n.title || n.identity).slice(0, 38))}</text></g>`;
  });
  if (running >= 0 && subs.length) {
    const y0 = y(running), lastY = y0 + 8 + subs.length * 20;
    const branch = `M10,${y0} C30,${y0} 34,${y0 + 10} 34,${y0 + 18} L34,${lastY - 10}`;
    svg += `<path class="branch" d="${branch}" style="animation-delay:${traceDur}s"/>`
      + `<circle class="lead" r="3.2" visibility="hidden" style="animation-delay:${traceDur + 1.1}s"><set attributeName="visibility" to="visible" begin="${traceDur}s"/><animateMotion begin="${traceDur}s" dur="1.1s" fill="freeze" path="${branch}"/></circle>`;
    subs.forEach((s, j) => {
      const sy = y0 + 18 + j * 20;
      svg += `<g class="sub"><circle cx="34" cy="${sy}" r="2.6"/><text x="44" y="${sy + 4}" style="animation-delay:${traceDur + 0.5 + j * 0.15}s">${esc(s)}</text></g>`;
    });
  }
  const height = y(nodes.length - 1) + 16;
  host.innerHTML = `<svg viewBox="0 0 340 ${height}" height="${height}" role="img" aria-label="Strategy steps">${svg}</svg>`;
  h.none.hidden = true;
}
async function refreshBoard() {
  try {
    const g = await (await fetch('/api/aura/workbench/gameboard', { cache: 'no-store' })).json();
    const plan = (g.plans || []).find(p => p.status === 'ACTIVE') || (g.plans || [])[0];
    // Sub-steps: the actions Nova actually ran for the current mission of this plan (observed, newest last).
    const mission = (g.missions || []).find(m => m.graphId === plan?.identity && /RUNNING|ACTIVE|PLANNING/.test(m.status)) || (g.missions || []).find(m => m.graphId === plan?.identity);
    const subs = (g.activity || []).filter(a => a.missionId === mission?.identity && a.taskType).slice(0, 5).reverse().map(a => `${a.taskType} ${a.outcome === 'VERIFIED' ? 'verified' : String(a.outcome || '').toLowerCase()}`);
    const changed = lastPlan && JSON.stringify(lastPlan.nodes?.map(n => n.status)) !== JSON.stringify(plan?.nodes?.map(n => n.status));
    lastPlan = plan; missionActions = subs;
    renderBoard(plan, subs);
    if (changed) activate('mission');
  } catch { /* runtime restarting */ }
}
setInterval(refreshBoard, 4000);

// ---------- Conversation: the same encrypted chat session the IDE uses ----------
const log = $('log');
const history = [];
function atBottom() { return log.scrollHeight - log.scrollTop - log.clientHeight < 80; }
function message(role, content, meta = '') {
  const stick = atBottom();
  const el = document.createElement('div'); el.className = 'msg ' + role; el.textContent = content;
  if (meta) { const m = document.createElement('span'); m.className = 'meta'; m.textContent = meta; el.appendChild(m); }
  log.appendChild(el); while (log.children.length > 40) log.firstElementChild.remove();
  if (stick || role === 'user') log.scrollTop = log.scrollHeight;
  return el;
}
async function api(path, body, ms = 15000) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.hint?.message || data.error || `HTTP ${res.status}`);
  return data;
}
async function loadHistory() {
  try {
    const data = await (await fetch('/api/aura/chat/session', { cache: 'no-store' })).json();
    for (const m of (data.messages || []).filter(m => m.role !== 'system').slice(-8)) {
      history.push({ role: m.role, content: m.content });
      message(m.role, m.role === 'assistant' ? workspaceReplyText(m.content) : m.content);
    }
    log.scrollTop = log.scrollHeight;
  } catch { message('system', 'Chat history could not be read. You can still talk to Aura.'); }
}

// ---------- Voice: Aura answers aloud in her voice; the operator can talk to her ----------
function note(text) { const n = $('voiceNote'); n.textContent = text; n.hidden = !text; }
const stored = key => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const store = (key, on) => { try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* storage unavailable */ } };
const voice = (() => {
  let readAloud = stored('jaco.stage.voice'), current = null;
  const show = () => $('voice').setAttribute('aria-pressed', String(readAloud));
  show();
  function stop() { const c = current; current = null; try { c?.cancel(); } catch { /* already stopped */ } aura.voice(null); }
  // Sentence by sentence: the next one is synthesized while the current one plays, so she starts quickly.
  async function speak(text) {
    stop();
    const parts = speechParts(text); if (!parts.length) return;
    const lang = /[åäö]|\b(och|jag|det|är|inte|du|har)\b/i.test(text) ? 'sv-SE' : 'en-US';
    const controller = new AbortController(), audio = new Audio(), urls = [];
    const handle = { cancel() { controller.abort(); audio.pause(); urls.forEach(u => URL.revokeObjectURL(u)); } };
    current = handle;
    const synth = part => fetch('/api/aura/voice/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ text: part, lang }) })
      .then(async r => { if (!r.ok) throw new Error('VOICE_UNAVAILABLE'); const u = URL.createObjectURL(await r.blob()); urls.push(u); return u; });
    audio.onplay = () => { if (current === handle) aura.voice(audio.captureStream?.() ?? null); };
    const play = url => new Promise((resolve, reject) => { audio.onended = resolve; audio.onerror = () => reject(new Error('VOICE_PLAYBACK_FAILED')); audio.src = url; audio.play().catch(reject); });
    try {
      let next = synth(parts[0]);
      for (let i = 0; i < parts.length; i++) {
        const url = await next; if (current !== handle) return;
        if (i + 1 < parts.length) { next = synth(parts[i + 1]); next.catch(() => {}); }
        await play(url); if (current !== handle) return;
      }
    } catch (error) { if (!controller.signal.aborted) note(`Aura's voice was unavailable (${error?.message || error}).`); }
    finally { if (current === handle) { current = null; aura.voice(null); urls.forEach(u => URL.revokeObjectURL(u)); } }
  }
  $('voice').addEventListener('click', () => { readAloud = !readAloud; store('jaco.stage.voice', readAloud); show(); if (!readAloud) stop(); });
  return { speak, stop, get on() { return readAloud; }, set on(v) { readAloud = v; store('jaco.stage.voice', v); show(); }, get speaking() { return Boolean(current); } };
})();

// Conversation: listen, send after a short pause, hear her answer, listen again. Browser speech recognition;
// in Chrome it is Google's service, so the words leave this computer (the same note the IDE portrait gives).
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let talking = false, recognition = null, quickEnds = 0, busy = false;
if (!Recognition) { $('talk').disabled = true; $('talk').title = 'This browser has no speech recognition'; }
function stopListening() {
  const r = recognition; recognition = null;
  try { r?.abort(); } catch { /* already stopped */ }
  $('talk').classList.remove('listening'); aura.listening(false);
}
function listen() {
  if (!talking || !Recognition || recognition || busy || voice.speaking || document.hidden) return;
  const r = new Recognition(); recognition = r;
  r.lang = 'sv-SE'; r.continuous = true; r.interimResults = true;
  let silence = 0; const startedAt = Date.now();
  r.onresult = e => {
    if (recognition !== r) return;
    voice.stop(); // talking over her interrupts her, like in a real conversation
    let finals = '', interim = '';
    for (const result of e.results) (result.isFinal ? (finals += result[0].transcript) : (interim += result[0].transcript));
    const spoken = [finals.trim(), interim.trim()].filter(Boolean).join(' ');
    $('input').value = spoken;
    clearTimeout(silence);
    if (spoken) silence = setTimeout(() => {
      if (recognition !== r) return;
      const text = $('input').value.trim(); stopListening();
      if (text) { $('input').value = ''; send(text); }
    }, 1300);
  };
  r.onerror = e => {
    if (recognition !== r || e.error === 'no-speech' || e.error === 'aborted') return;
    note(e.error === 'not-allowed' ? 'The microphone is blocked for this page. Allow it in the address bar and press Talk again.' : `Listening failed (${e.error}).`);
    setTalking(false);
  };
  r.onend = () => {
    if (recognition !== r) return;
    recognition = null; $('talk').classList.remove('listening'); aura.listening(false);
    quickEnds = Date.now() - startedAt < 800 ? quickEnds + 1 : 0;
    if (quickEnds >= 3) { note('Listening stopped: the microphone did not stay open.'); setTalking(false); return; }
    setTimeout(listen, 300);
  };
  try { r.start(); $('talk').classList.add('listening'); aura.listening(true); }
  catch { recognition = null; }
}
// The browser's own microphone question, raised as soon as the page opens, so talking works on the first press.
async function askMicrophone() {
  if (!Recognition || !navigator.mediaDevices?.getUserMedia) return false;
  try { if ((await navigator.permissions?.query({ name: 'microphone' }))?.state === 'granted') return true; } catch { /* no permissions API */ }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    note('Microphone allowed. Press Talk to speak with Aura.');
    return true;
  } catch (error) {
    note(error?.name === 'NotAllowedError'
      ? 'The microphone is blocked for this page. Click the lock in the address bar, allow the microphone, and press Talk.'
      : `The microphone could not be opened (${error?.name || error}).`);
    return false;
  }
}
setTimeout(askMicrophone, 1200);
async function setTalking(on) {
  talking = on; $('talk').setAttribute('aria-pressed', String(on));
  if (!on) { stopListening(); return; }
  if (!await askMicrophone()) { talking = false; $('talk').setAttribute('aria-pressed', 'false'); return; }
  note('Listening. Speech recognition in Chrome uses Google\'s service.'); voice.on = true; quickEnds = 0; listen();
}
$('talk').addEventListener('click', () => setTalking(!talking));
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopListening(); voice.stop(); } else listen(); });

async function send(text) {
  busy = true; $('send').disabled = true; aura.hold(true); unfocus(); stopListening(); voice.stop();
  const id = crypto.randomUUID(), started = performance.now();
  message('user', text);
  // Asking what is going on brings the strategy forward while Aura answers.
  if (MENTIONS.mission.test(text) || /vad (händer|gör du)|what are you doing|what's happening/i.test(text)) focus(['mission']);
  const thinking = message('assistant', 'Aura is thinking…'); thinking.classList.add('thinking');
  $('auraLine').textContent = 'Thinking…';
  let answer = '';
  try {
    await api('/api/aura/chat/session/messages', { id, role: 'user', content: text });
    const data = await api('/api/aura/chat', {
      message: text, interactionMode: 'action', connectedSession: { id, source: 'Aura Operator Stage' },
      messagesHistory: [...history.slice(-12), { role: 'user', content: text }], ragContext: [],
    }, 370000);
    history.push({ role: 'user', content: text });
    const raw = String(data.reply || data.text || '').trim();
    if (!raw) throw new Error('The model returned an empty response.');
    const { actions } = extractWorkspaceActions(raw);
    answer = workspaceReplyText(raw);
    const meta = [data.degraded ? 'status reply, no model answered' : null, data.modelUsed || [data.provider, data.model].filter(Boolean).join('/'), `${((performance.now() - started) / 1000).toFixed(1)} s`].filter(Boolean).join(' · ');
    thinking.remove(); message('assistant', answer, meta);
    const asked = actions.filter(a => a.type === 'focus').map(a => a.panel);
    focus(asked.length ? asked : mentioned(answer));
    history.push({ role: 'assistant', content: answer });
    api('/api/aura/chat/session/messages', { id: `${id}:reply`, role: 'assistant', content: answer, meta }).catch(() => message('system', 'The reply is shown but could not be saved.'));
  } catch (error) {
    thinking.remove();
    message('system', error?.name === 'TimeoutError' ? 'No answer from the runtime in six minutes.' : `Aura could not answer: ${error?.message || error}`);
    if (!$('input').value) $('input').value = text;
  } finally { busy = false; $('send').disabled = false; aura.hold(false); $('auraLine').textContent = 'Here with you'; }
  // She answers aloud, then listens again when the operator is talking with her.
  if (answer && voice.on) await voice.speak(answer);
  listen();
}
$('composer').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('input').value.trim(); if (!text || busy) return;
  $('input').value = ''; $('input').style.height = ''; send(text);
});
$('input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); } });
$('input').addEventListener('input', e => { e.target.style.height = ''; e.target.style.height = Math.min(140, e.target.scrollHeight) + 'px'; });

// ---------- Source 1: MCP tool calls (what Aura actually ran) ----------
const seenCalls = new Set();
let firstPoll = true;
async function pollCalls() {
  try {
    const data = await (await fetch('/api/aura/workbench/mcp/calls')).json();
    for (const c of (data.calls || []).slice(-40)) {
      const id = `${c.at}|${c.server || c.id}|${c.tool}`; if (seenCalls.has(id)) continue; seenCalls.add(id);
      if (firstPoll) continue; // calls from before the stage opened stay out
      const server = String(c.server || c.id || 'mcp');
      const ok = c.outcome === 'ok', outcome = ok ? 'done' : c.outcome || 'failed';
      addLine('tools', `> ${server}.${c.tool}  ${outcome}${c.ms != null ? '  ' + (c.ms / 1000).toFixed(1) + 's' : ''}`, ok ? 'ok' : c.outcome === 'refused' ? '' : 'fail');
      if (server === 'browser') { activate('browser', { look: false }); refreshBrowserView(); }
      $('auraLine').textContent = `${ok ? 'Using' : 'Tried'} ${c.tool}`;
      aura.pulse(0.3);
    }
    firstPoll = false;
  } catch { /* the runtime may be restarting; keep polling */ }
  setTimeout(pollCalls, 1000);
}

// ---------- Source 2: what Aura's browser shows (a read of her pinned page) ----------
let viewBusy = false, lastFrameUrl = null, lastFrameAt = 0;
async function refreshBrowserView() {
  const h = holos.get('browser');
  if (!h || viewBusy || document.hidden) return;
  viewBusy = true; lastFrameAt = Date.now();
  try {
    const res = await fetch('/api/aura/browser/live-frame', { cache: 'no-store' });
    const img = h.el.querySelector('.holo-view img'), cap = h.el.querySelector('.holo-view .cap');
    if (res.ok && res.headers.get('content-type')?.includes('image/png')) {
      const url = URL.createObjectURL(await res.blob());
      img.onload = () => { if (lastFrameUrl && lastFrameUrl !== $('viewerImg').src) URL.revokeObjectURL(lastFrameUrl); lastFrameUrl = url; };
      img.src = url;
      if (!$('viewer').hidden) $('viewerImg').src = url;
    } else {
      const body = await res.json().catch(() => ({}));
      cap.textContent = 'No frame: ' + (body.error || res.status);
    }
  } catch { /* runtime restarting */ } finally { viewBusy = false; }
}
// Live while it is shown large or in focus, slow otherwise.
setInterval(() => {
  const h = holos.get('browser'); if (!h) return;
  if (!$('viewer').hidden || h.el.classList.contains('focus') || Date.now() - lastFrameAt > 6000) refreshBrowserView();
}, 1500);
function openViewer() { $('viewer').hidden = false; refreshBrowserView(); }
$('viewerClose').addEventListener('click', () => { $('viewer').hidden = true; });
$('viewer').addEventListener('click', e => { if (e.target === $('viewer')) $('viewer').hidden = true; });
addEventListener('keydown', e => { if (e.key === 'Escape') $('viewer').hidden = true; });
// A real window: the page Aura is on, opened in the operator's own browser (her session stays hers).
async function openRealWindow() {
  try {
    const page = await (await fetch('/api/aura/browser/page', { cache: 'no-store' })).json();
    if (page?.url && /^https?:\/\//.test(page.url)) window.open(page.url, '_blank', 'noopener');
    else note('The page Aura is on could not be read.');
  } catch { note('The page Aura is on could not be read.'); }
}
$('viewerOpen').addEventListener('click', openRealWindow);

// ---------- Source 3: the live mission stream (Aura's plan and steps) ----------
function connectLive() {
  const es = new EventSource('/api/aura/workbench/live');
  let warm = false;
  es.addEventListener('observation', e => {
    $('liveDot').classList.add('live');
    let data; try { data = JSON.parse(e.data); } catch { return; }
    const events = data.events || [];
    const replay = !warm; warm = true; // the first frame replays recent history: it fills the panel quietly
    for (const ev of replay ? events.slice(-5) : events) {
      const text = String(ev.text || ev.title || ev.type || '').slice(0, 200);
      if (!text) continue;
      addLine('mission', text, /FAIL|BLOCK/.test(ev.type) ? 'fail' : /RESULT|DONE|VERIFIED/.test(ev.type) ? 'ok' : '', { max: 4, quiet: replay });
      if (!replay) { $('auraLine').textContent = text.slice(0, 120); aura.pulse(0.2); refreshBoard(); }
    }
  });
  es.onerror = () => { $('liveDot').classList.remove('live'); };
}

// ---------- The model Aura thinks with: the same shared choice the IDE sets (POST /api/aura/model) ----------
const modelLabel = c => c ? `${c.provider} / ${String(c.model || '').replace(/^models\//, '')}` : 'no model chosen';
let modelChoices = [], currentModel = null;
async function header() {
  try {
    const p = await (await fetch('/api/aura/model', { cache: 'no-store' })).json();
    currentModel = p?.choice || null;
    modelChoices = (p?.choices || []).filter(c => c.usable && Array.isArray(c.models) && c.models.length);
    $('auraModel').textContent = modelLabel(currentModel);
    $('modelBtn').textContent = 'Model: ' + (currentModel ? String(currentModel.model).replace(/^models\//, '').slice(0, 28) : 'none');
    $('status').textContent = 'Connected';
  } catch { $('status').textContent = 'Runtime not reachable'; }
}
function fillModels(provider, model) {
  const sel = $('modelProvider'), names = $('modelName');
  sel.replaceChildren(...modelChoices.map(c => new Option(c.label || c.provider, c.provider, false, c.provider === provider)));
  const chosen = modelChoices.find(c => c.provider === sel.value) || modelChoices[0];
  names.replaceChildren(...(chosen?.models || []).map(m => new Option(String(m).replace(/^models\//, ''), m, false, m === model)));
}
$('modelBtn').addEventListener('click', async () => {
  const pop = $('modelPop'), open = pop.hidden;
  pop.hidden = !open; $('modelBtn').setAttribute('aria-expanded', String(open));
  if (open) { await header(); fillModels(currentModel?.provider, currentModel?.model); $('modelState').textContent = modelLabel(currentModel); }
});
$('modelProvider').addEventListener('change', () => fillModels($('modelProvider').value, null));
$('modelUse').addEventListener('click', async () => {
  const provider = $('modelProvider').value, model = $('modelName').value;
  if (!provider || !model) return;
  $('modelUse').disabled = true; $('modelState').textContent = 'Checking that it answers…';
  try {
    const res = await fetch('/api/aura/model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, model }), signal: AbortSignal.timeout(40000) });
    const r = await res.json().catch(() => ({}));
    if (!res.ok || r.success === false || r.choice?.model !== model) throw new Error(String(r?.probe?.error || r?.error || 'not confirmed').slice(0, 120));
    $('modelState').textContent = 'Active: ' + modelLabel(r.choice);
    await header();
    message('system', `Aura now thinks with ${modelLabel(r.choice)}.`);
  } catch (error) { $('modelState').textContent = 'Not switched: ' + (error?.message || error); }
  finally { $('modelUse').disabled = false; }
});
addEventListener('click', e => { if (!$('modelPop').hidden && !e.target.closest('.model-box')) { $('modelPop').hidden = true; $('modelBtn').setAttribute('aria-expanded', 'false'); } });

// ---------- The IDE beside Aura (same origin, local only) ----------
const savedSplit = (() => { try { return Number(localStorage.getItem('jaco.stage.split')) || 0; } catch { return 0; } })();
if (savedSplit >= 320) document.documentElement.style.setProperty('--split', savedSplit + 'px');
function setIde(open) {
  $('idePane').hidden = !open; document.body.classList.toggle('split', open);
  $('ideToggle').setAttribute('aria-pressed', String(open));
  if (open && !$('ideFrame').src) $('ideFrame').src = '/ide';
}
$('ideToggle').addEventListener('click', () => setIde($('idePane').hidden));
$('ideClose').addEventListener('click', () => setIde(false));
$('ideResize').addEventListener('pointerdown', e => {
  e.preventDefault(); document.body.classList.add('resizing'); $('ideResize').setPointerCapture(e.pointerId);
  const move = ev => {
    const width = Math.max(320, Math.min(innerWidth - 420, innerWidth - ev.clientX));
    document.documentElement.style.setProperty('--split', width + 'px');
  };
  const up = () => {
    document.body.classList.remove('resizing');
    $('ideResize').removeEventListener('pointermove', move); $('ideResize').removeEventListener('pointerup', up);
    try { localStorage.setItem('jaco.stage.split', String(parseInt(getComputedStyle(document.documentElement).getPropertyValue('--split')) || 0)); } catch { /* storage unavailable */ }
  };
  $('ideResize').addEventListener('pointermove', move); $('ideResize').addEventListener('pointerup', up);
});

holo('mission'); holo('tools');
header(); loadHistory(); pollCalls(); connectLive(); refreshBoard();
$('input').focus();
