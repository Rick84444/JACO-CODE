const DEFAULT_URL = process.env.JACO_WORKPLACE_URL || 'http://127.0.0.1:2995';

function trimSlash(value) { return String(value).replace(/\/+$/, ''); }

export class JacoWorkplaceClient {
  constructor(options = {}) {
    this.baseUrl = trimSlash(options.baseUrl || DEFAULT_URL);
    this.token = options.token ?? process.env.JACO_WORKPLACE_TOKEN ?? '';
    this.workspace = options.workspace || process.env.JACO_WORKSPACE || 'JACO';
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.agentId = null;
    this.sessionId = null;
    this.sessionToken = null;
    this.syncUntilCursor = 0;
    this.cursor = 0;
  }

  async request(path, { method = 'GET', body = null } = {}) {
    const headers = { accept: 'application/json' };
    if (body != null) headers['content-type'] = 'application/json';
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (this.sessionToken) headers['x-jaco-session-token'] = this.sessionToken;
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `WORKPLACE_HTTP_${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  health() { return this.request('/health'); }

  async register(agentCard) {
    const result = await this.request('/v1/register', {
      method: 'POST',
      body: { workspace: this.workspace, agentCard }
    });
    this.agentId = result.agentId;
    this.sessionId = result.sessionId;
    this.sessionToken = result.sessionToken;
    this.syncUntilCursor = Number(result.syncUntilCursor || 0);
    this.cursor = Number(result.cursor || 0);
    return result;
  }

  requireSession() {
    if (!this.sessionId || !this.sessionToken) throw new Error('WORKPLACE_NOT_REGISTERED');
  }

  async sync(options = {}) {
    this.requireSession();
    return this.request('/v1/sync', {
      method: 'POST',
      body: {
        sessionId: this.sessionId,
        workspace: this.workspace,
        after: options.after ?? this.cursor,
        limit: options.limit ?? 500
      }
    });
  }

  async ack(cursor) {
    this.requireSession();
    const result = await this.request('/v1/ack', {
      method: 'POST',
      body: { sessionId: this.sessionId, workspace: this.workspace, cursor }
    });
    this.cursor = Number(result.cursor || this.cursor);
    return result;
  }

  // Reads and acknowledges pages until everything that existed at registration has been seen.
  async syncAndAck(options = {}) {
    const events = [];
    let last;
    do {
      last = await this.sync(options);
      if (typeof options.onEvents === 'function' && last.events.length) {
        await options.onEvents(last.events, last);
      }
      events.push(...last.events);
      await this.ack(last.scannedCursor);
    } while (last.scannedCursor < this.syncUntilCursor && last.scannedCursor > last.fromCursor);
    return { ...last, events };
  }

  async post(kind, body, options = {}) {
    this.requireSession();
    return this.request('/v1/events', {
      method: 'POST',
      body: {
        sessionId: this.sessionId,
        workspace: this.workspace,
        kind,
        body,
        thread: options.thread || 'general',
        targets: options.targets || ['*'],
        payload: options.payload || {},
        references: options.references || {},
        missionId: options.missionId || null,
        eventId: options.eventId || null
      }
    });
  }

  agents({ includeEnded = false } = {}) {
    return this.request(`/v1/agents${includeEnded ? '?all=1' : ''}`);
  }

  async claim(resource, options = {}) {
    this.requireSession();
    return this.request('/v1/claims', {
      method: 'POST',
      body: {
        sessionId: this.sessionId,
        workspace: this.workspace,
        resource,
        intent: options.intent || '',
        leaseSeconds: options.leaseSeconds ?? 900
      }
    });
  }

  async releaseClaim(claimId) {
    this.requireSession();
    return this.request('/v1/claims/release', {
      method: 'POST',
      body: { sessionId: this.sessionId, claimId }
    });
  }

  async heartbeat(options = {}) {
    this.requireSession();
    return this.request('/v1/heartbeat', {
      method: 'POST',
      body: {
        sessionId: this.sessionId,
        workspace: this.workspace,
        status: options.status || 'READY',
        activeMission: options.activeMission || null
      }
    });
  }

  async end(handoff = null) {
    this.requireSession();
    const result = await this.request('/v1/session/end', {
      method: 'POST',
      body: { sessionId: this.sessionId, workspace: this.workspace, handoff }
    });
    this.sessionId = null;
    this.sessionToken = null;
    return result;
  }
}

export async function bootstrapJacoAgent(agentCard, options = {}) {
  const client = new JacoWorkplaceClient(options);
  const registration = await client.register(agentCard);
  const sync = await client.syncAndAck({ onEvents: options.onEvents });
  await client.post('STATUS', 'Agent bootstrap complete', {
    thread: 'agent-status',
    payload: {
      status: 'READY',
      agentId: registration.agentId,
      sessionId: registration.sessionId,
      cursor: client.cursor
    }
  });
  return { client, registration, sync };
}
