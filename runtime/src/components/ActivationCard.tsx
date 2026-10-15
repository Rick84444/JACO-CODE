import { readAuraResponse } from '../lib/auraApi.mjs';
import React, { useEffect, useState } from 'react';
import { Loader2, Check, AlertTriangle, Power } from 'lucide-react';

// One place that says what works and one button that starts what does not (GET /api/jaco/activation reads,
// POST /api/jaco/activate starts every stopped tool server, then both report the same thing as `jaco activate`).
interface Report {
  ok: boolean;
  runtime: { up: boolean };
  tools: { toolCount: number; ready: number; servers: Array<{ id: string; status: string; tools: number; error?: string; started?: boolean }> };
  providers: Array<{ id: string; active: boolean; state: string; models: number }>;
  planner: { provider: string | null; model: string | null; source: string; reachable: boolean | null } | null;
  problems: string[];
}

export const ActivationCard: React.FC<{ onActivated?: () => void }> = ({ onActivated }) => {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  const read = async (start: boolean) => {
    setBusy(start); setError('');
    try {
      const body = await fetch(start ? '/api/jaco/activate' : '/api/jaco/activation', start ? { method: 'POST' } : undefined).then(readAuraResponse);
      if (!body.success) throw new Error(body.error || 'ACTIVATION_FAILED');
      setReport(body.report);
      if (start) onActivated?.();
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { void read(false); }, []);

  const active = report?.providers.filter(p => p.active).length ?? 0;
  return (
    <div className={`rounded border p-2 space-y-2 ${report?.ok ? 'border-emerald-800 bg-[#0b1a14]' : 'border-amber-800 bg-[#1a150b]'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0 text-xs font-semibold">
          {!report ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : report.ok ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
          <span className="truncate">{!report ? 'Kontrollerar…' : report.ok ? 'JACO är aktivt' : 'JACO är inte helt aktivt'}</span>
        </div>
        <button type="button" onClick={() => void read(true)} disabled={busy}
          className="shrink-0 flex items-center gap-1.5 text-[11px] border border-cyan-700 text-cyan-200 px-2.5 py-1.5 rounded hover:bg-cyan-950 disabled:opacity-40">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}Aktivera allt
        </button>
      </div>
      {report && (
        <button type="button" onClick={() => setOpen(v => !v)} className="w-full text-left text-[11px] text-slate-300">
          {report.tools.toolCount} verktyg i {report.tools.ready} av {report.tools.servers.length} servrar · {active} av {report.providers.length} modeller svarar
          {report.planner ? ` · Nova: ${report.planner.provider ? `${report.planner.provider}${report.planner.model ? ` / ${report.planner.model}` : ''}` : 'ingen'}` : ''}
        </button>
      )}
      {open && report && (
        <div className="text-[11px] space-y-0.5">
          {report.tools.servers.map(s => <div key={s.id} className={s.status === 'READY' ? 'text-emerald-300' : 'text-slate-400'}>{s.id}: {s.status === 'READY' ? `${s.tools} verktyg` : s.error ? `fel: ${s.error}` : 'stoppad'}</div>)}
          {report.providers.map(p => <div key={p.id} className={p.active ? 'text-emerald-300' : 'text-slate-400'}>{p.id}: {p.active ? `${p.models} modeller` : ({ NO_KEY: 'ingen nyckel', KEY_REJECTED: 'nyckeln nekas', UNREACHABLE: 'svarar inte' } as Record<string, string>)[p.state] || p.state}</div>)}
        </div>
      )}
      {report?.problems.map((p, i) => <div key={i} className="text-[11px] text-amber-300 break-words">{p}</div>)}
      {error && <div className="text-[11px] text-red-300 break-words">{error}</div>}
    </div>
  );
};
