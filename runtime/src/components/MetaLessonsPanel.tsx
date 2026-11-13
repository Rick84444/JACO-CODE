import React, { useCallback, useEffect, useState } from 'react';
import { readAuraResponse } from '../lib/auraApi.mjs';
import { useUiLanguage } from '../i18n/UiLanguage';

// What Aura learned about her own decisions (agents/lib/meta-reasoning.mjs). A model-written lesson waits as
// PROPOSED until the operator approves it; any lesson can be retired. Lessons are advice, never permission.
type Measure = { shown: number; recurred: number; recurrenceWithLesson: number | null; recurrenceWithoutLesson: number | null; comparedMissions: number };
export type Lesson = { id: string; pattern: string; rule: string; cause: string | null; audience: string; status: string; by: string | null; sources: Array<{ missionId: string; evidence: string[] }>; measure: Measure };

const STATUS_WORD: Record<string, [string, string]> = {
  PROPOSED: ['väntar på ditt ja', 'waiting for your yes'], TRIAL: ['på prov', 'on trial'],
  ACTIVE: ['har hjälpt', 'has helped'], RETIRED: ['pensionerad', 'retired'],
};
const pct = (v: number | null) => v == null ? '–' : `${Math.round(v * 100)} %`;

// Order for the operator: what needs a decision first, then what is in use, retired last.
export function lessonOrder(lessons: Lesson[]): Lesson[] {
  const rank: Record<string, number> = { PROPOSED: 0, ACTIVE: 1, TRIAL: 2, RETIRED: 3 };
  return [...lessons].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || b.sources.length - a.sources.length);
}

export function MetaLessonsPanel() {
  const { tr } = useUiLanguage();
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/aura/workbench/meta-lessons', { cache: 'no-store' }).then(readAuraResponse);
      if (r.success === false) throw new Error(r.error);
      setLessons(r.lessons || []); setError('');
    } catch (e: any) { setError(String(e?.message || e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const act = async (id: string, action: 'approve' | 'retire') => {
    setBusy(id + action);
    try {
      const r = await fetch(`/api/aura/workbench/meta-lessons/${encodeURIComponent(id)}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(readAuraResponse);
      if (r.success === false) throw new Error(r.error);
      await load();
    } catch (e: any) { setError(String(e?.message || e)); } finally { setBusy(null); }
  };
  return <section data-testid="meta-lessons" className="space-y-2">
    <p className="text-xs text-neutral-400">{tr('Lärdomar om hur Aura fattar beslut, dragna ur misstag i tidigare uppdrag. De är råd och ger ingen behörighet.', 'Lessons about how Aura decides, drawn from mistakes in earlier missions. They are advice and grant no permission.')}</p>
    {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}
    {lessons && lessons.length === 0 && <p className="text-xs text-neutral-400">{tr('Inga lärdomar än.', 'No lessons yet.')}</p>}
    {lessons && lessonOrder(lessons).map(l => <article key={l.id} data-lesson-status={l.status} className={`rounded border p-2 text-xs ${l.status === 'PROPOSED' ? 'border-amber-400/60' : 'border-neutral-700'} ${l.status === 'RETIRED' ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong className="text-neutral-100">{l.rule}</strong>
        <span className="uppercase tracking-widest text-neutral-400">{tr(...(STATUS_WORD[l.status] || [l.status, l.status]))}{l.audience === 'operator' ? ` · ${tr('till dig', 'for you')}` : ''}</span>
      </div>
      {l.cause && <p className="mt-1 text-neutral-300">{tr('Varför', 'Why')}: {l.cause}</p>}
      <p className="mt-1 text-neutral-400">{tr('Sett i', 'Seen in')} {l.sources.length} {tr('uppdrag', 'mission(s)')}{l.by ? ` · ${tr('formulerad av', 'written by')} ${l.by}` : ''} · {tr('visad för', 'shown to')} {l.measure.shown} · {tr('misstaget igen med lärdomen', 'mistake again with the lesson')} {pct(l.measure.recurrenceWithLesson)} · {tr('utan', 'without')} {pct(l.measure.recurrenceWithoutLesson)}</p>
      <div className="mt-1.5 flex gap-1.5">
        {l.status === 'PROPOSED' && <button type="button" disabled={busy !== null} onClick={() => void act(l.id, 'approve')} className="rounded bg-amber-300 px-2 py-0.5 font-semibold text-black disabled:opacity-50">{tr('Godkänn för prov', 'Approve for trial')}</button>}
        {l.status !== 'RETIRED' && <button type="button" disabled={busy !== null} onClick={() => void act(l.id, 'retire')} className="rounded border border-neutral-600 px-2 py-0.5 text-neutral-200 disabled:opacity-50">{tr('Pensionera', 'Retire')}</button>}
      </div>
    </article>)}
  </section>;
}
