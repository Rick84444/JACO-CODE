// Operator Stage (test GUI, operator request 2026-11-25): a visual surface that shows Aura working.
// It is a read-only view of the canonical runtime on :3000. It starts no agent, holds no state and
// forwards only GET requests to an allow-listed set of read endpoints. Run: node runtime/operator-stage/server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.resolve(here, '..');
const PORT = Number(process.env.JACO_STAGE_PORT || 3001);
const CORE = String(process.env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

// Read-only endpoints the stage may observe. Nothing else on the runtime is reachable from here.
const READ_ENDPOINTS = [
  /^\/api\/aura\/workbench\/live$/,
  /^\/api\/aura\/workbench\/mcp\/calls$/,
  /^\/api\/aura\/workbench\/gameboard$/,
  /^\/api\/nova\/planner$/,
  /^\/api\/runtime\/identity$/,
];
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/stage.css': ['stage.css', 'text/css; charset=utf-8'],
  '/stage.js': ['stage.js', 'text/javascript; charset=utf-8'],
};
const VENDOR = {
  '/vendor/xterm.mjs': [path.join(runtimeRoot, 'node_modules/@xterm/xterm/lib/xterm.mjs'), 'text/javascript; charset=utf-8'],
  '/vendor/xterm.css': [path.join(runtimeRoot, 'node_modules/@xterm/xterm/css/xterm.css'), 'text/css; charset=utf-8'],
};

function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (req.method !== 'GET') return send(res, 405, 'text/plain', 'read-only');
  const file = STATIC[url.pathname];
  if (file) return send(res, 200, file[1], fs.readFileSync(path.join(here, file[0])));
  const vendor = VENDOR[url.pathname];
  if (vendor) return send(res, 200, vendor[1], fs.readFileSync(vendor[0]));
  if (!READ_ENDPOINTS.some(pattern => pattern.test(url.pathname))) return send(res, 404, 'text/plain', 'not found');
  try {
    const upstream = await fetch(CORE + url.pathname + url.search, { headers: { accept: req.headers.accept || '*/*' } });
    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' });
    // Stream through, so the live event source (SSE) arrives as it happens.
    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
  } catch {
    if (!res.headersSent) send(res, 502, 'application/json', JSON.stringify({ success: false, error: 'RUNTIME_UNREACHABLE' }));
    else res.end();
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`Operator Stage on http://127.0.0.1:${PORT} (read-only view of ${CORE})`));
