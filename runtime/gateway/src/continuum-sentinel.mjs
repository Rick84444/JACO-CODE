#!/usr/bin/env node
import { createServer } from 'node:http';
import { ContinuumCoreClient } from './continuum-client.mjs';
import { timingSafeEqual } from 'node:crypto';

const HOST = process.env.JACO_CONTINUUM_SENTINEL_HOST || '127.0.0.1';
const PORT = Number(process.env.JACO_CONTINUUM_SENTINEL_PORT || 3299);
const CORE = (process.env.JACO_CONTINUUM_URL || 'http://127.0.0.1:3020').replace(/\/$/, '');
const TOKEN = process.env.JACO_CONTINUUM_TOKEN || '';
const BEARER = process.env.JACO_CONTINUUM_SENTINEL_BEARER || '';
const loopback = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
if (!loopback && !BEARER) throw new Error('Refusing non-loopback Continuum Sentinel without bearer');
const mcpCore=new ContinuumCoreClient({baseUrl:CORE,token:TOKEN});
let mcpNodeHandler=null,mcpState={state:'UNAVAILABLE_DEPENDENCIES',error:null};
try{const [{createMcpHandler},{toNodeHandler},{buildContinuumMcpServer}]=await Promise.all([import('@modelcontextprotocol/server'),import('@modelcontextprotocol/node'),import('./continuum-mcp-factory.mjs')]);mcpNodeHandler=toNodeHandler(createMcpHandler(()=>buildContinuumMcpServer({core:mcpCore})));mcpState={state:'READY',sdk:'@modelcontextprotocol/server@2.0.0'};}catch(error){mcpState={state:'UNAVAILABLE_DEPENDENCIES',error:error instanceof Error?error.message:String(error)};}

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(data.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(data);
}

function authorized(req) {
  if (!BEARER) return loopback;
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return false;
  const got = Buffer.from(header.slice(7));
  const expected = Buffer.from(BEARER);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

async function coreCall(path, { method = 'GET', body = null } = {}) {
  const response = await fetch(`${CORE}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(TOKEN ? { 'x-jaco-continuum-token': TOKEN } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`CORE_${response.status}:${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url || '/', `http://${req.headers.host || HOST}`);

    if (url.pathname === '/mcp') { if (!authorized(req)) return json(res,401,{error:'MCP_AUTH_REQUIRED'}); if(!mcpNodeHandler)return json(res,503,{error:'MCP_UNAVAILABLE_DEPENDENCIES',mcp:mcpState}); return mcpNodeHandler(req,res); }

    if (req.method === 'GET' && url.pathname === '/health') {
      let core;
      try { core = await coreCall('/api/continuum/status'); }
      catch (error) { core = { success: false, error: error instanceof Error ? error.message : String(error) }; }
      return json(res, 200, {
        success: true,
        product: 'JACO Continuum Sentinel',
        version: '0.22.0',
        status: 'READY',
        mcp:{endpoint:'/mcp',...mcpState,tools:mcpNodeHandler?'reflective-futures semantic registry':null},
        core,
      });
    }

    if (!authorized(req)) return json(res, 401, { error: 'SENTINEL_AUTH_REQUIRED' });

    if (req.method === 'POST' && url.pathname === '/api/operator/emergency-stop') {
      return json(res, 200, await coreCall('/api/continuum/operator/emergency-stop', {
        method: 'POST', body: { actor: 'sentinel', reason: 'sentinel emergency stop' },
      }));
    }
    if (req.method === 'POST' && url.pathname === '/api/operator/pause') {
      return json(res, 200, await coreCall('/api/continuum/operator/pause', {
        method: 'POST', body: { actor: 'sentinel', reason: 'sentinel pause' },
      }));
    }
    return json(res, 404, { error: 'NOT_FOUND' });
  })().catch((error) => json(res, 500, { error: error instanceof Error ? error.message : String(error) }));
});

server.listen(PORT, HOST, () => console.error(`[JACO Continuum Sentinel] http://${HOST}:${PORT}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
