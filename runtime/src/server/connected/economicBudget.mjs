import express from 'express';

// Operator UI adapter over the canonical governor, with no second policy store.
// Paid agent orders as recorded by agents/lib/agent-orders.mjs.
export function agentOrderRevenue(orders = {}) {
  const out = { usd: 0, paid: 0, needsOperator: 0 };
  for (const order of Object.values(orders)) {
    if (order?.status === 'PAID_NEEDS_OPERATOR') out.needsOperator += 1;
    const amount = order?.status === 'CHARGED' ? Number(order.amountCharged) : order?.status === 'PAID' ? Number(order.amountUsd) : NaN;
    if (Number.isFinite(amount) && amount > 0) { out.usd += amount; out.paid += 1; }
  }
  return out;
}

export function createEconomicBudgetRouter({ economic, requireOperatorUi, getBalances = async () => ({}), getStripeRevenue = async () => ({ configured: null }), getAgentOrders = () => ({}), listProviders = () => [], modelPrice = null, readPrices = () => null, syncPrices = async () => ({ ok: false }) }) {
  const router = express.Router();
  router.use(requireOperatorUi);
  router.use((req, res, next) => {
    const origin = req.get('origin');
    // A change to the budget comes from the interface, which a browser marks with its origin. Another local program sent
    // cloudEnabled=false with no origin, repeatedly, switching the operator's cloud models off mid-mission (2026-11-06/07).
    if (req.method !== 'GET' && !origin) return res.status(403).json({ success: false, error: 'BUDGET_CHANGE_REQUIRES_INTERFACE' });
    if (origin) {
      try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ success: false, error: 'BUDGET_CROSS_ORIGIN_DENIED' }); }
      catch { return res.status(403).json({ success: false, error: 'BUDGET_ORIGIN_INVALID' }); }
    }
    next();
  });
  router.get('/', (_req, res) => res.json({ success: true, economic: economic.snapshot() }));
  // Costs, income, balances and prices in one answer. A source that cannot be read says so and does not stop the others.
  router.get('/economy', async (_req, res) => {
    try {
      const costs = economic.economySnapshot();
      const [balances, stripe] = await Promise.all([
        Promise.resolve().then(getBalances).catch(() => ({})),
        Promise.resolve().then(getStripeRevenue).catch(error => ({ configured: null, error: String(error?.message || error) })),
      ]);
      const orders = agentOrderRevenue(getAgentOrders());
      const byCurrency = { ...(stripe.last30Days?.revenue || {}) };
      if (orders.usd + costs.revenueUsd > 0) byCurrency.USD = (byCurrency.USD || 0) + orders.usd + costs.revenueUsd;
      const currencies = Object.keys(byCurrency).filter(currency => byCurrency[currency] > 0);
      const stripeRead = stripe.configured === true && !stripe.error;
      const result = currencies.some(currency => currency !== 'USD') ? { last30DaysUsd: null, reason: 'Intäkter i annan valuta än USD räknas inte om.' }
        : { last30DaysUsd: (byCurrency.USD || 0) - costs.last30Days.usd, reason: stripeRead ? null : 'Utan Stripe, som inte kunde läsas.' };
      const seen = new Set();
      const inUse = [...listProviders().map(p => ({ provider: p.id, model: p.defaultModel || '', local: p.local === true })),
        ...costs.models.map(row => ({ provider: row.provider, model: row.model, local: false }))]
        .filter(row => { const key = `${row.provider}/${row.model}`; if (seen.has(key)) return false; seen.add(key); return true; })
        .map(row => {
          if (row.local) return { ...row, known: true };
          try { const rate = modelPrice(row.provider, row.model); return { ...row, known: true, input: rate.input, output: rate.output, source: rate.source, free: rate.free === true }; }
          catch { return { ...row, known: false }; }
        });
      const prices = readPrices();
      const { revenueUsd, ...costBooks } = costs;
      res.json({ success: true, economy: { observedAt: new Date().toISOString(), costs: costBooks, balances,
        revenue: { stripe, orders, verifiedUsd: revenueUsd, last30DaysByCurrency: byCurrency }, result,
        prices: { fetchedAt: prices?.fetchedAt || null, sources: prices?.sources || [], inUse } } });
    } catch (error) { res.status(500).json({ success: false, error: String(error?.message || error) }); }
  });
  router.post('/economy/sync-prices', async (_req, res) => {
    try { res.json({ success: true, sync: await syncPrices() }); }
    catch (error) { res.status(500).json({ success: false, error: String(error?.message || error) }); }
  });
  // Operator-imported project quotas, not an AI Studio live quota feed. Report source and
  // that only this JACO runtime's requests are counted in local rate windows.
  router.get('/gemini-quotas', (_req, res) =>
    res.json({ success: true, quota: economic.geminiQuotaSnapshot() }));
  router.patch('/gemini-quotas', (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).some(k => !['models','observedAt'].includes(k))) throw new Error('GEMINI_QUOTA_PATCH_INVALID');
      res.json({ success: true, quota: economic.updateGeminiQuotaProfile(body,'operator-ui') });
    } catch (error) { res.status(400).json({ success: false, error: String(error?.message || error) }); }
  });
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
      const keys = ['dailyCloudUsd', 'monthlyCloudUsd', 'maxCloudUsdPerTask', 'maxAutonomousCloudCallsPer15m', 'cloudEnabled'];
      if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length || Object.keys(body).some(k => !keys.includes(k))) throw new Error('BUDGET_FIELDS_INVALID');
      // Who changed it, in the runtime log: the ledger only says "operator-ui" for every caller, and the cloud switch
      // was seen turning itself off around restarts (2026-11-06).
      if ('cloudEnabled' in body) console.warn(`[budget] cloudEnabled=${body.cloudEnabled} requested by ${String(req.get?.('user-agent') || 'unknown').slice(0, 80)} referer=${String(req.get?.('referer') || '-').slice(0, 100)} fetch-site=${String(req.get?.('sec-fetch-site') || '-')}`);
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
