import React, { useEffect, useState } from 'react';
import { auraErrorMessage, readAuraResponse } from '../lib/auraApi.mjs';
import { useOptionalUiLanguage } from '../i18n/UiLanguage';
import { EconomicBudgetPanel } from './EconomicBudgetPanel';

// All costs and income in one place (GET /api/aura/budget/economy). Every figure comes from the runtime's books, a provider or
// a payment system; what cannot be read is shown as not read, never as zero.
type Period = { usd: number; calls: number };
type ModelRow = { key: string; provider: string; model: string; usd: number; calls: number; inputTokens: number; outputTokens: number; priceSource: string | null };
type Price = { provider: string; model: string; local: boolean; known: boolean; input?: number; output?: number; source?: string; free?: boolean };
type Economy = {
  observedAt: string;
  costs: { today: Period; month: Period; last30Days: Period; lastHourUsd: number; legacyEstimateUsd: number; models: ModelRow[]; byProvider: Record<string, Period>; pending: { count: number; usd: number }; unknown: { count: number; usd: number } };
  balances: Record<string, { ok: boolean; usd?: number; currency?: string; available?: boolean; error?: string; checkedAt?: string }>;
  revenue: {
    stripe: { configured: boolean | null; mode?: string; error?: string; fetchedAt?: string; last30Days?: { paidCharges: number; revenue: Record<string, number>; complete: boolean }; balance?: { available: Record<string, number>; pending: Record<string, number> }; recentCharges?: Array<{ id: string; amount: number; currency: string; status: string; paid: boolean; refunded: boolean; description: string | null; created: string }> };
    orders: { usd: number; paid: number; needsOperator: number };
    verifiedUsd: number;
    last30DaysByCurrency: Record<string, number>;
  };
  result: { last30DaysUsd: number | null; reason: string | null };
  prices: { fetchedAt: string | null; sources: Array<{ id: string; ok: boolean; count?: number; error?: string }>; inUse: Price[] };
};
type Tr = (swedish: string, english: string) => string;

const SOURCE_LABEL: Record<string, [string, string]> = {
  litellm: ['LiteLLM', 'LiteLLM'], openrouter: ['OpenRouter', 'OpenRouter'], configured: ['Eget pris', 'Own price'], 'operator-default': ['Eget standardpris', 'Own default price'],
  'provider-highest': ['Leverantörens högsta pris (modellen saknas i listorna)', "Provider's highest price (model not in the lists)"],
  'catalog-median': ['Uppskattat: marknadens medianpris (leverantören saknas i listorna)', 'Estimated: market median price (provider not in the lists)'],
  free: ['Gratis', 'Free'], reference: ['Gammalt referenspris', 'Old reference price'],
};
const formatters = (tr: Tr, locale: string) => ({
  usd: (n: number | null | undefined) => n == null ? tr('Ej observerat', 'Not observed') : `${n.toLocaleString(locale, { maximumFractionDigits: n !== 0 && Math.abs(n) < 1 ? 4 : 2 })} USD`,
  amounts: (values?: Record<string, number>) => { const rows = Object.entries(values || {}); return rows.length ? rows.map(([currency, n]) => `${n.toLocaleString(locale, { maximumFractionDigits: 2 })} ${currency}`).join(' + ') : '0'; },
  count: (n: number) => n.toLocaleString(locale),
  time: (iso?: string | null) => iso ? new Date(iso).toLocaleString(locale) : tr('aldrig', 'never'),
  sourceLabel: (s?: string | null) => (s && SOURCE_LABEL[s] ? tr(...SOURCE_LABEL[s]) : s) || tr('Okänt', 'Unknown'),
});

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <section className="rounded-xl border border-[#505153] bg-[#242527] p-4">
    <h3 className="text-sm font-semibold text-neutral-100">{title}</h3>
    {hint && <p className="mt-1 text-xs text-neutral-300">{hint}</p>}
    <div className="mt-3">{children}</div>
  </section>
);
const Tile: React.FC<{ label: string; value: string; detail?: string; tone?: 'good' | 'bad' }> = ({ label, value, detail, tone }) => (
  <div className="rounded-lg border border-[#505153] bg-[#303133] p-3">
    <div className="text-xs text-neutral-300">{label}</div>
    <div className={'mt-1 text-lg font-semibold ' + (tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-amber-300' : 'text-neutral-100')}>{value}</div>
    {detail && <div className="mt-1 text-[11px] text-neutral-400">{detail}</div>}
  </div>
);
const cell = 'px-2 py-1.5 text-left align-top';
const button = 'rounded-md border border-[#616264] px-3 py-2 text-neutral-200 hover:bg-[#343537] disabled:opacity-50';

export const EconomyView: React.FC = () => {
  const { tr, language } = useOptionalUiLanguage();
  const { usd, amounts, count, time, sourceLabel } = formatters(tr, language === 'sv' ? 'sv-SE' : 'en-US');
  const [data, setData] = useState<Economy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const load = async () => {
    try { const next = await fetch('/api/aura/budget/economy', { cache: 'no-store', signal: AbortSignal.timeout(30_000) }).then(readAuraResponse); setData(next.economy); setError(null); }
    catch (cause: any) { setError(auraErrorMessage(cause?.message)); }
  };
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 30_000); return () => window.clearInterval(timer); }, []);
  const syncPrices = async () => {
    setBusy(true); setNotice(null);
    try {
      const result = await fetch('/api/aura/budget/economy/sync-prices', { method: 'POST', signal: AbortSignal.timeout(90_000) }).then(readAuraResponse);
      setNotice(result.sync?.ok
        ? tr(`Priser hämtade: ${count(result.sync.count)} modeller.`, `Prices fetched: ${count(result.sync.count)} models.`)
        : tr('Inga priser kunde hämtas. De senast kända gäller.', 'No prices could be fetched. The last known prices apply.'));
      await load();
    } catch (cause: any) { setNotice(`${tr('Kunde inte hämta priser', 'Could not fetch prices')}: ${auraErrorMessage(cause?.message)}`); }
    finally { setBusy(false); }
  };

  const stripe = data?.revenue.stripe;
  const failedSources = data?.prices.sources.filter(s => !s.ok) || [];
  return (
    <div className="space-y-4 overflow-auto p-4 text-xs text-neutral-300" data-testid="economy-view">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-neutral-100">{tr('Ekonomi', 'Economy')}</h2>
          <p className="text-neutral-400">{data ? `${tr('Uppdaterad', 'Updated')} ${time(data.observedAt)}` : tr('Hämtar…', 'Fetching…')}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={button} onClick={() => void load()}>{tr('Uppdatera', 'Refresh')}</button>
          <button type="button" disabled={busy} className={button} onClick={() => void syncPrices()}>{busy ? tr('Hämtar priser…', 'Fetching prices…') : tr('Hämta aktuella priser', 'Fetch current prices')}</button>
        </div>
      </header>
      {error && <div role="alert" className="rounded-md border border-red-900 bg-red-950/30 px-3 py-2 text-red-200">{tr('Ekonomin kunde inte läsas', 'The economy could not be read')}: {error}</div>}
      {notice && <div role="status" className="rounded-md border border-[#505153] px-3 py-2 text-neutral-200">{notice}</div>}
      {data && <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile label={tr('Intäkter, 30 dagar', 'Revenue, 30 days')} value={stripe?.configured === false && !Object.keys(data.revenue.last30DaysByCurrency).length ? tr('Inte kopplat', 'Not connected') : amounts(data.revenue.last30DaysByCurrency)} detail={stripe?.configured === false ? tr('Stripe saknar nyckel', 'Stripe has no key') : undefined}/>
          <Tile label={tr('Kostnader, 30 dagar', 'Costs, 30 days')} value={usd(data.costs.last30Days.usd)} detail={`${count(data.costs.last30Days.calls)} ${tr('modellanrop', 'model calls')}`}/>
          <Tile label={tr('Resultat, 30 dagar', 'Result, 30 days')} value={usd(data.result.last30DaysUsd)} detail={data.result.reason || undefined} tone={data.result.last30DaysUsd == null ? undefined : data.result.last30DaysUsd >= 0 ? 'good' : 'bad'}/>
          <Tile label={tr('Kostnad idag', 'Cost today')} value={usd(data.costs.today.usd)} detail={`${tr('Senaste timmen', 'Last hour')} ${usd(data.costs.lastHourUsd)}`}/>
        </div>

        <Section title={tr('Kostnader', 'Costs')} hint={tr('Tokens från leverantörens svar gånger priset när anropet gjordes. Inte verifierat mot leverantörens faktura.', "Tokens from the provider's response times the price when the call was made. Not verified against the provider's invoice.")}>
          <div className="overflow-x-auto"><table className="w-full min-w-[560px]">
            <thead className="text-neutral-400"><tr><th className={cell}>{tr('Modell', 'Model')}</th><th className={cell}>{tr('Anrop', 'Calls')}</th><th className={cell}>{tr('Tokens in / ut', 'Tokens in / out')}</th><th className={cell}>{tr('Kostnad', 'Cost')}</th><th className={cell}>{tr('Pris från', 'Price from')}</th></tr></thead>
            <tbody>
              {data.costs.models.map(row => <tr key={row.key} className="border-t border-[#3d3e40]">
                <td className={cell}><span className="text-neutral-300">{row.provider}</span> {row.model}</td><td className={cell}>{count(row.calls)}</td>
                <td className={cell}>{count(row.inputTokens)} / {count(row.outputTokens)}</td><td className={cell}>{usd(row.usd)}</td><td className={cell}>{sourceLabel(row.priceSource)}</td>
              </tr>)}
              {!data.costs.models.length && <tr><td className={cell + ' text-neutral-400'} colSpan={5}>{tr('Inga modellanrop bokförda per modell den här månaden.', 'No model calls booked per model this month.')}</td></tr>}
            </tbody>
          </table></div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div>{tr('Den här månaden', 'This month')}: <strong className="text-neutral-100">{usd(data.costs.month.usd)}</strong> ({count(data.costs.month.calls)} {tr('anrop', 'calls')})</div>
            {data.costs.pending.count > 0 && <div>{tr('Pågående', 'In progress')}: {count(data.costs.pending.count)} {tr('anrop, reserverat', 'calls, reserved')} {usd(data.costs.pending.usd)}</div>}
            {data.costs.unknown.count > 0 && <div className="text-amber-300">{tr('Okänt utfall', 'Unknown outcome')}: {count(data.costs.unknown.count)} {tr('anrop, upp till', 'calls, up to')} {usd(data.costs.unknown.usd)}</div>}
            {data.costs.legacyEstimateUsd > 0 && <div className="text-amber-300">{usd(data.costs.legacyEstimateUsd)} {tr('av månaden räknades med ett gammalt fast referenspris och är troligen för högt. Det kan inte räknas om, eftersom tokens per anrop inte sparades.', 'of the month was counted with an old fixed reference price and is probably too high. It cannot be recalculated, because tokens per call were not saved.')}</div>}
          </div>
        </Section>

        <Section title={tr('Intäkter', 'Revenue')}>
          {stripe?.configured === false && <p className="text-amber-300">{tr('Stripe är inte kopplat. Lägg in STRIPE_SECRET_KEY under Anslutningar → API & Vault, så visas betalningarna här.', 'Stripe is not connected. Add STRIPE_SECRET_KEY under Connections → API & Vault and the payments appear here.')}</p>}
          {stripe?.error && <p className="text-red-300">{tr('Stripe kunde inte läsas', 'Stripe could not be read')}: {auraErrorMessage(stripe.error)}</p>}
          {stripe?.configured && !stripe.error && <div className="space-y-2">
            <div>Stripe ({stripe.mode}), {tr('30 dagar', '30 days')}: <strong className="text-neutral-100">{amounts(stripe.last30Days?.revenue)}</strong> {tr('från', 'from')} {stripe.last30Days?.paidCharges ?? '?'} {tr('betalningar', 'payments')}{stripe.last30Days && !stripe.last30Days.complete ? tr(' (bara de 500 första)', ' (first 500 only)') : ''}</div>
            <div>{tr('Saldo hos Stripe', 'Stripe balance')}: {amounts(stripe.balance?.available)} {tr('tillgängligt', 'available')}, {amounts(stripe.balance?.pending)} {tr('på väg', 'pending')}</div>
            {(stripe.recentCharges || []).slice(0, 10).map(charge => <div key={charge.id} className="flex gap-2 text-neutral-300">
              <span className="shrink-0">{charge.created.slice(0, 10)}</span><span className={charge.paid && !charge.refunded ? 'shrink-0 text-emerald-300' : 'shrink-0 text-amber-300'}>{charge.amount.toFixed(2)} {charge.currency}</span>
              <span className="truncate">{charge.refunded ? tr('återbetald', 'refunded') : charge.status}{charge.description ? ` · ${charge.description}` : ''}</span>
            </div>)}
          </div>}
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            <div>{tr('Agentordrar', 'Agent orders')} (Skyfire, x402): <strong className="text-neutral-100">{usd(data.revenue.orders.usd)}</strong> {tr('från', 'from')} {count(data.revenue.orders.paid)} {tr('ordrar', 'orders')}</div>
            <div>{tr('Verifierade intäkter från uppdrag', 'Verified revenue from missions')}: <strong className="text-neutral-100">{usd(data.revenue.verifiedUsd)}</strong></div>
            {data.revenue.orders.needsOperator > 0 && <div className="text-amber-300">{count(data.revenue.orders.needsOperator)} {tr('betalda ordrar väntar på dig.', 'paid orders are waiting for you.')}</div>}
          </div>
        </Section>

        <Section title={tr('Saldo hos leverantörer', 'Provider balances')} hint={tr('Leverantörer utan saldotjänst visas inte.', 'Providers without a balance service are not shown.')}>
          {(Object.entries(data.balances) as [string, Economy['balances'][string]][]).map(([name, balance]) => <div key={name} className="flex flex-wrap gap-2">
            <span className="font-medium text-neutral-200">{name}</span>
            {balance.ok ? <span className={balance.available === false || balance.usd === 0 ? 'text-amber-300' : ''}>{balance.usd?.toLocaleString(language === 'sv' ? 'sv-SE' : 'en-US', { maximumFractionDigits: 2 })} {balance.currency}{balance.available === false ? tr(' · saldot räcker inte', ' · balance is not enough') : ''}</span> : <span className="text-amber-300">{tr('Kunde inte läsas', 'Could not be read')} ({balance.error})</span>}
          </div>)}
          {!Object.keys(data.balances).length && <p className="text-neutral-400">{tr('Inga saldon att visa.', 'No balances to show.')}</p>}
        </Section>

        <Section title={tr('Aktuella priser', 'Current prices')} hint={tr(`USD per miljon tokens. Hämtas automatiskt var 6:e timme. Senast: ${time(data.prices.fetchedAt)}.`, `USD per million tokens. Fetched automatically every 6 hours. Last: ${time(data.prices.fetchedAt)}.`)}>
          {!data.prices.fetchedAt && <p className="mb-2 text-amber-300">{tr('Priser har inte kunnat hämtas ännu. Modeller utan pris kan inte användas förrän det är gjort.', 'Prices have not been fetched yet. Models without a price cannot be used until they are.')}</p>}
          {failedSources.map(source => <p key={source.id} className="mb-2 text-amber-300">{sourceLabel(source.id)} {tr('gick inte att nå', 'could not be reached')} ({source.error}). {tr('Dess senast kända priser gäller.', 'Its last known prices apply.')}</p>)}
          <div className="overflow-x-auto"><table className="w-full min-w-[480px]">
            <thead className="text-neutral-400"><tr><th className={cell}>{tr('Modell', 'Model')}</th><th className={cell}>{tr('In', 'In')}</th><th className={cell}>{tr('Ut', 'Out')}</th><th className={cell}>{tr('Källa', 'Source')}</th></tr></thead>
            <tbody>{data.prices.inUse.map(price => <tr key={`${price.provider}/${price.model}`} className="border-t border-[#3d3e40]">
              <td className={cell}><span className="text-neutral-300">{price.provider}</span> {price.model || '—'}</td>
              {price.local ? <><td className={cell} colSpan={2}>{tr('Körs lokalt, ingen tokenkostnad', 'Runs locally, no token cost')}</td><td className={cell}>—</td></>
                : price.known ? <><td className={cell}>{price.input}</td><td className={cell}>{price.output}</td><td className={cell}>{sourceLabel(price.source)}</td></>
                : <td className={cell + ' text-amber-300'} colSpan={3}>{tr('Pris saknas: modellen kan inte användas', 'No price: the model cannot be used')}</td>}
            </tr>)}</tbody>
          </table></div>
        </Section>

        <Section title={tr('Budget och tak', 'Budget and caps')}><EconomicBudgetPanel inline/></Section>
      </>}
    </div>
  );
};
