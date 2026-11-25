// Aura Operator Stage: tool windows open when Aura uses a tool, driven only by real runtime receipts.
// Sources (read-only, proxied by server.mjs): the live mission stream and the MCP call log.
import { Terminal } from '/vendor/xterm.mjs';

const $ = id => document.getElementById(id);
const C = { reset: '\x1b[0m', dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', bold: '\x1b[1m', gray: '\x1b[90m' };
const TITLES = { browser: 'BROWSER · CDP', shell: 'SHELL', filesystem: 'FILES', git: 'GIT', repo: 'REPOSITORY', editor: 'EDITOR', fetch: 'WEB FETCH', jaco: 'JACO' };

// ---------- Aura orb: a particle sphere whose energy follows real activity ----------
const orb = (() => {
  const canvas = $('orb'), ctx = canvas.getContext('2d');
  const N = 900, pts = Array.from({ length: N }, (_, i) => {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), phi = i * Math.PI * (3 - Math.sqrt(5));
    return { x: Math.cos(phi) * r, y, z: Math.sin(phi) * r };
  });
  let energy = 0.15, target = 0.15, t = 0;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function frame() {
    t += reduce ? 0 : 0.006 + energy * 0.02;
    energy += (target - energy) * 0.05;
    target = Math.max(0.15, target * 0.985);
    const w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2, R = w * 0.3 * (1 + energy * 0.12);
    ctx.clearRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.6);
    glow.addColorStop(0, `rgba(120,200,255,${0.10 + energy * 0.25})`); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    const ca = Math.cos(t), sa = Math.sin(t), cb = Math.cos(t * 0.6), sb = Math.sin(t * 0.6);
    for (const p of pts) {
      const wob = 1 + Math.sin(p.y * 6 + t * 4) * 0.04 * energy;
      let x = p.x * ca - p.z * sa, z = p.x * sa + p.z * ca, y = p.y * cb - z * sb; z = p.y * sb + z * cb;
      const s = (z + 2) / 3, px = cx + x * R * wob, py = cy + y * R * wob;
      ctx.fillStyle = `rgba(${170 + 85 * energy | 0},${220},${255},${0.25 + s * 0.6})`;
      ctx.fillRect(px, py, 1.2 + s * 1.6, 1.2 + s * 1.6);
    }
    requestAnimationFrame(frame);
  }
  frame();
  return { pulse: (amount = 0.6) => { target = Math.min(1, target + amount); } };
})();

// ---------- Window manager ----------
const windows = new Map(); let zTop = 10, cascade = 0;
function charGrid(el) { const r = el.getBoundingClientRect(); return { cols: Math.max(30, Math.floor((r.width - 16) / 7.8)), rows: Math.max(6, Math.floor((r.height - 8) / 17)) }; }
function focus(win) { win.el.style.zIndex = ++zTop; for (const w of windows.values()) w.chip.classList.toggle('active', w === win); }
function fit(win) { requestAnimationFrame(() => { const { cols, rows } = charGrid(win.body); win.term.resize(cols, rows); }); }
function openWindow(key, title) {
  if (windows.has(key)) return windows.get(key);
  const el = document.createElement('section'); el.className = 'win';
  const stage = $('windows').getBoundingClientRect();
  const w = Math.min(620, stage.width - 40), h = Math.min(330, stage.height - 40);
  const left = Math.min(stage.width - w - 20, 260 + (cascade % 4) * 46), top = Math.min(stage.height - h - 20, 20 + (cascade % 4) * 40); cascade++;
  Object.assign(el.style, { left: left + 'px', top: top + 'px', width: w + 'px', height: h + 'px' });
  el.innerHTML = `<div class="win-head"><span class="light"></span><span class="win-title"></span><button title="Maximize" data-a="max">⤢</button><button title="Close" data-a="close">✕</button></div><div class="win-body"></div>`;
  el.querySelector('.win-title').textContent = title;
  $('windows').appendChild(el);
  const body = el.querySelector('.win-body');
  const term = new Terminal({ fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono'), fontSize: 13, convertEol: true, disableStdin: true, cursorBlink: false,
    theme: { background: '#0c121c', foreground: '#dbe8f5', cursor: '#7cc7ff' }, scrollback: 2000 });
  term.open(body);
  const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = title; const n = document.createElement('span'); n.className = 'n'; chip.appendChild(n);
  $('dock').appendChild(chip);
  const win = { key, el, body, term, chip, n, count: 0, queue: [], typing: false, hotTimer: 0 };
  windows.set(key, win); document.body.classList.add('working'); tile();
  el.addEventListener('pointerdown', () => focus(win));
  chip.addEventListener('click', () => { el.hidden = false; focus(win); });
  el.querySelector('[data-a=max]').onclick = () => { el.classList.toggle('max'); fit(win); };
  el.querySelector('[data-a=close]').onclick = () => { el.hidden = true; if ([...windows.values()].every(x => x.el.hidden)) document.body.classList.remove('working'); tile(); };
  drag(el, el.querySelector('.win-head'), () => { win.moved = true; fit(win); });
  fit(win); focus(win);
  return win;
}
// Lay the visible windows out side by side in the space right of Aura (a window the operator has
// moved or maximized keeps its place).
function tile() {
  const area = $('windows').getBoundingClientRect();
  const open = [...windows.values()].filter(w => !w.el.hidden && !w.moved && !w.el.classList.contains('max'));
  if (!open.length) return;
  const left = area.width > 900 ? 240 : 12, gap = 14, W = area.width - left - 16, H = area.height - 16;
  const cols = open.length <= 1 ? 1 : open.length <= 4 ? 2 : 3, rows = Math.ceil(open.length / cols);
  const cw = (W - gap * (cols - 1)) / cols, ch = (H - gap * (rows - 1)) / rows;
  open.forEach((w, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    Object.assign(w.el.style, { left: left + c * (cw + gap) + 'px', top: 8 + r * (ch + gap) + 'px', width: cw + 'px', height: ch + 'px' });
    fit(w);
  });
}
function drag(el, handle, done) {
  handle.addEventListener('pointerdown', e => {
    if (e.target.closest('button') || el.classList.contains('max')) return;
    const sx = e.clientX - el.offsetLeft, sy = e.clientY - el.offsetTop; handle.setPointerCapture(e.pointerId);
    const move = ev => { el.style.left = ev.clientX - sx + 'px'; el.style.top = ev.clientY - sy + 'px'; };
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); done?.(); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
  });
}
// Write like a terminal being typed into: readable on a phone screen recording.
function write(win, text) {
  win.queue.push(text); win.count++; win.n.textContent = String(win.count);
  win.el.hidden = false; win.el.classList.add('hot'); clearTimeout(win.hotTimer); win.hotTimer = setTimeout(() => win.el.classList.remove('hot'), 2500);
  orb.pulse(0.35);
  if (win.typing) return; win.typing = true;
  (function next() {
    const line = win.queue.shift(); if (line === undefined) { win.typing = false; return; }
    let i = 0; const step = Math.max(1, Math.ceil(line.length / 60));
    (function chunk() { win.term.write(line.slice(i, i + step)); i += step; if (i < line.length) setTimeout(chunk, 12); else { win.term.write('\r\n'); setTimeout(next, 60); } })();
  })();
}

// ---------- Source 1: MCP tool calls (what Aura actually ran) ----------
const seenCalls = new Set();
let firstPoll = true;
async function pollCalls() {
  try {
    const res = await fetch('/api/aura/workbench/mcp/calls'); const data = await res.json();
    const calls = (data.calls || []).slice(-40);
    for (const c of calls) {
      const id = `${c.at}|${c.server || c.id}|${c.tool}`; if (seenCalls.has(id)) continue; seenCalls.add(id);
      if (firstPoll) continue; // history before the stage opened stays out of the show
      const server = String(c.server || c.id || 'mcp');
      const win = openWindow('mcp:' + server, TITLES[server] || server.toUpperCase());
      const ok = c.outcome === 'ok', refused = c.outcome === 'refused';
      write(win, `${C.cyan}●${C.reset} ${C.bold}${c.tool}${C.reset} ${C.gray}${new Date(c.at).toLocaleTimeString()}${C.reset}`);
      write(win, `  ${C.gray}⎿${C.reset} ${ok ? C.green + 'done' : refused ? C.yellow + 'refused' : C.red + (c.outcome || 'failed')}${C.reset}${c.ms != null ? C.gray + ' · ' + (c.ms / 1000).toFixed(1) + ' s' + C.reset : ''}${c.error && !ok ? ' ' + C.dim + String(c.error).slice(0, 160) + C.reset : ''}`);
      $('auraLine').textContent = `${ok ? 'Used' : 'Tried'} ${c.tool} on ${server}`;
    }
    firstPoll = false;
  } catch { /* the runtime may be restarting; keep polling */ }
  setTimeout(pollCalls, 1000);
}

// ---------- Source 2: the live mission stream (Aura's plan and steps) ----------
function connectLive() {
  const es = new EventSource('/api/aura/workbench/live');
  let warm = false;
  es.addEventListener('observation', e => {
    $('liveDot').classList.add('live');
    let data; try { data = JSON.parse(e.data); } catch { return; }
    const events = data.events || [];
    if (!warm) { warm = true; return; } // the first frame replays history
    for (const ev of events) {
      const mission = ev.missionId || 'live';
      const win = openWindow('mission:' + mission, ev.missionId ? 'MISSION · ' + String(ev.missionGoal || mission).slice(0, 48) : 'AURA · LIVE');
      const tone = /FAIL|BLOCK/.test(ev.type) ? C.red : /RESULT|DONE|VERIFIED/.test(ev.type) ? C.green : C.cyan;
      write(win, `${tone}▸${C.reset} ${ev.title || ev.type}${ev.text ? C.gray + ' — ' + C.reset + String(ev.text).slice(0, 220) : ''}`);
      $('auraLine').textContent = String(ev.text || ev.title || '').slice(0, 140);
    }
  });
  es.onerror = () => { $('liveDot').classList.remove('live'); };
}

async function header() {
  try {
    const p = await (await fetch('/api/nova/planner')).json();
    if (p?.choice) $('auraModel').textContent = `${p.choice.provider} / ${String(p.choice.model).replace(/^models\//, '')}`;
    $('status').textContent = 'Connected. Tool windows open when Aura uses a tool.';
  } catch { $('status').textContent = 'Runtime not reachable on :3000'; }
}

header(); pollCalls(); connectLive();
addEventListener('resize', () => { for (const w of windows.values()) fit(w); });
