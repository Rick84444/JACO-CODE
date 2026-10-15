import { auraErrorMessage, observedMoney as money } from '../lib/auraApi.mjs';
import React, { useEffect, useState } from 'react';

// Revenue view (GET /api/revenue/stripe): Stripe figures as fetched, nothing estimated. An API error is
// shown as an error, never as zero revenue.
interface RevenueSnapshot {
  success: boolean;
  configured: boolean | null;
  mode: string;
  fetchedAt: string;
  error?: string;
  account?: { country: string | null; chargesEnabled: boolean; payoutsEnabled: boolean };
  balance?: { available: Record<string, number>; pending: Record<string, number> };
  last30Days?: { paidCharges: number; revenue: Record<string, number>; checkoutSessionsCreated: number; checkoutSessionsPaid: number; complete: boolean };
  recentCharges?: Array<{ id: string; amount: number; currency: string; status: string; paid: boolean; refunded: boolean; description: string | null; created: string }>;
}

export const RevenueView: React.FC = () => {
  const [data, setData] = useState<RevenueSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const load = async (refresh = false) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/revenue/stripe${refresh ? '?refresh=1' : ''}`);
      const next = await res.json();
      if (!res.ok || !next || typeof next !== 'object') throw new Error(auraErrorMessage(next?.error, `HTTP_${res.status}`));
      setData({ ...next, error: next.error ? auraErrorMessage(next.error) : next.success === false && next.configured ? 'STRIPE_OBSERVATION_UNAVAILABLE' : undefined });
    } catch (error: any) {
      setData(current => ({ ...(current || { configured: null, mode: 'unknown', fetchedAt: '' }), success: false, error: String(error?.message || error) }));
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); const t = window.setInterval(() => void load(), 60_000); return () => window.clearInterval(t); }, []);

  const d30 = data?.last30Days;
  return (
    <>
      <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-400 flex items-center justify-between">
        <span>Revenue · Stripe</span>
        <button onClick={() => void load(true)} disabled={loading} className="text-[9px] text-cyan-400 hover:text-cyan-300 disabled:opacity-40">{loading ? 'Fetching…' : 'Refresh'}</button>
      </div>
      <div className="flex-1 overflow-auto px-2 space-y-2 text-[11px]">
        {!data && <div className="text-slate-500 px-1">Fetching from Stripe…</div>}
        {data && data.configured === false && <div className="border border-amber-900 text-amber-300 rounded p-2">Stripe är inte konfigurerat för denna installation.</div>}
        {data?.error && <div className="border border-red-900 text-red-300 rounded p-2 break-words">Stripe could not be read: {data.error}</div>}
        {data?.success && data.configured && !data.error && (
          <>
            <div className="border border-[#333] bg-[#1d1d1d] rounded p-2 space-y-1">
              <div className="text-[9px] text-slate-500">PAID, LAST 30 DAYS</div>
              <div className="text-lg text-white font-semibold">{money(d30?.revenue)}</div>
              <div className="text-[10px] text-slate-400">
                {d30?.paidCharges ?? 'Ej observerat'} paid charge(s) · checkout: {d30?.checkoutSessionsPaid ?? '?'} paid of {d30?.checkoutSessionsCreated ?? '?'} started
                {d30 && !d30.complete && <span className="text-amber-400"> (first 500 only)</span>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1 border border-[#333] bg-[#1d1d1d] rounded p-2 text-[10px]">
              <span className="text-slate-500">balance available</span><span className="text-slate-200">{money(data.balance?.available)}</span>
              <span className="text-slate-500">balance pending</span><span className="text-slate-200">{money(data.balance?.pending)}</span>
              <span className="text-slate-500">mode</span><span className="text-slate-200">{data.mode}</span>
              <span className="text-slate-500">payments / payouts</span>
              <span className={data.account?.chargesEnabled && data.account?.payoutsEnabled ? 'text-emerald-300' : 'text-amber-300'}>
                {data.account?.chargesEnabled ? 'enabled' : 'disabled'} / {data.account?.payoutsEnabled ? 'enabled' : 'disabled'}
              </span>
            </div>
            <div className="border border-[#333] bg-[#1d1d1d] rounded p-2">
              <div className="text-[9px] text-slate-500 mb-1">LATEST CHARGES</div>
              {(data.recentCharges || []).length === 0 && <div className="text-slate-500">Inga betalningar finns i den hämtade listan.</div>}
              {(data.recentCharges || []).map(c => (
                <div key={c.id} className="flex gap-2 text-[10px] py-0.5 min-w-0">
                  <span className="text-slate-500 shrink-0">{c.created.slice(0, 10)}</span>
                  <span className={c.paid && !c.refunded ? 'text-emerald-300 shrink-0' : 'text-amber-300 shrink-0'}>{c.amount.toFixed(2)} {c.currency}</span>
                  <span className="text-slate-400 truncate">{c.refunded ? 'refunded' : c.status}{c.description ? ` · ${c.description}` : ''}</span>
                </div>
              ))}
            </div>
            <div className="text-[9px] text-slate-600 px-1">fetched {new Date(data.fetchedAt).toLocaleTimeString()} · read-only</div>
          </>
        )}
      </div>
    </>
  );
};
