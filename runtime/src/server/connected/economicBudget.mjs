import express from 'express';

// Operator UI adapter over the canonical governor, with no second policy store.
export function createEconomicBudgetRouter({ economic, requireOperatorUi, getBalances = async () => ({}) }) {
  const router = express.Router();
  router.use(requireOperatorUi);
  router.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin) {
      try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ success: false, error: 'BUDGET_CROSS_ORIGIN_DENIED' }); }
      catch { return res.status(403).json({ success: false, error: 'BUDGET_ORIGIN_INVALID' }); }
    }
    next();
  });
  router.get('/', (_req, res) => res.json({ success: true, economic: economic.snapshot() }));
  // Live cost for the IDE: settled spend (measured), what is still unconfirmed, and the real prepaid balance.
  router.get('/live', async (_req, res) => {
    try {
      const live = economic.liveSnapshot();
      const balances = await getBalances().catch(() => ({}));
      const deepseek = balances.deepseek;
      const runwayMinutes = deepseek?.ok && live.lastHourUsd > 0.005 ? Math.round((deepseek.usd / live.lastHourUsd) * 60) : null;
      res.json({ success: true, live, balances, runwayMinutes });
    } catch (error) { res.status(500).json({ success: false, error: String(error?.message || error) }); }
  });
  router.patch('/', (req, res) => {
    try {
      const body = req.body;
      // cloudEnabled is the one switch for cloud models (Aura chat and Nova alike). Each cap is a number, or null for no cap.
      const keys = ['dailyCloudUsd', 'monthlyCloudUsd', 'maxCloudUsdPerTask', 'cloudEnabled'];
      if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length || Object.keys(body).some(k => !keys.includes(k))) throw new Error('BUDGET_FIELDS_INVALID');
      const economicState = economic.updatePolicy(body, 'operator-ui');
      res.json({ success: true, economic: economicState });
    } catch (error) { res.status(400).json({ success: false, error: error.message }); }
  });
  // Resets the daily/monthly counters to the measured spend (settled provider usage).
  router.post('/recalibrate', (_req, res) => {
    try { res.json({ success: true, ...economic.recalibrateToMeasured('operator-ui') }); }
    catch (error) { res.status(400).json({ success: false, error: error.message }); }
  });
  router.post('/release-unknown', (_req, res) => {
    try { res.json({ success: true, ...economic.releaseUnknownReservations('operator-ui') }); }
    catch (error) { res.status(400).json({ success: false, error: error.message }); }
  });
  return router;
}
