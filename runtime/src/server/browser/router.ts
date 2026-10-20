import express from 'express';
import { BrowserHandsOffClient, CdpBridge, type BrowserAction, type BrowserActionType, type BrowserGrant } from './browserHandsOff.js';
import { actuatorLeases } from '../handsOff/actuatorLease.js';

const ACTION_TYPES: BrowserActionType[] = ['observe', 'survey', 'navigate', 'click', 'set_value', 'select', 'check', 'scroll', 'wordpress_apply_css'];
const MUTATING = new Set<BrowserActionType>(['navigate', 'click', 'set_value', 'select', 'check', 'scroll', 'wordpress_apply_css']);

export interface BrowserSessionSnapshot {
  attached: boolean;
  cdpPort: number;
  urlIncludes: string | null;
  attachedAt: string | null;
  targetId?: string;
}

export class BrowserSessionManager {
  private bridge: CdpBridge | null = null;
  private client: BrowserHandsOffClient | null = null;
  private cdpPort = Number(process.env.NOVA_CDP_PORT || 9222);
  private urlIncludes: string | null = null;
  private attachedAt: string | null = null;

  constructor(private readonly workspaceRoot: string) {}

  snapshot(): BrowserSessionSnapshot {
    return { attached: Boolean(this.client), cdpPort: this.cdpPort, urlIncludes: this.urlIncludes, attachedAt: this.attachedAt, ...(this.bridge?.targetId?{targetId:this.bridge.targetId}:{}) };
  }

  getClient(): BrowserHandsOffClient | null { return this.client; }

  async targets(port = this.cdpPort) { return CdpBridge.listTargets(port); }

  async attach(input: { port?: number; urlIncludes: string; targetId?: string }): Promise<BrowserSessionSnapshot> {
    await this.detach();
    const port = Number(input.port || process.env.NOVA_CDP_PORT || 9222);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid CDP port');
    const urlIncludes = String(input.urlIncludes || '').trim();
    if (!urlIncludes || urlIncludes.length > 300) throw new Error('urlIncludes must be 1-300 characters');
    const targetId = input.targetId;
    if(targetId!==undefined && (typeof targetId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(targetId)))throw new Error('CDP_TARGET_ID_INVALID');
    this.bridge = await CdpBridge.attach(port, urlIncludes, targetId);
    this.client = new BrowserHandsOffClient(this.workspaceRoot, this.bridge);
    this.cdpPort = port;
    this.urlIncludes = urlIncludes;
    this.attachedAt = new Date().toISOString();
    return this.snapshot();
  }

  async detach(): Promise<void> {
    try { await this.bridge?.close(); } catch {}
    this.bridge = null;
    this.client = null;
    this.urlIncludes = null;
    this.attachedAt = null;
  }
}

export function createBrowserRouter(
  workspaceRoot: string,
  requireAuth: express.RequestHandler,
  onEvent?: (event: { actor: string; type: string; message: string; verified: boolean; receipt?: unknown }) => void,
): { router: express.Router; sessions: BrowserSessionManager } {
  const router = express.Router();
  const sessions = new BrowserSessionManager(workspaceRoot);
  const fail = (res: express.Response, status: number, error: unknown) =>
    res.status(status).json({ success: false, error: error instanceof Error ? error.message : String(error) });

  router.get('/targets', requireAuth, async (req, res) => {
    try {
      const port = Number(req.query.port || process.env.NOVA_CDP_PORT || 9222);
      const targets = await sessions.targets(port);
      res.json({ success: true, port, targets: targets.map(({ webSocketDebuggerUrl: _secretSocket, ...safe }) => safe) });
    } catch (error) { fail(res, 503, error); }
  });

  router.post('/attach', requireAuth, async (req, res) => {
    try {
      const session = await sessions.attach({ port: req.body?.port, urlIncludes: req.body?.urlIncludes, targetId:req.body?.targetId });
      onEvent?.({ actor: 'BrowserHandsOff', type: 'browser.attached', message: `CDP attached to '${session.urlIncludes}' on :${session.cdpPort}`, verified: true, receipt: session });
      res.json({ success: true, session });
    } catch (error) { fail(res, 409, error); }
  });

  router.post('/detach', requireAuth, async (_req, res) => {
    await sessions.detach();
    onEvent?.({ actor: 'BrowserHandsOff', type: 'browser.detached', message: 'Browser CDP session detached', verified: true });
    res.json({ success: true });
  });

  router.get('/status', requireAuth, async (_req, res) => {
    const client = sessions.getClient();
    if (!client) return res.json({ success: true, session: sessions.snapshot(), status: { reachable: false, evidenceState: 'UNAVAILABLE' } });
    try { res.json({ success: true, session: sessions.snapshot(), status: await client.status() }); }
    catch (error) { fail(res, 503, error); }
  });

  router.post('/grant', requireAuth, (req, res) => {
    const client = sessions.getClient();
    if (!client) return fail(res, 409, 'attach to a browser tab first');
    try {
      const grant = client.configureGrant((req.body || {}) as Partial<BrowserGrant>);
      onEvent?.({ actor: 'BrowserHandsOff', type: grant.enabled ? 'browser.grant.enabled' : 'browser.grant.revoked', message: grant.enabled ? `browser ${grant.scope_mode} grant until ${grant.expires_at}` : 'browser grant revoked', verified: true });
      res.json({ success: true, grant });
    } catch (error) { fail(res, 400, error); }
  });

  router.post('/observe', requireAuth, async (_req, res) => {
    const client = sessions.getClient();
    if (!client) return fail(res, 409, 'attach to a browser tab first');
    const observation = await client.observe();
    if (!observation) return fail(res, 503, 'observation unavailable');
    res.json({ success: true, observation });
  });

  router.post('/survey', requireAuth, async (req, res) => {
    const client = sessions.getClient();
    if (!client) return fail(res, 409, 'attach to a browser tab first');
    try {
      const survey = await client.survey(req.body?.label ? String(req.body.label) : undefined);
      if (!survey) return fail(res, 503, 'survey unavailable');
      onEvent?.({ actor: 'BrowserHandsOff', type: 'browser.survey.completed', message: `Browser survey ${survey.recognised ? 'reused known state' : 'mapped new state'}`, verified: true, receipt: survey });
      res.json({ success: true, survey });
    } catch (error) { fail(res, 503, error); }
  });

  router.post('/action', requireAuth, async (req, res) => {
    const client = sessions.getClient();
    if (!client) return fail(res, 409, 'attach to a browser tab first');
    const body = (req.body || {}) as Partial<BrowserAction> & { modelId?: string; missionId?: string };
    const type = String(body.type || '') as BrowserActionType;
    if (!ACTION_TYPES.includes(type)) return fail(res, 400, `unsupported action type '${type}'`);
    const holder = String(req.get('x-jaco-model-id') || body.modelId || 'operator').slice(0, 120);
    if (MUTATING.has(type)) {
      try { actuatorLeases.acquire('BROWSER', holder, body.missionId ? String(body.missionId) : null); }
      catch (error) { return fail(res, 423, error); }
    }
    const receipt = await client.executeVerified({
      type, selector: body.selector, text: body.text, url: body.url, checked: body.checked,
      deltaY: body.deltaY, wait_after_ms: body.wait_after_ms, postcondition: body.postcondition,
    });
    onEvent?.({ actor: 'BrowserHandsOff', type: receipt.verified ? 'browser.action.verified' : 'browser.action.unverified', message: `${type}: ${receipt.verification.level}`, verified: receipt.verified, receipt });
    const status = receipt.refusal ? 403 : receipt.verified ? 200 : 409;
    res.status(status).json({ success: receipt.verified, receipt, lease: actuatorLeases.get('BROWSER') });
  });

  router.get('/routes', requireAuth, (req, res) => {
    const client = sessions.getClient();
    if (!client) return fail(res, 409, 'attach to a browser tab first');
    res.json({ success: true, stats: client.libraryStats(), routes: client.recallRoute({ processName: req.query.processName ? String(req.query.processName) : undefined, name: req.query.name ? String(req.query.name) : undefined, automationId: req.query.automationId ? String(req.query.automationId) : undefined }) });
  });

  router.get('/receipts', requireAuth, (req, res) => {
    const client = sessions.getClient();
    if (!client) return fail(res, 409, 'attach to a browser tab first');
    res.json({ success: true, receipts: client.listReceipts(Number(req.query.limit || 50)), stats: client.libraryStats() });
  });

  return { router, sessions };
}
