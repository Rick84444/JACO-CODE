import express from 'express';
import { DesktopHandsOffClient, type DesktopAction, type DesktopActionType } from './desktopHandsOff.js';
import { classify } from '../relay/modelRelay.js';
import { actuatorGrantExpiry, type AutonomyMandateStore } from '../autonomy/autonomyMandate.js';
import { DEFAULT_DESKTOP_PROCESSES } from './grantAtStart.mjs';
import { standingToolAuthority, operatorTaskEnabled } from '../../../../agents/lib/standing-tool-authority.mjs';

/**
 * Desktop hands-off surface.
 *
 * Mirrors the Android hands-off routes so the operator model is one model:
 * status, grant, observe, act, receipts. Every route is behind the runtime's
 * existing gateway-token handler — there is no second authority.
 */

const ACTION_TYPES: DesktopActionType[] = ['observe', 'focus', 'invoke', 'set_value', 'toggle', 'select', 'expand', 'collapse', 'scroll'];

export function createDesktopRouter(
  workspaceRoot: string,
  releaseRoot: string,
  requireMutationAuth: express.RequestHandler,
  onEvent?: (event: { actor: string; type: string; message: string; verified: boolean }) => void,
  canonicalClient?: DesktopHandsOffClient,
  standingMandates?: AutonomyMandateStore,
): express.Router {
  const router = express.Router();
  // Reuse ModelRelay's exact actuator instance. A second client would have a
  // separate in-flight lock and could dispatch UIA concurrently with Aura.
  const client = canonicalClient ?? new DesktopHandsOffClient(workspaceRoot, releaseRoot);

  const fail = (res: express.Response, status: number, error: unknown) =>
    res.status(status).json({ success: false, error: error instanceof Error ? error.message : String(error) });

  router.get('/status', requireMutationAuth, async (_req, res) => {
    try {
      res.json({ success: true, status: await client.status() });
    } catch (error) {
      fail(res, 503, error);
    }
  });

  router.get('/windows', requireMutationAuth, async (_req, res) => {
    const response = await client.listWindows();
    if (!response.ok) return fail(res, 503, response.error || 'bridge failed');
    res.json({ success: true, ...response.data });
  });

  router.post('/grant', requireMutationAuth, (req, res) => {
    try {
      const grant = client.configureGrant(req.body ?? {});
      onEvent?.({
        actor: 'DESKTOP',
        type: grant.enabled ? 'desktop.grant.enabled' : 'desktop.grant.revoked',
        message: grant.enabled
          ? `desktop grant for ${grant.allowed_processes.join(', ')} until ${grant.expires_at}`
          : 'desktop grant revoked',
        verified: true,
      });
      res.json({ success: true, grant });
    } catch (error) {
      fail(res, 400, error);
    }
  });

  router.post('/observe', requireMutationAuth, async (req, res) => {
    const hwnd = req.body?.hwnd !== undefined && req.body?.hwnd !== null ? Number(req.body.hwnd) : undefined;
    if (hwnd !== undefined && !Number.isFinite(hwnd)) return fail(res, 400, 'hwnd must be a number');
    const observation = await client.observe(hwnd);
    if (!observation) return fail(res, 503, 'observation unavailable');
    res.json({ success: true, observation });
  });

  router.post('/action', requireMutationAuth, async (req, res) => {
    const body = (req.body ?? {}) as Partial<DesktopAction>;
    const type = String(body.type || '') as DesktopActionType;
    if (!ACTION_TYPES.includes(type)) return fail(res, 400, `unsupported action type '${type}'`);
    const switchId = type === 'observe' ? 'desktop-observe'
      : type === 'invoke' ? 'desktop-invoke' : 'desktop-action';
    if (!operatorTaskEnabled(workspaceRoot, switchId))
      return fail(res, 403, 'TASK_TURNED_OFF_BY_OPERATOR:' + switchId);
    const consequence = classify('DESKTOP', body);
    const authority = standingToolAuthority(workspaceRoot, consequence);
    if (authority.status === 'DENY' || authority.status === 'REVIEW')
      return fail(res, authority.status === 'REVIEW' ? 428 : 403, 'DESKTOP_STANDING_MANDATE_' + authority.status);
    if (authority.allowed) {
      const current = standingMandates?.get('operator-level5-default');
      if (!standingMandates || !current) return fail(res, 503, 'DESKTOP_MANDATE_AUTHORITY_UNAVAILABLE');
      const decision = standingMandates.evaluate(current.id, consequence, false);
      if (!decision.allowed) return fail(res, decision.requireReview ? 428 : 403, decision.reason);
      // One renewable actuator lease, not a second operator permission.
      // Empty desktop scope inherits the existing safe program defaults;
      // explicit user selections replace those defaults.
      try {
        client.configureGrant({
          enabled: true,
          allowed_processes: current.allowedDesktopProcesses.length
            ? current.allowedDesktopProcesses : [...DEFAULT_DESKTOP_PROCESSES],
          allow_invoke: true, allow_value_set: true, allow_toggle: true,
          allow_select: true, allow_scroll: true,
          expires_at: actuatorGrantExpiry(current),
        });
      } catch (error) { return fail(res, 409, error); }
    }

    const receipt = await client.executeVerified({
      type,
      hwnd: body.hwnd !== undefined && body.hwnd !== null ? Number(body.hwnd) : undefined,
      selector: body.selector,
      text: body.text,
      amount: body.amount,
      wait_after_ms: body.wait_after_ms,
    });

    onEvent?.({
      actor: 'DESKTOP',
      type: receipt.verified ? 'desktop.action.verified' : 'desktop.action.rejected',
      message: `${type}: ${receipt.verified ? 'verified state transition' : receipt.refusal || receipt.error || 'no observed change'}`,
      verified: receipt.verified,
    });

    // A refusal is a policy outcome, not a server fault; an unverified action is
    // reported as a conflict so a caller cannot read it as success.
    const status = receipt.refusal ? 403 : receipt.verified ? 200 : 409;
    res.status(status).json({ success: receipt.verified, receipt });
  });

  router.get('/receipts', requireMutationAuth, (req, res) => {
    res.json({ success: true, receipts: client.listReceipts(Number(req.query.limit || 50)) });
  });

  return router;
}
