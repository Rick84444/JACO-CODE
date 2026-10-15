// Streamable HTTP transport used by the canonical MCP host.
export class HttpMcpClient {
  constructor(id, def, { fetchImpl = fetch, env = process.env } = {}) {
    Object.assign(this, { id, def, fetchImpl, env });
    this.protocol = '2025-06-18'; this.nextId = 1; this.tools = []; this.ready = null; this.initialized = false;
    this.session = null; this.error = null; this.startedAt = null;
  }
  async request(method, params, timeoutMs = 20000, notification = false) {
    if (this.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw Error('MCP_TLS_VERIFICATION_REQUIRED');
    const id = notification ? undefined : this.nextId++;
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': this.protocol };
    if (this.session) headers['Mcp-Session-Id'] = this.session;
    if (this.def.tokenEnv) {
      const token = this.env[this.def.tokenEnv];
      if (!token) throw Error('MCP_CREDENTIAL_REQUIRED');
      headers.authorization = `Bearer ${token}`;
    }
    const response = await this.fetchImpl(this.def.url, { method: 'POST', redirect: 'error', headers,
      body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }), signal: AbortSignal.timeout(timeoutMs) });
    if (response.status === 404 && this.session) { this.stop(); throw Error('MCP_SESSION_EXPIRED'); }
    if (!response.ok) throw Error(response.status === 401 || response.status === 403 ? 'MCP_AUTH_REQUIRED' : `MCP_HTTP_${response.status}`);
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
    if (message.error) throw Error(`MCP_RPC_ERROR:${Number(message.error.code) || 'UNKNOWN'}`);
    return message.result;
  }
  start() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      this.startedAt = new Date().toISOString();
      const initialized = await this.request('initialize', { protocolVersion: this.protocol, capabilities: {}, clientInfo: { name: 'jaco', version: '0.21' } });
      if (!['2025-03-26','2025-06-18'].includes(initialized?.protocolVersion)) throw Error('MCP_PROTOCOL_UNSUPPORTED');
      this.protocol = initialized.protocolVersion;
      await this.request('notifications/initialized', {}, 20000, true);
      let cursor, tools = [], seen = new Set();
      do {
        const listed = await this.request('tools/list', cursor ? { cursor } : {});
        if (!Array.isArray(listed?.tools)) throw Error('MCP_TOOL_LIST_INVALID');
        tools.push(...listed.tools); cursor = listed.nextCursor;
        if (tools.length > 500 || seen.size >= 20 || (cursor && seen.has(cursor))) throw Error('MCP_TOOL_LIST_LIMIT');
        if (cursor) seen.add(cursor);
      } while (cursor);
      this.tools = tools.map(t => ({ name: String(t.name).slice(0,200), description: String(t.description || '').slice(0,3000), inputSchema: t.inputSchema || {type:'object'}, readOnly: t.annotations?.readOnlyHint === true }));
      this.initialized = true; this.error = null; return this;
    })().catch(error => { this.error = /^MCP_/.test(error.message) ? error.message : 'MCP_CONNECTION_FAILED'; this.stop(); throw Error(this.error); });
    return this.ready;
  }
  stop() { this.ready = null; this.initialized = false; this.session = null; }
}

