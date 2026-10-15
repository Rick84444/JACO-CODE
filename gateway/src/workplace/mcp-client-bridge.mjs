import { JacoWorkplaceClient } from './workplace-client.mjs';

const COMM_KINDS = new Set(['MESSAGE','QUESTION','ANSWER','HANDOFF','FINDING']);
const clip = (value, max = 12000) => String(value ?? '').slice(0, max);

function inferredIdentity(modelId, env = process.env) {
  const id = String(modelId || env.JACO_MODEL_ID || 'mcp-client').toLowerCase();
  if (env.JACO_AGENT_STABLE_ID || env.JACO_AGENT_NAME || env.JACO_AGENT_PROVIDER) {
    return {
      stableId: env.JACO_AGENT_STABLE_ID || id,
      name: env.JACO_AGENT_NAME || modelId || 'JACO MCP Client',
      provider: env.JACO_AGENT_PROVIDER || 'unknown',
      model: env.JACO_AGENT_MODEL || 'unknown',
    };
  }
  if (id.includes('claude')) return { stableId:'claude-code', name:'Claude Code', provider:'anthropic', model:'unknown' };
  if (id.includes('codex')) return { stableId:'vscode-codex-jaco', name:'VS Code Codex', provider:'openai', model:'unknown' };
  if (id.includes('chatgpt') || id.includes('openai')) return { stableId:id, name:'OpenAI MCP Client', provider:'openai', model:'unknown' };
  return { stableId:id, name:modelId || 'JACO MCP Client', provider:'unknown', model:'unknown' };
}

export function buildMcpClientAgentCard(modelId, env = process.env) {
  const identity = inferredIdentity(modelId, env);
  return {
    schema:'jaco.agent-card/v1',
    identity:{
      stable_id: identity.stableId,
      requested_name: identity.name,
      provider: identity.provider,
      model: identity.model,
      agent_type:'coding',
    },
    session:{
      environment: env.JACO_AGENT_ENVIRONMENT || 'mcp-stdio',
      persistent:false,
      sandboxed: env.JACO_AGENT_SANDBOXED === '1',
    },
    role:{
      primary:'external-coding-client',
      description:'External coding/reasoning client connected through the canonical JACO MCP and Workplace communication surfaces.',
    },
    capabilities:{
      reasoning:true,
      code_generation:true,
      code_edit:false,
      filesystem_read:false,
      filesystem_write:false,
      terminal:false,
      git_read:false,
      git_write:false,
      git_push:false,
      web:false,
      browser_control:false,
      desktop_control:false,
      image_understanding:false,
      database:false,
      testing:false,
      deployment:false,
      tools:['jaco-mcp','workplace-communication'],
    },
    constraints:[
      'MCP registration advertises only capabilities observable through this connector; client-local filesystem/terminal rights are not assumed.',
      'No background cognition is implied by a READY Workplace session.',
    ],
    preferred_tasks:['coordination','code-review','implementation-handoff'],
    communication:{can_receive_messages:true,can_receive_missions:false,can_be_mentioned:true},
    runtime:{started_at:new Date().toISOString(),version:'mcp-workplace-bridge-v1'},
  };
}

export class McpWorkplaceBridge {
  constructor({ modelId, env = process.env, pollMs = 2000, heartbeatMs = 60000, maxInbox = 250 } = {}) {
    this.modelId = modelId || env.JACO_MODEL_ID || 'mcp-client';
    this.env = env;
    this.pollMs = Math.max(500, Math.min(Number(pollMs) || 2000, 60000));
    this.heartbeatMs = Math.max(5000, Number(heartbeatMs) || 60000);
    this.maxInbox = Math.max(20, Math.min(Number(maxInbox) || 250, 2000));
    this.state = 'REGISTERING';
    this.error = null;
    this.client = null;
    this.registration = null;
    this.inbox = [];
    this.syncTimer = null;
    this.heartbeatTimer = null;
    this.syncing = false;
    this.started = false;
  }

  status() {
    return {
      state:this.state,
      error:this.error,
      modelId:this.modelId,
      agentId:this.registration?.agentId || null,
      sessionId:this.registration?.sessionId || null,
      cursor:Number(this.client?.cursor || 0),
      inboxSize:this.inbox.length,
      workplaceUrl:this.client?.baseUrl || this.env.JACO_WORKPLACE_URL || 'http://127.0.0.1:2995',
    };
  }

  #record(events = []) {
    for (const event of events) this.inbox.push(event);
    if (this.inbox.length > this.maxInbox) this.inbox.splice(0, this.inbox.length - this.maxInbox);
  }

  async start() {
    if (this.started) return this.status();
    this.started = true;
    const baseUrl = this.env.JACO_WORKPLACE_URL || 'http://127.0.0.1:2995';
    this.client = new JacoWorkplaceClient({
      baseUrl,
      token:this.env.JACO_WORKPLACE_TOKEN || '',
      timeoutMs:Number(this.env.JACO_WORKPLACE_CLIENT_TIMEOUT_MS || 2000),
    });
    try {
      this.registration = await this.client.register(buildMcpClientAgentCard(this.modelId, this.env));
      await this.client.syncAndAck({
        onEvents: async events => this.#record(events),
      });
      await this.client.post('STATUS','MCP client Workplace bootstrap complete',{
        thread:'agent-status',
        payload:{status:'READY',agentId:this.registration.agentId,sessionId:this.registration.sessionId},
      });
      this.state = 'READY';
      this.error = null;
    } catch (error) {
      this.state = 'DEGRADED_UNSYNCED';
      this.error = clip(error?.message || error, 400);
      this.started = false;
      return this.status();
    }

    this.syncTimer = setInterval(() => { void this.syncNow(); }, this.pollMs);
    this.syncTimer.unref?.();
    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.client.heartbeat({status:this.state === 'READY' ? 'READY' : 'DEGRADED_UNSYNCED'});
      } catch (error) {
        this.state='DEGRADED_UNSYNCED';
        this.error=clip(error?.message || error,400);
      }
    }, this.heartbeatMs);
    this.heartbeatTimer.unref?.();
    return this.status();
  }

  async syncNow() {
    if (!this.client?.sessionId || this.syncing) return null;
    this.syncing = true;
    try {
      const page = await this.client.sync();
      this.#record(page.events || []);
      if (Number(page.scannedCursor || 0) > Number(this.client.cursor || 0)) await this.client.ack(page.scannedCursor);
      if (this.state !== 'READY') {
        await this.client.heartbeat({status:'READY'});
        this.state='READY';
        this.error=null;
      }
      return page;
    } catch (error) {
      this.state='DEGRADED_UNSYNCED';
      this.error=clip(error?.message || error,400);
      return null;
    } finally {
      this.syncing=false;
    }
  }

  async agents() {
    if (!this.started) await this.start();
    if (!this.client) return { agents:[], bridge:this.status() };
    try {
      const result = await this.client.agents();
      return { ...result, bridge:this.status() };
    } catch (error) {
      return { agents:[], bridge:{...this.status(),error:clip(error?.message || error,400)} };
    }
  }

  async messages({ afterSeq = 0, thread = null, kinds = null, limit = 100 } = {}) {
    if (!this.started) await this.start();
    await this.syncNow();
    const wantedKinds = Array.isArray(kinds) && kinds.length ? new Set(kinds.map(v=>String(v).toUpperCase())) : null;
    const max = Math.max(1, Math.min(Number(limit) || 100, 500));
    const events = this.inbox.filter(event =>
      Number(event.seq || 0) > Number(afterSeq || 0) &&
      (!thread || event.thread === thread) &&
      (!wantedKinds || wantedKinds.has(String(event.kind || '').toUpperCase()))
    ).slice(-max);
    return { events, bridge:this.status() };
  }

  async post({ kind = 'MESSAGE', body = '', thread = 'general', targets = ['*'], references = {} } = {}) {
    if (!this.started) await this.start();
    if (this.state !== 'READY' || !this.client?.sessionId) throw new Error('WORKPLACE_AGENT_NOT_READY');
    const normalized = String(kind || 'MESSAGE').toUpperCase();
    if (!COMM_KINDS.has(normalized)) throw new Error('WORKPLACE_COMM_KIND_UNSUPPORTED');
    const cleanTargets = Array.isArray(targets) && targets.length ? [...new Set(targets.map(String))].slice(0,16) : ['*'];
    return await this.client.post(normalized, clip(body), {
      thread:clip(thread,120) || 'general',
      targets:cleanTargets,
      references:references && typeof references === 'object' && !Array.isArray(references) ? references : {},
      payload:{transport:'mcp-workplace-bridge-v1'},
    });
  }

  async end() {
    clearInterval(this.syncTimer);
    clearInterval(this.heartbeatTimer);
    if (!this.client?.sessionId) return null;
    try { return await this.client.end({thread:'handoff',body:'MCP client session ended'}); }
    finally { this.state='OFFLINE'; }
  }
}
