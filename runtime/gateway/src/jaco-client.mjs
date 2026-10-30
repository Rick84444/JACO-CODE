export class JacoCoreClient {
  constructor({ baseUrl, token = '', modelId = 'jaco-mcp-client', timeoutMs = 30000, fetchImpl = fetch }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.modelId = modelId;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async request(path, options = {}) {
    const headers = {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-jaco-model-id': this.modelId,
      ...(options.headers || {})
    };
    if (this.token) headers['x-gateway-token'] = this.token;
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...options,
        headers,
        signal: options.signal || AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw new Error(`JACO_CORE_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`);
    }
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; }
    catch { data = { raw: text }; }
    if (!response.ok) {
      const msg = data?.error?.message || data?.error || data?.message || text.slice(0, 300) || response.statusText;
      throw new Error(`JACO_CORE_HTTP_${response.status}: ${msg}`);
    }
    return data;
  }

  attachmentRead({id,path='',offset=0,limit=12000}) { return this.request(`/api/attachments/${encodeURIComponent(id)}?path=${encodeURIComponent(path)}&offset=${offset}&limit=${limit}`); }
  identity() { return this.request('/api/runtime/identity'); }
  unifiedStatus() { return this.request('/api/hands-off/unified/status'); }
  targets(port) { return this.request(`/api/browser/hands-off/targets${port ? `?port=${encodeURIComponent(port)}` : ''}`); }
  attach(args) { return this.request('/api/browser/hands-off/attach', { method: 'POST', body: JSON.stringify(args) }); }
  survey(args) { return this.request('/api/browser/hands-off/survey', { method: 'POST', body: JSON.stringify(args) }); }
  novaBegin(args) { return this.request('/api/nova/traction/begin', { method: 'POST', body: JSON.stringify(args) }); }
  novaTarget(args) { return this.request('/api/nova/traction/target', { method: 'POST', body: JSON.stringify(args) }); }
  mandates() { return this.request('/api/relay/mandates'); }
  relayAction(args) { return this.request('/api/relay/action', { method: 'POST', body: JSON.stringify(args) }); }
  browserReceipts(limit = 20) { return this.request(`/api/browser/hands-off/receipts?limit=${encodeURIComponent(limit)}`); }

  connectedStatus() { return this.request('/api/connected/status'); }
  seerLive() { return this.request('/api/seer/live'); }
  seerGoal(args) { return this.request('/api/connected/goals', { method:'POST', body:JSON.stringify(args) }); }
  missionList(limit=100) { return this.request(`/api/connected/missions?limit=${encodeURIComponent(limit)}`); }
  missionTickets(args={}) { const q=new URLSearchParams(); if(args.missionId)q.set('missionId',args.missionId); if(args.status)q.set('status',args.status); q.set('limit',String(args.limit||200)); return this.request(`/api/connected/tickets?${q}`); }
  missionTick() { return this.request('/api/connected/tick',{method:'POST',body:'{}'}); }
  mcpCatalog() { return this.request('/api/mcp/tools'); }
  mcpRead({server,tool,args={}}) {
    return this.request('/api/mcp/call',{method:'POST',body:JSON.stringify({server,tool,arguments:args,mode:'read'})});
  }
  providers() { return this.request('/api/connected/providers'); }
  providerRegister(args) { return this.request('/api/connected/providers',{method:'POST',body:JSON.stringify(args)}); }
  providerProbe(id) { return this.request(`/api/connected/providers/${encodeURIComponent(id)}/probe`,{method:'POST',body:'{}'}); }
  auraProviderChat(args) { return this.request('/api/connected/aura/chat',{method:'POST',body:JSON.stringify(args)}); }
  wordpressStatus() { return this.request('/api/connected/wordpress/status'); }
  wordpressPages(args={}) { const q=new URLSearchParams(); if(args.search)q.set('search',args.search); if(args.perPage)q.set('perPage',String(args.perPage)); return this.request(`/api/connected/wordpress/pages?${q}`); }
  wordpressUpdate(args) { return this.request('/api/connected/wordpress/update',{method:'POST',body:JSON.stringify(args)}); }
  wordpressImprove(args) { return this.request('/api/connected/wordpress/improve',{method:'POST',body:JSON.stringify(args)}); }
  a2aDiscover(args) { return this.request('/api/connected/a2a/discover',{method:'POST',body:JSON.stringify(args)}); }
  a2aOutbound(args) { return this.request('/api/connected/a2a/outbound',{method:'POST',body:JSON.stringify(args)}); }
  wordpressCss(args) { return this.relayAction({ ...args, surface:'BROWSER', consequence:'PUBLISH', action:{type:'wordpress_apply_css',text:args.css,wait_after_ms:args.waitAfterMs||1800} }); }
}
