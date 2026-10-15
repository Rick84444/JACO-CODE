import path from 'node:path';
import crypto from 'node:crypto';
import { DurableMissionBus } from './durableMissionBus.mjs';
import { ProviderRegistry } from './providerRegistry.mjs';
import { WordPressService } from './wordpressService.mjs';
import { discoverAgentCards, sendA2ATask } from './a2aNetwork.mjs';
import { NovaMissionControl, mountNovaMissionRoutes } from './novaMissionControl.mjs';
import { DeviceRegistry, mountDeviceRoutes } from './deviceAccess.mjs';

const sha = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

export class ConnectedRuntime {
  /**
   * @param {{
   *   workspaceRoot?: string,
   *   forge?: any,
   *   seerLive?: any,
   *   executeNovaAction?: ((payload: any) => Promise<any>) | null,
   *   env?: Record<string, string | undefined>
   * }} [options]
   */
  constructor({ workspaceRoot = process.cwd(), forge = null, seerLive = null, executeNovaAction = null, env = process.env } = {}) {
    this.workspaceRoot = workspaceRoot;
    this.forge = forge;
    this.seerLive = seerLive;
    this.executeNovaAction = executeNovaAction;
    this.providers = new ProviderRegistry(workspaceRoot, env);
    this.wordpress = new WordPressService({ env, providers: this.providers });
    this.bus = new DurableMissionBus(workspaceRoot);
    this.devices = new DeviceRegistry(path.join(workspaceRoot, '.jaco', 'devices.json'));
    // A mission for a device (nova@<name>) needs a joined, unrevoked device; otherwise nothing could
    // ever claim it (2026-10-08: six missions for nova@goal-proof waited in the queue for two days).
    const knownExecutor = executor => !String(executor).includes('@')
      || this.devices.list().some(device => device.executor === executor && !device.revokedAt);
    this.novaMissions = new NovaMissionControl(this.bus, env.JACO_NOVA_ALLOWED_TASKS
      ? { allowedTasks: env.JACO_NOVA_ALLOWED_TASKS.split(',').map(s => s.trim()), knownExecutor }
      : { knownExecutor });
    this.running = false;
    this.timer = null;
    this.bus.registerWorker('forge-worker', ['forge.plan'], { role: 'Forge' });
    this.bus.registerWorker('aura-worker', ['aura.reason'], { role: 'Aura' });
    this.bus.registerWorker('web-worker', ['wordpress.update','wordpress.improve'], { role: 'WordPress/Web' });
    this.bus.registerWorker('a2a-worker', ['a2a.discover','a2a.outbound'], { role: 'A2A' });
    this.bus.registerWorker('nova-worker', ['nova.hands_off'], { role: 'Nova/Hands-Off' });
  }

  snapshot() {
    return {
      running: this.running,
      providers: this.providers.list(),
      wordpress: this.wordpress.config(),
      missions: this.bus.listMissions(50),
      novaMission: this.novaMissions.current(),
      tickets: this.bus.listTickets({ limit: 200 }),
      workers: this.bus.listWorkers(),
      dispatchPressure: this.bus.dispatchPressure(),
      learningPendingForSeer: this.bus.db.prepare('SELECT COUNT(*) AS n FROM learning WHERE consumed_by_seer=0').get().n
    };
  }

  record(type, message, verified = true, receipt = undefined) {
    this.seerLive?.record?.({ actor: 'ConnectedRuntime', type, message, verified, ...(receipt ? { receipt } : {}) });
  }

  syncSeer() {
    const workers = this.bus.listWorkers();
    const active = workers.filter(w => w.status !== 'IDLE').length;
    const pressure = this.bus.dispatchPressure();
    this.seerLive?.update?.({
      activeModule: active ? 'MissionBus' : 'SEER',
      workers: { active, max: workers.length },
      toolsSkills: ['Durable Mission Bus','Forge','Aura Providers','WordPress Render','A2A Network','Nova Hands-Off'],
      blocker: pressure.invariant === 'DISPATCH_REQUIRED' && !this.running ? 'Runnable tickets exist while Mission Bus dispatcher is stopped' : null,
      evidenceState: 'OBSERVED'
    });
  }

  createGoal(input = {}) {
    const goal = String(input.goal || '').trim(); if (!goal) throw new Error('GOAL_REQUIRED');
    const mission = this.bus.createMission({ goal, source: String(input.source || 'SEER'), metadata: { providerId: input.providerId || null, target: input.target || null }, idempotencyKey: input.idempotencyKey || null });
    if (this.bus.listTickets({ missionId: mission.id }).length) return { mission, tickets: this.bus.listTickets({ missionId: mission.id }) };
    const forge = this.bus.enqueueTicket({ missionId: mission.id, capability: 'forge.plan', title: `Forge plan: ${goal}`, payload: { goal }, priority: 100 });
    const lower = goal.toLowerCase();
    const providerId = String(input.providerId || 'ollama');
    const aura = this.bus.enqueueTicket({ missionId: mission.id, capability: 'aura.reason', title: `Aura strategy: ${goal}`, payload: { goal, providerId, model: input.model || null }, dependsOn: [forge.id], parentTicketId: forge.id, priority: 90 });
    if (lower.includes('wordpress') || lower.includes('webb') || lower.includes('website') || lower.includes('hemsida')) {
      this.bus.enqueueTicket({ missionId: mission.id, capability: 'wordpress.improve', title: `Improve WordPress page for: ${goal}`, payload: { pageId: input.pageId, providerId, model: input.model || null, strategyTicketId: aura.id, objective: input.objective || goal }, dependsOn: [aura.id], parentTicketId: forge.id, priority: 80 });
    } else if (lower.includes('a2a') || lower.includes('agent')) {
      if (Array.isArray(input.discoveryUrls) && input.discoveryUrls.length) this.bus.enqueueTicket({ missionId: mission.id, capability: 'a2a.discover', title: `Discover A2A peers for: ${goal}`, payload: { urls: input.discoveryUrls }, dependsOn: [aura.id], parentTicketId: forge.id, priority: 80 });
      if (input.endpoint) this.bus.enqueueTicket({ missionId: mission.id, capability: 'a2a.outbound', title: `A2A outbound for: ${goal}`, payload: { endpoint: input.endpoint, skill: input.skill || 'echo', message: input.message || goal }, dependsOn: [aura.id], parentTicketId: forge.id, priority: 70 });
    } else if (lower.includes('hands-off') || lower.includes('android') || lower.includes('desktop') || lower.includes('browser')) {
      this.bus.enqueueTicket({ missionId: mission.id, capability: 'nova.hands_off', title: `Nova Hands-Off: ${goal}`, payload: { surface: input.surface, action: input.action, mandateId: input.mandateId, missionId: mission.id }, dependsOn: [aura.id], parentTicketId: forge.id, priority: 80 });
    }
    this.record('mission.goal.created', goal, true, { missionId: mission.id });
    this.syncSeer();
    return { mission, tickets: this.bus.listTickets({ missionId: mission.id }) };
  }

  async executeTicket(ticket) {
    switch (ticket.capability) {
      case 'forge.plan': {
        const contract = this.forge.compileIntuition(String(ticket.payload.goal || ticket.title));
        const plan = this.forge.compileProject(contract);
        return { result: { contract, plan }, evidence: [{ type: 'forge_goal_contract', hash: sha(contract) }, { type: 'forge_project_plan', hash: sha(plan) }], learning: { capability: 'forge.plan', outcome: 'plan_compiled', goal: contract.goal } };
      }
      case 'aura.reason': {
        const p = ticket.payload;
        const completion = await this.providers.chat({ providerId: p.providerId, model: p.model || undefined, messages: [{ role: 'system', content: 'You are Aura inside JACO. Produce a concise execution strategy grounded in the goal. Do not claim actions were executed.' }, { role: 'user', content: String(p.goal || ticket.title) }] });
        this.seerLive?.update?.({ provider: completion.providerId, model: completion.model, activeModule: 'Aura' });
        this.record('aura.provider.completed', `Aura completed strategy via ${completion.providerId}/${completion.model}`, true, completion);
        return { result: { strategy: completion.content, provider: completion.providerId, model: completion.model }, evidence: [{ type: 'provider_completion', requestHash: completion.requestHash, responseHash: completion.responseHash, provider: completion.providerId }], learning: { capability: 'aura.reason', provider: completion.providerId, latencyMs: completion.latencyMs } };
      }
      case 'wordpress.update': {
        const out = await this.wordpress.updatePage(ticket.payload);
        return { result: out, evidence: out.evidence, learning: { capability: 'wordpress.update', pageId: ticket.payload.pageId, renderStatus: out.publicRender.status } };
      }
      case 'wordpress.improve': {
        let objective = String(ticket.payload.objective || ticket.title);
        if (ticket.payload.strategyTicketId) {
          const strategy = this.bus.getTicket(ticket.payload.strategyTicketId)?.result?.strategy;
          if (strategy) objective = `${objective}\n\nSEER/Aura strategy:\n${strategy}`;
        }
        const out = await this.wordpress.improvePage({ pageId: ticket.payload.pageId, providerId: ticket.payload.providerId, model: ticket.payload.model || undefined, objective });
        this.record('wordpress.improve.verified', `WordPress page ${ticket.payload.pageId} updated and public render verified`, true, out.publicRender);
        return { result: { pageId: out.after.id, link: out.after.link, provider: out.provider.providerId, publicRender: out.publicRender, proposal: out.proposal }, evidence: [...out.evidence, { type: 'provider_completion', requestHash: out.provider.requestHash, responseHash: out.provider.responseHash }], learning: { capability: 'wordpress.improve', pageId: out.after.id, renderHash: out.publicRender.htmlHash } };
      }
      case 'a2a.discover': {
        const results = await discoverAgentCards(ticket.payload.urls || []);
        const verified = results.filter(r => r.ok);
        if (!verified.length) throw new Error('A2A_NO_VERIFIED_PEERS');
        return { result: { results }, evidence: verified.map(r => ({ type: 'a2a_agent_card', url: r.url, status: r.status, responseHash: r.responseHash })), learning: { capability: 'a2a.discover', verifiedPeers: verified.length, total: results.length } };
      }
      case 'a2a.outbound': {
        const out = await sendA2ATask(ticket.payload);
        return { result: out, evidence: [{ type: 'a2a_remote_receipt', endpoint: out.endpoint, status: out.status, requestHash: out.requestHash, responseHash: out.responseHash }], learning: { capability: 'a2a.outbound', latencyMs: out.latencyMs, endpoint: out.endpoint } };
      }
      case 'nova.hands_off': {
        if (!this.executeNovaAction) throw new Error('NOVA_EXECUTOR_UNAVAILABLE');
        const out = await this.executeNovaAction(ticket.payload);
        if (!out?.verified) throw new Error(out?.error || 'NOVA_RECEIPT_UNVERIFIED');
        this.record('nova.hands_off.verified', `Nova verified ${ticket.payload?.surface || 'surface'} action`, true, out.receipt || out);
        return { result: out, evidence: [{ type: 'nova_hands_off_receipt', hash: sha(out.receipt || out), surface: ticket.payload?.surface }], learning: { capability: 'nova.hands_off', surface: ticket.payload?.surface, verified: true } };
      }
      default: throw new Error(`UNSUPPORTED_CONNECTED_CAPABILITY:${ticket.capability}`);
    }
  }

  async runWorker(worker) {
    const claimed = this.bus.claimNext(worker.id, worker.capabilities, 45_000); if (!claimed) return null;
    const lease = claimed.leaseToken;
    try {
      this.bus.start(claimed.id, worker.id, lease);
      this.seerLive?.update?.({ phase: 'EXECUTING', activeModule: worker.metadata?.role || worker.id, action: { surface: 'NONE', type: claimed.capability, status: 'EXECUTING' } });
      this.record('mission.ticket.running', `${worker.id} executing ${claimed.capability}`, true, { missionId: claimed.missionId, ticketId: claimed.id });
      const output = await this.executeTicket(claimed);
      const completed = this.bus.complete(claimed.id, worker.id, lease, output);
      this.seerLive?.update?.({ phase: 'VERIFYING', activeModule: worker.metadata?.role || worker.id, action: { surface: 'NONE', type: claimed.capability, status: 'VERIFIED' }, latestVerifiedProgress: `${claimed.capability} DONE` });
      this.record('mission.ticket.done', `${claimed.capability} completed with ${output.evidence.length} evidence item(s)`, true, { missionId: claimed.missionId, ticketId: claimed.id });
      return completed;
    } catch (error) {
      try { this.bus.fail(claimed.id, worker.id, lease, error instanceof Error ? error.message : String(error)); } catch {}
      this.seerLive?.update?.({ phase: 'DEGRADED', activeModule: worker.metadata?.role || worker.id, blocker: error instanceof Error ? error.message : String(error), action: { surface: 'NONE', type: claimed.capability, status: 'REJECTED' } });
      this.record('mission.ticket.failed', `${claimed.capability}: ${error instanceof Error ? error.message : String(error)}`, false, { missionId: claimed.missionId, ticketId: claimed.id });
      return null;
    }
  }

  async tick() {
    this.bus.requeueExpiredLeases();
    const learning = this.bus.consumeLearningForSeer(50);
    if (learning.length) {
      this.seerLive?.record?.({ actor: 'SEER', type: 'seer.learning.consumed', message: `SEER consumed ${learning.length} learning delta(s)`, verified: true, receipt: learning });
      this.seerLive?.update?.({ latestVerifiedProgress: `Consumed ${learning.length} learning delta(s)` });
    }
    for (const worker of this.bus.listWorkers()) {
      this.bus.heartbeatWorker(worker.id);
      if (worker.status === 'IDLE') await this.runWorker(worker);
    }
    this.syncSeer();
    return this.snapshot();
  }

  start(intervalMs = 1200) {
    if (this.running) return;
    this.running = true;
    const run = () => this.tick().catch(error => this.record('mission.dispatch.error', error instanceof Error ? error.message : String(error), false));
    void run(); this.timer = setInterval(run, Math.max(500, Number(intervalMs) || 1200));
    this.record('mission.dispatch.started', `Durable Mission Bus dispatcher started at ${intervalMs}ms`, true);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.running = false; this.syncSeer(); }
}

export function mountConnectedRoutes(app, requireAuth, runtime) {
  mountNovaMissionRoutes(app, requireAuth, runtime.novaMissions, () => {
    const mission = runtime.novaMissions.current();
    runtime.seerLive?.update?.({ primaryGoal: mission?.goal || null,
      activeModule: 'Nova', blocker: mission?.status === 'BLOCKED' ? 'Nova mission requires outcome review' : null });
  });
  mountDeviceRoutes(app, requireAuth, runtime.novaMissions, runtime.devices);
  const ok = (res, data) => res.json({ success: true, ...data });
  const fail = (res, error, status = 400) => res.status(status).json({ success: false, error: error instanceof Error ? error.message : String(error) });

  app.get('/api/connected/status', requireAuth, (_req, res) => ok(res, { connected: runtime.snapshot() }));
  app.get('/api/connected/missions', requireAuth, (req, res) => ok(res, { missions: runtime.bus.listMissions(Number(req.query.limit || 100)) }));
  app.get('/api/connected/tickets', requireAuth, (req, res) => ok(res, { tickets: runtime.bus.listTickets({ status: req.query.status ? String(req.query.status) : null, missionId: req.query.missionId ? String(req.query.missionId) : null, limit: Number(req.query.limit || 200) }) }));
  app.get('/api/connected/events', requireAuth, (req, res) => ok(res, { events: runtime.bus.listEvents(Number(req.query.limit || 200)) }));
  app.post('/api/connected/goals', requireAuth, (req, res) => { try { ok(res, runtime.createGoal(req.body || {})); } catch (e) { fail(res, e); } });
  app.post('/api/connected/tick', requireAuth, async (_req, res) => { try { ok(res, { connected: await runtime.tick() }); } catch (e) { fail(res, e, 500); } });
  app.post('/api/connected/dispatcher/start', requireAuth, (req, res) => { runtime.start(Number(req.body?.intervalMs || 1200)); ok(res, { running: true }); });
  app.post('/api/connected/dispatcher/stop', requireAuth, (_req, res) => { runtime.stop(); ok(res, { running: false }); });

  app.get('/api/connected/providers', requireAuth, (_req, res) => ok(res, { providers: runtime.providers.list() }));
  app.post('/api/connected/providers', requireAuth, (req, res) => { try { ok(res, { provider: runtime.providers.register(req.body || {}) }); } catch (e) { fail(res, e); } });
  app.post('/api/connected/providers/:id/probe', requireAuth, async (req, res) => { try { const receipt = await runtime.providers.probe(req.params.id); res.status(receipt.ok ? 200 : 503).json({ success: receipt.ok, receipt }); } catch (e) { fail(res, e, 404); } });
  app.post('/api/connected/aura/chat', requireAuth, async (req, res) => {
    try {
      const completion = await runtime.providers.chat({ providerId: req.body?.providerId, model: req.body?.model, messages: Array.isArray(req.body?.messages) ? req.body.messages : [{ role: 'user', content: String(req.body?.message || '') }], temperature: req.body?.temperature });
      runtime.seerLive?.update?.({ activeModule: 'Aura', provider: completion.providerId, model: completion.model, phase: 'VERIFYING', latestVerifiedProgress: `Aura provider completion via ${completion.providerId}` });
      runtime.record('aura.provider.completed', `Aura provider completion via ${completion.providerId}/${completion.model}`, true, completion);
      ok(res, { completion });
    } catch (e) { fail(res, e, 503); }
  });

  app.get('/api/connected/wordpress/status', requireAuth, (_req, res) => ok(res, { wordpress: runtime.wordpress.config() }));
  app.get('/api/connected/wordpress/pages', requireAuth, async (req, res) => { try { ok(res, await runtime.wordpress.listPages({ search: req.query.search ? String(req.query.search) : '', perPage: Number(req.query.perPage || 20) })); } catch (e) { fail(res, e, 503); } });
  app.post('/api/connected/wordpress/update', requireAuth, async (req, res) => { try { ok(res, { result: await runtime.wordpress.updatePage(req.body || {}) }); } catch (e) { fail(res, e, 409); } });
  app.post('/api/connected/wordpress/improve', requireAuth, async (req, res) => { try { ok(res, { result: await runtime.wordpress.improvePage(req.body || {}) }); } catch (e) { fail(res, e, 409); } });

  app.post('/api/connected/a2a/discover', requireAuth, async (req, res) => { try { const results = await discoverAgentCards(req.body?.urls || []); ok(res, { results }); } catch (e) { fail(res, e, 502); } });
  app.post('/api/connected/a2a/outbound', requireAuth, async (req, res) => { try { ok(res, { receipt: await sendA2ATask(req.body || {}) }); } catch (e) { fail(res, e, 502); } });
}
