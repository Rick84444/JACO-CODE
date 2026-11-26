import { SecretStore } from '../../../../agents/lib/secret-store.mjs';
import { isGuidedCredentialRef, guidedCredentialMatches, stripeSandboxKey, LINEAR_OAUTH } from '../../lib/mcpIntegrationCatalog.mjs';
import {linearOAuthAccess,parseLinearOAuth} from './mcpOAuthTransport.mjs';

// A guided secret is resolved in process only, for the exact provider endpoint.
export function mcpCredential(id,def,env=process.env){
  if(!def.tokenEnv)return '';
  if(id==='stripe-sandbox'&&def.tokenEnv==='STRIPE_SANDBOX_PROBE_KEY'){
    if(def.url!=='https://mcp.stripe.com/'||!stripeSandboxKey(env[def.tokenEnv]))return '';
    return env[def.tokenEnv];
  }
  if(!isGuidedCredentialRef(def.tokenEnv))return env[def.tokenEnv]||'';
  if(!guidedCredentialMatches(id,def))return '';
  try{const raw=new SecretStore({env}).get(def.tokenEnv)||'';if(id===LINEAR_OAUTH.id){const record=parseLinearOAuth(raw);return record&&record.expiresAt>Date.now()?record.accessToken:'';}const token=raw;return id==='stripe-sandbox'&&!stripeSandboxKey(token)?'':token;}catch{return '';}
}
// Streamable HTTP transport used by the canonical MCP host.
// Only emit finite error codes; low-level fetch errors can contain private
// network details and must not leak into the agent log or public UI.
export function classifyMcpNetworkError(error) {
  const message = String(error?.message || '');
  if (/^MCP_[A-Z0-9_]+(?::[-A-Z0-9_]+)?$/.test(message)) return message;
  const causes = [];
  for (let current = error, depth = 0; current && depth < 4; current = current.cause, depth++) {
    if (typeof current.code === 'string') causes.push(current.code);
  }
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || causes.includes('ETIMEDOUT')) return 'MCP_TRANSPORT_TIMEOUT';
  if (causes.some(code => ['ENOTFOUND', 'EAI_AGAIN'].includes(code))) return 'MCP_TRANSPORT_DNS';
  if (causes.some(code => ['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE'].includes(code))) return 'MCP_TRANSPORT_UNREACHABLE';
  if (causes.some(code => /^(ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_VERIFY|DEPTH_ZERO|SELF_SIGNED_CERT)/.test(code))) return 'MCP_TRANSPORT_TLS';
  return 'MCP_CONNECTION_FAILED';
}
// JSON-RPC rejected the request itself (parse error, invalid request, unknown method, invalid
// params): the server ran nothing. Such errors are definite and carry a short sanitized reason
// so an agent can correct its call; other remote error text stays hidden.
const NOT_EXECUTED = new Set([-32700, -32600, -32601, -32602]);
export function rpcError(error) {
  const code = Number(error?.code) || 'UNKNOWN';
  const definite = NOT_EXECUTED.has(code);
  const reason = definite ? String(error?.message || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) : '';
  return Object.assign(new Error(`MCP_RPC_ERROR:${code}${reason ? '_' + reason : ''}`), definite ? { preDispatch: true } : {});
}
export class HttpMcpClient {
  constructor(id, def, { fetchImpl = fetch, env = process.env, oauthAccess = null } = {}) {
    Object.assign(this, { id, def, fetchImpl, env, oauthAccess });
    this.protocol = '2025-06-18'; this.nextId = 1; this.tools = []; this.ready = null; this.initialized = false;
    this.session = null; this.error = null; this.startedAt = null; this.generation = 0;
  }
  assertCurrent(generation) {
    if (generation !== this.generation) throw Error('MCP_REQUEST_SUPERSEDED');
  }
  async request(method, params, timeoutMs = 20000, notification = false) {
    const generation = this.generation;
    if(this.id===LINEAR_OAUTH.id){
      if(!guidedCredentialMatches(this.id,this.def))throw Object.assign(Error('MCP_OAUTH_ENDPOINT_INVALID'),{preDispatch:true});
      if(!['initialize','notifications/initialized','tools/list'].includes(method)&&!(method==='tools/call'&&this.tools.some(t=>t.name===params?.name&&t.readOnly===true)))throw Object.assign(Error('MCP_OAUTH_READ_ONLY'),{preDispatch:true});
    }
    if(this.id==='stripe-sandbox'){
      if(this.def.url!=='https://mcp.stripe.com/'||!['JACO_MCP_GUIDED_STRIPE_SANDBOX','STRIPE_SANDBOX_PROBE_KEY'].includes(this.def.tokenEnv))throw Object.assign(Error('MCP_STRIPE_SANDBOX_SCOPE_INVALID'),{preDispatch:true});
      const allowed=['initialize','notifications/initialized','tools/list'];
      if(!allowed.includes(method)&&!(method==='tools/call'&&params?.name==='get_stripe_account_info'&&params.arguments&&typeof params.arguments==='object'&&!Array.isArray(params.arguments)&&Object.keys(params.arguments).length===0))throw Object.assign(Error('MCP_STRIPE_SANDBOX_READ_ONLY'),{preDispatch:true});
    }
    if (this.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw Error('MCP_TLS_VERIFICATION_REQUIRED');
    const id = notification ? undefined : this.nextId++;
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': this.protocol };
    if (this.session) headers['Mcp-Session-Id'] = this.session;
    if (this.def.tokenEnv) {
      let token;
      try{token=this.id===LINEAR_OAUTH.id?(this.oauthAccess?await this.oauthAccess():await linearOAuthAccess({store:new SecretStore({env:this.env}),fetchImpl:this.fetchImpl})):mcpCredential(this.id,this.def,this.env);}
      catch(error){this.assertCurrent(generation);this.error=classifyMcpNetworkError(error);this.stop();throw Error(this.error);}
      this.assertCurrent(generation);
      if (!token) { this.error='MCP_CREDENTIAL_REQUIRED'; this.stop(); throw Error(this.error); }
      headers.authorization = `Bearer ${token}`;
    }
    let response;
    try {
      response = await this.fetchImpl(this.def.url, { method: 'POST', redirect: 'error', headers,
        body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }), signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (generation !== this.generation) throw Error('MCP_REQUEST_SUPERSEDED');
      throw Error(classifyMcpNetworkError(error));
    }
    // A late reply from a retired session may neither overwrite its replacement's
    // session header nor stop the replacement on a stale 404.
    if (generation !== this.generation) { void response.body?.cancel().catch(() => {}); throw Error('MCP_REQUEST_SUPERSEDED'); }
    if (response.status === 404 && this.session) { this.error = 'MCP_SESSION_EXPIRED'; this.stop(); throw Error('MCP_SESSION_EXPIRED'); }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      if (response.status === 401 || response.status === 403) {
        this.error='MCP_AUTH_REQUIRED'; this.stop(); throw Error(this.error);
      }
      throw Error(`MCP_HTTP_${response.status}`);
    }
    const session = response.headers.get('mcp-session-id');
    if (session) this.session = session;
    if (notification) { await response.body?.cancel(); return; }
    const reader = response.body?.getReader();
    if (!reader) throw Error('MCP_EMPTY_RESPONSE');
    let raw = '', bytes = 0, decoder = new TextDecoder();
    const sse = (response.headers.get('content-type') || '').includes('text/event-stream');
    try {
      while (true) {
        const chunk = await reader.read();
        this.assertCurrent(generation);
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 2 * 1024 * 1024) throw Error('MCP_RESPONSE_TOO_LARGE');
        raw += decoder.decode(chunk.value, { stream: true });
        if (sse) {
          const blocks = raw.replace(/\r\n/g, '\n').split('\n\n'); raw = blocks.pop();
          for (const block of blocks) {
            const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
            if (!data) continue;
            const message = JSON.parse(data);
            if (message.id === id) return this.result(message);
          }
        }
      }
      if (sse) throw Error('MCP_RESPONSE_ID_MISSING');
      const message = JSON.parse(raw);
      if (message.id !== id) throw Error('MCP_RESPONSE_ID_MISMATCH');
      return this.result(message);
    } finally { await reader.cancel().catch(() => {}); }
  }
  result(message) {
    // Remote error text can contain credentials or request details; expose a bounded code only.
    if (message.error) throw rpcError(message.error);
    return message.result;
  }
  start() {
    if (this.ready) return this.ready;
    const generation = ++this.generation;
    this.protocol = '2025-06-18'; this.session = null; this.tools = []; this.initialized = false; this.error = null;
    const pending = (async () => {
      this.startedAt = new Date().toISOString();
      const initialized = await this.request('initialize', { protocolVersion: this.protocol, capabilities: {}, clientInfo: { name: 'jaco', version: '0.21' } });
      this.assertCurrent(generation);
      if (!['2025-03-26','2025-06-18'].includes(initialized?.protocolVersion)) throw Error('MCP_PROTOCOL_UNSUPPORTED');
      this.protocol = initialized.protocolVersion;
      await this.request('notifications/initialized', {}, 20000, true);
      this.assertCurrent(generation);
      let cursor, tools = [], seen = new Set();
      do {
        const listed = await this.request('tools/list', cursor ? { cursor } : {});
        this.assertCurrent(generation);
        if (!Array.isArray(listed?.tools)) throw Error('MCP_TOOL_LIST_INVALID');
        tools.push(...listed.tools); cursor = listed.nextCursor;
        if (tools.length > 500 || seen.size >= 20 || (cursor && seen.has(cursor))) throw Error('MCP_TOOL_LIST_LIMIT');
        if (cursor) seen.add(cursor);
      } while (cursor);
      this.assertCurrent(generation);
      this.tools = tools.map(t => ({ name: String(t.name).slice(0,200), description: String(t.description || '').slice(0,3000), inputSchema: t.inputSchema || {type:'object'}, readOnly: t.annotations?.readOnlyHint === true }));
      if(this.id===LINEAR_OAUTH.id)this.tools=this.tools.filter(t=>t.readOnly===true);
      if(this.id==='stripe-sandbox')this.tools=this.tools.filter(t=>t.name==='get_stripe_account_info'&&t.readOnly===true&&t.inputSchema?.type==='object'&&!(t.inputSchema.required||[]).length);
      this.initialized = true; this.error = null; return this;
    })().catch(error => {
      const code = classifyMcpNetworkError(error);
      if (generation === this.generation && this.ready === pending) { this.error = code; this.stop(); }
      throw Error(code);
    });
    this.ready = pending;
    return pending;
  }
  stop() { this.generation++; this.ready = null; this.initialized = false; this.session = null; this.tools = []; }
}

