import express from 'express';
import { loadApprovalPolicy, setOperatorApprovalLevel } from '../../../../agents/lib/approval-policy.mjs';

// A dedicated operator-only surface. Agents can read the effective level via
// policy_status, but cannot change this override without operator UI authority.
export function createAuraAutonomyRouter({ requireOperatorUi, policyFile, env = process.env }) {
  const router = express.Router();
  router.use(requireOperatorUi);
  router.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin) {
      try {
        if (new URL(origin).host !== req.get('host')) {
          return res.status(403).json({ success: false, error: 'AUTONOMY_CROSS_ORIGIN_DENIED' });
        }
      } catch {
        return res.status(403).json({ success: false, error: 'AUTONOMY_ORIGIN_INVALID' });
      }
    }
    next();
  });
  router.get('/', (_req, res) => {
    res.json({ success: true, policy: loadApprovalPolicy({ env, file: policyFile }) });
  });
  router.patch('/', (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).length !== 1 || !Object.hasOwn(body, 'level') ||
        !Number.isInteger(body.level) || body.level < 0 || body.level > 5) {
      return res.status(400).json({ success: false, error: 'AUTONOMY_LEVEL_INVALID' });
    }
    try {
      const policy = setOperatorApprovalLevel(body.level, { env, file: policyFile });
      res.json({ success: true, policy });
    } catch (error) {
      res.status(400).json({ success: false, error: String(error?.message || error) });
    }
  });
  return router;
}
