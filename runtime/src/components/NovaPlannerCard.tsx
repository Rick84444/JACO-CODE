import { useUiLanguage } from '../i18n/UiLanguage';
import { readAuraResponse } from '../lib/auraApi.mjs';
import React, { useEffect, useState } from 'react';

// Operator switch for Nova's planner model (GET/POST /api/nova/planner). Nova reads the choice on its
// next planning turn; "Test" makes one small real call so the model is seen answering before a switch.
interface PlannerOption { provider: string; label: string; paid: boolean; models: string[]; keyConfigured: boolean; usable: boolean }
interface PlannerState { choice: { provider: string; model: string; by: string; at: string } | null; choices: PlannerOption[]; paidUsdPerDay: number }
interface TestResult { ok: boolean; provider: string; model: string; latencyMs: number; reply?: string; error?: string }

const AUTO = 'auto';

export const NovaPlannerCard: React.FC = () => {
  const { t: uiText } = useUiLanguage();
  const [state, setState] = useState<PlannerState | null>(null);
  const [selected, setSelected] = useState(AUTO);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);

  const apply = (next: PlannerState) => {
    if (!Array.isArray(next?.choices)) throw new Error('PLANNER_RESPONSE_INVALID');
    setState(next);
    setSelected(next.choice ? `${next.choice.provider}|${next.choice.model}` : AUTO);
  };
  useEffect(() => {
    const load = () => fetch('/api/nova/planner').then(readAuraResponse).then(apply).catch(e => setError(String(e?.message || e)));
    load();
    // A provider's "Använd" button changed the choice from outside this card.
    window.addEventListener('jaco:aura:provider-chosen', load);
    return () => window.removeEventListener('jaco:aura:provider-chosen', load);
  }, []);

  const [provider, model] = selected === AUTO ? [AUTO, ''] : selected.split('|');
  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return readAuraResponse(res);
  };
  const save = async () => {
    setBusy('save'); setError(null);
    try { apply(await post('/api/nova/planner', provider === AUTO ? { provider: AUTO } : { provider, model })); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  };
  const runTest = async () => {
    setBusy('test'); setError(null); setTest(null);
    try { setTest((await post('/api/nova/planner/test', { provider, model })).result); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  };

  const current = state?.choice ? `${state.choice.provider}|${state.choice.model}` : AUTO;
  const selectedOption = state?.choices.find(c => c.provider === provider);
  return (
    <div className="border border-cyan-900 bg-[#0b1620] rounded p-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-xs">{uiText("Planning model")}</strong>
        <span className="text-[9px] text-slate-400 truncate">
          {state ? (state.choice ? `${state.choice.provider} / ${state.choice.model}` : uiText("Selected automatically")) : uiText("Loading…")}
        </span>
      </div>
      <select
        aria-label={uiText("Task planning model")} disabled={!state || busy !== null}
        value={selected}
        onChange={e => { setSelected(e.target.value); setTest(null); }}
        className="w-full bg-[#111] border border-[#333] rounded px-2 py-1.5 text-xs outline-none"
      >
        <option value={AUTO}>{uiText("Automatic, using your model and spending settings")}</option>
        {state?.choices.map(c => (
          <optgroup key={c.provider} label={`${c.label}${c.paid ? uiText(" - billed per request") : ''}${c.usable ? '' : c.keyConfigured ? uiText(" - cloud calls disabled") : uiText(" - key required")}`}>
            {c.models.map(m => <option key={m} value={`${c.provider}|${m}`} disabled={!c.usable}>{m}</option>)}
          </optgroup>
        ))}
      </select>
      {selectedOption?.paid && (
        <div className="text-[9px] text-amber-300">
          {uiText("Billed per request. Daily limit:")}{' '}{state?.paidUsdPerDay.toFixed(2)} {' '}{uiText("USD. Models follow your settings.")}{' '}</div>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => void runTest()}
          disabled={busy !== null || !state || provider === AUTO || !selectedOption?.usable}
          className="flex-1 text-[10px] border border-[#444] px-2 py-1 rounded hover:bg-[#2b2b2b] disabled:opacity-40"
        >
          {busy === 'test' ? 'Testing…' : 'Test'}
        </button>
        <button
          onClick={() => void save()}
          disabled={busy !== null || !state || selected === current}
          className="flex-1 text-[10px] border border-cyan-700 text-cyan-200 px-2 py-1 rounded hover:bg-cyan-950 disabled:opacity-40"
        >
          {busy === 'save' ? 'Saving…' : uiText("Use for tasks")}
        </button>
      </div>
      {test && (
        <div className={`text-[10px] border rounded p-1.5 ${test.ok ? 'border-emerald-800 text-emerald-300' : 'border-red-900 text-red-300'}`}>
          {test.ok ? `answered in ${test.latencyMs} ms: "${test.reply}"` : `no answer after ${test.latencyMs} ms: ${test.error}`}
        </div>
      )}
      {error && <div className="text-[10px] text-red-300 break-words">{error}</div>}
    </div>
  );
};
