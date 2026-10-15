/**
 * JACO Agent UI — floating sidebar with live log + chat
 * Run: node agents/agent-ui.mjs
 * Open: http://localhost:4242
 *
 * Agent reads chat messages from .agent-state/chat-inbox.json
 * Agent writes thinking to .agent-state/activity.jsonl (already does this)
 */

import { createServer } from "http";
import { existsSync, readFileSync, writeFileSync, appendFileSync, createReadStream, statSync, openSync, readSync, closeSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(__dirname, ".agent-state");
const LOG_FILE = join(STATE_DIR, "activity.jsonl");
const STATE_FILE = join(STATE_DIR, "state.json");
const CHAT_INBOX = join(STATE_DIR, "chat-inbox.json");
const CHAT_LOG = join(STATE_DIR, "chat-log.json");
const PORT = 4242;

// Init files
if (!existsSync(CHAT_INBOX)) writeFileSync(CHAT_INBOX, "[]");
if (!existsSync(CHAT_LOG)) writeFileSync(CHAT_LOG, "[]");

const HTML = `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>JACO Agent</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0d1117;--surface:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8b949e;--accent:#58a6ff;--green:#3fb950;--yellow:#d29922;--red:#f85149;--purple:#bc8cff}
body{background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;height:100vh;display:flex;flex-direction:column;font-size:13px}

/* Header */
.header{background:var(--surface);border-bottom:1px solid var(--border);padding:10px 14px;display:flex;align-items:center;gap:10px;flex-shrink:0}
.pulse{width:8px;height:8px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.header h1{font-size:14px;font-weight:600;color:var(--accent)}
.header .status{font-size:11px;color:var(--muted);margin-left:auto}

/* Tabs */
.tabs{display:flex;background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0}
.tab{padding:8px 16px;cursor:pointer;font-size:12px;color:var(--muted);border-bottom:2px solid transparent;transition:all .15s}
.tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.tab:hover:not(.active){color:var(--text)}

/* Log panel */
#log-panel{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:2px}
.log-entry{display:flex;gap:8px;padding:4px 6px;border-radius:4px;line-height:1.4;font-family:'Cascadia Code','Consolas',monospace;font-size:11.5px}
.log-entry:hover{background:rgba(255,255,255,.03)}
.log-ts{color:var(--muted);flex-shrink:0;font-size:10px;padding-top:1px}
.log-icon{flex-shrink:0}
.log-body{flex:1;word-break:break-word}
.log-comp{color:var(--purple);font-weight:500}
.log-msg{color:var(--text)}
.level-ok .log-icon::before{content:"✔";color:var(--green)}
.level-info .log-icon::before{content:"ℹ";color:var(--accent)}
.level-warn .log-icon::before{content:"⚠";color:var(--yellow)}
.level-error .log-icon::before{content:"✖";color:var(--red)}
.level-revenue .log-icon::before{content:"$";color:var(--green)}
.level-route .log-icon::before{content:"~";color:var(--accent)}

/* State panel */
#state-panel{flex:1;overflow-y:auto;padding:10px;display:none}
.state-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.state-card{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:10px}
.state-card h3{font-size:11px;color:var(--muted);text-transform:uppercase;margin-bottom:8px;letter-spacing:.5px}
.state-val{font-size:20px;font-weight:700;color:var(--accent)}
.state-sub{font-size:11px;color:var(--muted);margin-top:2px}
.surface-row{display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px}
.dot{width:6px;height:6px;border-radius:50%}
.dot-on{background:var(--green)}
.dot-off{background:var(--border)}

/* Chat panel */
#chat-panel{flex:1;display:none;flex-direction:column}
#chat-messages{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:8px}
.msg{max-width:90%;padding:8px 12px;border-radius:10px;line-height:1.5;font-size:12.5px}
.msg-user{background:var(--accent);color:#000;align-self:flex-end;border-radius:10px 10px 2px 10px}
.msg-agent{background:var(--surface);border:1px solid var(--border);align-self:flex-start;border-radius:10px 10px 10px 2px}
.msg-agent .sender{font-size:10px;color:var(--purple);font-weight:600;margin-bottom:3px}
.msg-thinking{opacity:.6;font-style:italic;font-size:11px}
.chat-input-row{padding:10px;border-top:1px solid var(--border);display:flex;gap:8px;flex-shrink:0}
#chat-input{flex:1;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 10px;color:var(--text);font-size:13px;outline:none;resize:none;height:38px;font-family:inherit}
#chat-input:focus{border-color:var(--accent)}
#chat-send{background:var(--accent);color:#000;border:none;border-radius:6px;padding:0 14px;cursor:pointer;font-weight:600;font-size:13px}
#chat-send:hover{opacity:.85}
</style>
</head>
<body>
<div class="header">
  <div class="pulse" id="pulse"></div>
  <h1>JACO Agent</h1>
  <span class="status" id="hdr-status">Ansluter...</span>
</div>
<div class="tabs">
  <div class="tab active" onclick="switchTab('log')">Aktivitet</div>
  <div class="tab" onclick="switchTab('state')">Status</div>
  <div class="tab" onclick="switchTab('chat')">Chatt</div>
</div>

<div id="log-panel"></div>

<div id="state-panel">
  <div class="state-grid">
    <div class="state-card"><h3>Revenue</h3><div class="state-val" id="s-rev">$0</div><div class="state-sub" id="s-rev-sub">0 transaktioner</div></div>
    <div class="state-card"><h3>Tasks</h3><div class="state-val" id="s-tasks">0</div><div class="state-sub" id="s-tasks-sub">0 misslyckade</div></div>
    <div class="state-card"><h3>Ticks</h3><div class="state-val" id="s-ticks">0</div><div class="state-sub" id="s-uptime">Uptime: -</div></div>
    <div class="state-card"><h3>Queue</h3><div class="state-val" id="s-queue">0</div><div class="state-sub">väntande uppgifter</div></div>
  </div>
  <div class="state-card" style="margin-top:8px">
    <h3>Ytor (surfaces)</h3>
    <div id="s-surfaces"></div>
  </div>
</div>

<div id="chat-panel">
  <div id="chat-messages">
    <div class="msg msg-agent"><div class="sender">JACO</div>Hej! Jag är din autonoma agent. Fråga vad du vill — eller ge mig ett uppdrag.</div>
  </div>
  <div class="chat-input-row">
    <textarea id="chat-input" placeholder="Skriv ett meddelande eller uppdrag..." onkeydown="chatKey(event)"></textarea>
    <button id="chat-send" onclick="sendChat()">Skicka</button>
  </div>
</div>

<script>
let currentTab = 'log';
let logCount = 0;
let sseSource = null;

function switchTab(t) {
  currentTab = t;
  document.querySelectorAll('.tab').forEach((el,i) => el.classList.toggle('active', ['log','state','chat'][i]===t));
  document.getElementById('log-panel').style.display = t==='log'?'flex':'none';
  document.getElementById('state-panel').style.display = t==='state'?'block':'none';
  document.getElementById('chat-panel').style.display = t==='chat'?'flex':'none';
  if (t==='state') refreshState();
  if (t==='chat') scrollChat();
}
switchTab('log');

// SSE log stream
function connectSSE() {
  if (sseSource) sseSource.close();
  sseSource = new EventSource('/stream');
  sseSource.onopen = () => {
    document.getElementById('hdr-status').textContent = 'Live';
    document.getElementById('pulse').style.background = 'var(--green)';
  };
  sseSource.onerror = () => {
    document.getElementById('hdr-status').textContent = 'Återansluter...';
    document.getElementById('pulse').style.background = 'var(--yellow)';
    setTimeout(connectSSE, 3000);
  };
  sseSource.addEventListener('log', e => {
    const entry = JSON.parse(e.data);
    appendLog(entry);
  });
  sseSource.addEventListener('chat-reply', e => {
    const {text} = JSON.parse(e.data);
    addChatMsg('agent', text);
  });
}

function appendLog(entry) {
  const panel = document.getElementById('log-panel');
  const div = document.createElement('div');
  div.className = 'log-entry level-' + (entry.level||'info');
  const ts = entry.ts ? new Date(entry.ts).toLocaleTimeString('sv-SE') : '';
  div.innerHTML = \`<span class="log-ts">\${ts}</span><span class="log-icon"></span><span class="log-body"><span class="log-comp">[\${entry.component||''}]</span> <span class="log-msg">\${escHtml(entry.message||'')}</span></span>\`;
  panel.appendChild(div);
  logCount++;
  if (logCount > 300) panel.firstChild?.remove();
  if (currentTab === 'log') panel.scrollTop = panel.scrollHeight;
}

function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function refreshState() {
  try {
    const r = await fetch('/state'); const s = await r.json();
    document.getElementById('s-rev').textContent = '$' + (s.revenue?.total||0).toFixed(2);
    document.getElementById('s-rev-sub').textContent = (s.revenue?.transactions?.length||0) + ' transaktioner';
    document.getElementById('s-tasks').textContent = s.completedTasks||0;
    document.getElementById('s-tasks-sub').textContent = (s.failedTasks||0) + ' misslyckade';
    document.getElementById('s-ticks').textContent = s.ticks||0;
    const up = s.startedAt ? Math.floor((Date.now()-s.startedAt)/60000) : 0;
    document.getElementById('s-uptime').textContent = 'Uptime: '+up+'min';
    document.getElementById('s-queue').textContent = s.taskQueue?.length||0;
    const surfs = s.surfaces||{};
    document.getElementById('s-surfaces').innerHTML = Object.entries(surfs).map(([k,v])=>
      \`<div class="surface-row"><div class="dot \${v?'dot-on':'dot-off'}"></div>\${k}</div>\`).join('');
  } catch {}
}

// Chat
async function sendChat() {
  const inp = document.getElementById('chat-input');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  addChatMsg('user', text);
  try {
    await fetch('/chat', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
  } catch {}
}
function chatKey(e) { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }
function addChatMsg(role, text) {
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'msg msg-' + role;
  if (role==='agent') div.innerHTML = \`<div class="sender">JACO</div>\${escHtml(text)}\`;
  else div.textContent = text;
  msgs.appendChild(div);
  scrollChat();
}
function scrollChat() {
  const m = document.getElementById('chat-messages');
  setTimeout(()=>m.scrollTop=m.scrollHeight,50);
}

connectSSE();
setInterval(()=>{ if(currentTab==='state') refreshState(); }, 5000);
</script>
</body>
</html>`;

// SSE clients
const clients = new Set();

// Tail log file and push to SSE clients
let logPos = 0;
try { if (existsSync(LOG_FILE)) logPos = statSync(LOG_FILE).size; } catch {}

setInterval(() => {
  if (!existsSync(LOG_FILE)) return;
  const size = statSync(LOG_FILE).size;
  if (size <= logPos) return;
  const buf = Buffer.alloc(size - logPos);
  const fd = openSync(LOG_FILE, "r");
  readSync(fd, buf, 0, buf.length, logPos);
  closeSync(fd);
  logPos = size;
  const lines = buf.toString("utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      broadcast("log", entry);
    } catch {}
  }
}, 500);

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(msg); } catch { clients.delete(res); }
  }
}

// Poll chat inbox for agent replies
let lastChatCheck = 0;
setInterval(() => {
  try {
    const inbox = JSON.parse(readFileSync(CHAT_INBOX, "utf8"));
    const replies = inbox.filter(m => m.role === "agent" && m.ts > lastChatCheck);
    if (replies.length) {
      lastChatCheck = Date.now();
      for (const r of replies) broadcast("chat-reply", { text: r.text });
    }
  } catch {}
}, 1000);

const server = createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML);
  } else if (req.url === "/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write("retry: 3000\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));

    // Send last 50 log lines immediately
    try {
      const lines = readFileSync(LOG_FILE, "utf8").split("\n").filter(Boolean).slice(-50);
      for (const line of lines) {
        try { res.write(`event: log\ndata: ${line}\n\n`); } catch {}
      }
    } catch {}
  } else if (req.url === "/state") {
    res.writeHead(200, { "Content-Type": "application/json" });
    try { res.end(readFileSync(STATE_FILE, "utf8")); }
    catch { res.end("{}"); }
  } else if (req.url === "/chat" && req.method === "POST") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      try {
        const { text } = JSON.parse(body);
        const inbox = JSON.parse(readFileSync(CHAT_INBOX, "utf8"));
        inbox.push({ role: "user", text, ts: Date.now(), read: false });
        writeFileSync(CHAT_INBOX, JSON.stringify(inbox, null, 2));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      } catch { res.writeHead(400); res.end("{}"); }
    });
  } else {
    res.writeHead(404); res.end();
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\nJACO Agent UI -> http://localhost:${PORT}\n`);
});
