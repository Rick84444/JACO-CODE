import express from 'express';
import type { BrowserSessionManager } from '../browser/router.js';
import type { BrowserAction } from '../browser/browserHandsOff.js';
import type { DesktopHandsOffClient, DesktopAction } from '../desktop/desktopHandsOff.js';
import type { HandsOffClient, HandsOffAction } from '../android/handsOffClient.js';
import type { NovaTractionEngine } from '../nova/traction.js';
import { actuatorLeases, type ActuatorSurface } from '../handsOff/actuatorLease.js';
import { AutonomyMandateStore, type ConsequenceClass } from '../autonomy/autonomyMandate.js';

const RANK: Record<ConsequenceClass, number> = {
  READ: 0, LOCAL_MUTATION: 1, EXTERNAL_MUTATION: 2, PUBLISH: 3,
  FINANCIAL: 4, AUTH: 5, SECURITY: 6, DESTRUCTIVE: 7,
};

function maxConsequence(a: ConsequenceClass, b: ConsequenceClass): ConsequenceClass {
  return RANK[a] >= RANK[b] ? a : b;
}

function classify(surface: ActuatorSurface, action: any): ConsequenceClass {
  const raw = JSON.stringify(action || {}).toLowerCase();
  if (/(password|passcode|otp|one.?time|verification code|login|signin|oauth|authorize|bankid)/.test(raw)) return 'AUTH';
  if (/(checkout|payment|pay\b|purchase|buy\b|swish|stripe|paypal|invoice)/.test(raw)) return 'FINANCIAL';
  if (/(security|privilege|administrator|admin rights|firewall|defender|credential)/.test(raw)) return 'SECURITY';
  if (/(delete|destroy|drop\b|remove repository|wipe|erase|truncate)/.test(raw)) return 'DESTRUCTIVE';
  if (String(action?.type) === 'wordpress_apply_css' || /(publish|deploy|release|merge|send\b|post\b|submit)/.test(raw)) return 'PUBLISH';
  if (surface === 'BROWSER' && ['observe', 'survey', 'navigate', 'scroll'].includes(String(action?.type))) return 'READ';
  if (surface === 'ANDROID' && ['observe_screen', 'scroll', 'back', 'home', 'open_app'].includes(String(action?.type))) return 'READ';
  if (surface === 'DESKTOP' && ['observe', 'focus', 'scroll'].includes(String(action?.type))) return 'READ';
  return surface === 'BROWSER' ? 'EXTERNAL_MUTATION' : 'LOCAL_MUTATION';
}

export function createModelRelayRouter(input: {
  requireAuth: express.RequestHandler;
  workspaceRoot: string;
  browserSessions: BrowserSessionManager;
  desktop: DesktopHandsOffClient;
  android: HandsOffClient;
  nova: NovaTractionEngine;
  onEvent?: (event: { actor: string; type: string; message: string; verified: boolean; receipt?: unknown }) => void;
}): { router: express.Router; mandates: AutonomyMandateStore } {
  const router = express.Router();
  const mandates = new AutonomyMandateStore(input.workspaceRoot);
  const fail = (res: express.Response, status: number, error: unknown, extra: Record<string, unknown> = {}) =>
    res.status(status).json({ success: false, error: error instanceof Error ? error.message : String(error), ...extra });

  router.get('/status', input.requireAuth, (_req, res) => {
    res.json({
      success: true,
      protocol: 'JACO-SEMANTIC-RELAY/1',
      singleWriter: true,
      leases: actuatorLeases.snapshot(),
      activeMandates: mandates.list().filter((m) => mandates.isActive(m.id))
        .map((m) => ({ id: m.id, name: m.name, mission: m.mission, expiresAt: m.expiresAt })),
    });
  });

  router.get('/mandates', input.requireAuth, (_req, res) => res.json({ success: true, mandates: mandates.list() }));
  router.post('/mandates', input.requireAuth, (req, res) => {
    try { res.status(201).json({ success: true, mandate: mandates.create(req.body || {}) }); }
    catch (error) { fail(res, 400, error); }
  });
  router.post('/mandates/:id/sign', input.requireAuth, async (req, res) => {
    let signedId: string | null = null;
    try {
      const mandate = mandates.sign(req.params.id);
      signedId = mandate.id;
      const grants: Record<string, unknown> = {};
      const browser = input.browserSessions.getClient();
      if (browser) {
        grants.browser = browser.configureGrant({
          enabled: true,
          scope_mode: mandate.browserScope === 'BROAD_WEB' ? 'broad_web' : 'origins',
          allowed_origins: mandate.allowedOrigins,
          allow_click: true,
          allow_value_set: true,
          allow_navigate: true,
          allow_select: true,
          allow_scroll: true,
          contract_id: mandate.id,
          expires_at: mandate.expiresAt,
        });
      }
      if (mandate.allowedDesktopProcesses.length) {
        grants.desktop = input.desktop.configureGrant({
          enabled: true,
          allowed_processes: mandate.allowedDesktopProcesses,
          allow_invoke: true,
          allow_value_set: true,
          allow_toggle: true,
          allow_select: true,
          allow_scroll: true,
          expires_at: mandate.expiresAt,
        });
      }
      if (mandate.allowedAndroidPackages.length) {
        grants.android = await input.android.configureGrant({
          enabled: true,
          allowed_packages: mandate.allowedAndroidPackages,
          allow_typing: true,
          allow_gestures: true,
          allow_navigation: true,
          expires_at: mandate.expiresAt,
        });
      }
      input.onEvent?.({ actor: 'AutonomyContract', type: 'mandate.signed', message: `${mandate.name} signed until ${mandate.expiresAt}; eligible Hands-Off grants propagated`, verified: true, receipt: grants });
      res.json({ success: true, mandate, grants });
    } catch (error) {
      // Fail closed: a mandate that could not propagate its requested grants must not remain active.
      if (signedId) { try { mandates.revoke(signedId); } catch {} }
      fail(res, 400, error);
    }
  });
  router.post('/mandates/:id/revoke', input.requireAuth, async (req, res) => {
    try {
      const mandate = mandates.revoke(req.params.id);
      const revokedGrants: Record<string, unknown> = {};
      const browser = input.browserSessions.getClient();
      if (browser) revokedGrants.browser = browser.configureGrant({ enabled: false });
      revokedGrants.desktop = input.desktop.configureGrant({ enabled: false });
      if (mandate.allowedAndroidPackages.length) {
        try {
          revokedGrants.android = await input.android.configureGrant({
            enabled: false,
            allowed_packages: [],
            allow_typing: false,
            allow_gestures: false,
            allow_navigation: false,
            expires_at: new Date().toISOString(),
          });
        } catch (error) {
          revokedGrants.android = { revoked: false, error: error instanceof Error ? error.message : String(error) };
        }
      }
      for (const surface of ['BROWSER', 'DESKTOP', 'ANDROID'] as const) {
        const lease = actuatorLeases.get(surface);
        if (lease) actuatorLeases.release(surface, lease.holder);
      }
      input.onEvent?.({ actor: 'AutonomyContract', type: 'mandate.revoked', message: `${mandate.name} revoked; local grants and actuator leases cleared`, verified: true, receipt: revokedGrants });
      res.json({ success: true, mandate, revokedGrants });
    } catch (error) { fail(res, 400, error); }
  });

  router.post('/action', input.requireAuth, async (req, res) => {
    const surface = String(req.body?.surface || '').toUpperCase() as ActuatorSurface;
    if (!['BROWSER', 'DESKTOP', 'ANDROID'].includes(surface)) return fail(res, 400, 'surface must be BROWSER, DESKTOP or ANDROID');
    const modelId = String(req.body?.modelId || req.get('x-jaco-model-id') || '').trim().slice(0, 120);
    const missionId = String(req.body?.missionId || '').trim().slice(0, 200) || null;
    const mandateId = String(req.body?.mandateId || '').trim();
    const action = req.body?.action || {};
    if (!modelId) return fail(res, 400, 'modelId is required');
    if (!mandateId) return fail(res, 400, 'mandateId is required');

    const derived = classify(surface, action);
    const declared = String(req.body?.consequence || '').toUpperCase() as ConsequenceClass;
    const consequence = RANK[declared] === undefined ? derived : maxConsequence(derived, declared);
    const semanticPresent = surface === 'BROWSER' && Boolean((action as BrowserAction).postcondition);
    const policy = mandates.evaluate(mandateId, consequence, semanticPresent);
    if (!policy.allowed) {
      input.onEvent?.({ actor: 'ModelRelay', type: policy.requireReview ? 'relay.review.required' : 'relay.action.denied', message: `${modelId} ${surface} ${consequence}: ${policy.reason}`, verified: true });
      return fail(res, policy.requireReview ? 428 : 403, policy.reason, { consequence, policy });
    }

    // A signed mandate is the source of authority. Surface grants are derived
    // just-in-time so attaching Chrome after signing a mandate does not reintroduce
    // per-surface approval/microtasking.
    try {
      const mandate = policy.mandate!;
      if (surface === 'BROWSER') {
        const client = input.browserSessions.getClient();
        if (!client) return fail(res, 409, 'Browser Hands-Off is not attached');
        client.configureGrant({
          enabled: true,
          scope_mode: mandate.browserScope === 'BROAD_WEB' ? 'broad_web' : 'origins',
          allowed_origins: mandate.allowedOrigins,
          allow_click: true,
          allow_value_set: true,
          allow_navigate: true,
          allow_select: true,
          allow_scroll: true,
          contract_id: mandate.id,
          expires_at: mandate.expiresAt,
        });
      } else if (surface === 'DESKTOP' && mandate.allowedDesktopProcesses.length) {
        input.desktop.configureGrant({
          enabled: true,
          allowed_processes: mandate.allowedDesktopProcesses,
          allow_invoke: true,
          allow_value_set: true,
          allow_toggle: true,
          allow_select: true,
          allow_scroll: true,
          expires_at: mandate.expiresAt,
        });
      } else if (surface === 'ANDROID' && mandate.allowedAndroidPackages.length) {
        await input.android.configureGrant({
          enabled: true,
          allowed_packages: mandate.allowedAndroidPackages,
          allow_typing: true,
          allow_gestures: true,
          allow_navigation: true,
          expires_at: mandate.expiresAt,
        });
      }
    } catch (error) {
      return fail(res, 409, error, { consequence, policy: { ...policy, mandate: undefined } });
    }

    try { actuatorLeases.acquire(surface, modelId, missionId); }
    catch (error) { return fail(res, 423, error, { lease: actuatorLeases.get(surface) }); }

    const targetBearing = surface === 'BROWSER'
      ? ['click', 'set_value', 'select', 'check', 'wordpress_apply_css'].includes(String(action.type))
      : surface === 'DESKTOP'
        ? ['invoke', 'set_value', 'toggle', 'select', 'expand', 'collapse'].includes(String(action.type))
        : ['tap', 'type_text'].includes(String(action.type));
    if (targetBearing) {
      const traction = input.nova.beforeAction(String(action.type));
      if (traction.state !== 'VERIFYING') return fail(res, 409, 'Nova target lock is not verified', { traction });
    }

    input.onEvent?.({ actor: 'ModelRelay', type: 'relay.action.started', message: `${modelId} → ${surface} ${String(action.type)} [${consequence}]`, verified: true });
    try {
      let receipt: any;
      if (surface === 'BROWSER') {
        const client = input.browserSessions.getClient();
        if (!client) return fail(res, 409, 'Browser Hands-Off is not attached');
        receipt = await client.executeVerified(action as BrowserAction);
      } else if (surface === 'DESKTOP') {
        receipt = await input.desktop.executeVerified(action as DesktopAction);
      } else {
        receipt = await input.android.executeVerified(action as HandsOffAction);
      }

      const semanticVerified = surface === 'BROWSER' ? receipt?.verification?.level === 'SEMANTIC' : false;
      if (policy.requireSemanticVerification && !semanticVerified) {
        input.nova.markActionFailure('semantic postcondition was required but not verified');
        input.onEvent?.({ actor: 'ModelRelay', type: 'relay.action.unverified', message: `${surface} action executed but semantic verification failed`, verified: false, receipt });
        return res.status(409).json({ success: false, receipt, consequence, policy, error: 'semantic verification required by mandate' });
      }
      if (receipt?.verified) input.nova.observe({ expectedTransitionObserved: true, app: surface.toLowerCase() });
      else input.nova.markActionFailure(receipt?.refusal || receipt?.error || 'unverified state transition');
      input.onEvent?.({ actor: 'ModelRelay', type: receipt?.verified ? 'relay.action.verified' : 'relay.action.unverified', message: `${modelId} → ${surface} ${String(action.type)}: ${receipt?.verified ? 'VERIFIED' : 'UNVERIFIED'}`, verified: Boolean(receipt?.verified), receipt });
      return res.status(receipt?.refusal ? 403 : receipt?.verified ? 200 : 409).json({ success: Boolean(receipt?.verified), receipt, consequence, policy, traction: input.nova.getState(), lease: actuatorLeases.get(surface) });
    } catch (error) {
      input.nova.markActionFailure(error instanceof Error ? error.message : String(error));
      return fail(res, 500, error);
    }
  });

  return { router, mandates };
}
