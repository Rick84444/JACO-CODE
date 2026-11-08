import React, { useEffect, useState } from 'react';
import { readAuraResponse } from '../lib/auraApi.mjs';
import { useUiLanguage } from '../i18n/UiLanguage';

// Routines: goals you approve to run again on a schedule. Each run is an ordinary mission with your budget and rules.
type Routine = { id: string; title: string; goal: string; days: string[]; time: string; enabled: boolean; nextRunAt: string | null; lastRunAt: string | null; lastError: string | null };
const DAYS: Array<[string, string, string]> = [['mon', 'mån', 'Mon'], ['tue', 'tis', 'Tue'], ['wed', 'ons', 'Wed'], ['thu', 'tor', 'Thu'], ['fri', 'fre', 'Fri'], ['sat', 'lör', 'Sat'], ['sun', 'sön', 'Sun']];

export function RoutinesPanel() {
  const { tr, language } = useUiLanguage();
  const [list, setList] = useState<Routine[]>([]);
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [days, setDays] = useState<string[]>(['mon']);
  const [time, setTime] = useState('08:00');
  const [error, setError] = useState('');
  const load = () => fetch('/api/aura/routines').then(readAuraResponse).then(b => setList(b.routines || [])).catch(() => setError(tr('Kunde inte läsa rutinerna.', 'Could not read the routines.')));
  useEffect(() => { void load(); }, []);
  const send = async (url: string, method: string, body?: unknown) => {
    setError('');
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }).then(readAuraResponse);
      if (r.success === false) throw new Error(r.error);
      await load(); return true;
    } catch (e: any) { setError(String(e?.message || e)); return false; }
  };
  const when = (iso: string | null) => iso ? new Date(iso).toLocaleString(language === 'sv' ? 'sv-SE' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–';
  return <section data-testid="routines-panel">
    <h3>{tr('Rutiner', 'Routines')}</h3>
    <p>{tr('Ett mål du godkänner att Aura gör om på bestämda tider, till exempel varje måndag: "Sök efter trender inom lokala AI-verktyg och skriv en kort sammanfattning." Varje körning är ett vanligt uppdrag med din budget och dina regler.', 'A goal you approve for Aura to do again at set times, for example every Monday: "Look for trends in local AI tools and write a short summary." Each run is an ordinary mission with your budget and your rules.')}</p>
    {list.map(r => <article key={r.id} className="border border-[#323335] rounded p-2 my-2 text-sm">
      <strong>{r.title}</strong> · {r.days.map(d => (DAYS.find(x => x[0] === d) || [d, d, d])[language === 'sv' ? 1 : 2]).join(', ')} {r.time}
      <div className="text-neutral-400">{r.goal}</div>
      <div className="text-xs text-neutral-400">{tr('Nästa', 'Next')}: {r.enabled ? when(r.nextRunAt) : tr('pausad', 'paused')} · {tr('Senast', 'Last')}: {when(r.lastRunAt)}{r.lastError ? ` · ${tr('fel', 'error')}: ${r.lastError}` : ''}</div>
      <button type="button" onClick={() => void send(`/api/aura/routines/${r.id}`, 'PATCH', { enabled: !r.enabled })}>{r.enabled ? tr('Pausa', 'Pause') : tr('Starta', 'Resume')}</button>{' '}
      <button type="button" onClick={() => void send(`/api/aura/routines/${r.id}`, 'DELETE')}>{tr('Ta bort', 'Remove')}</button>
    </article>)}
    <h4>{tr('Ny rutin', 'New routine')}</h4>
    <label>{tr('Namn', 'Name')}<input value={title} onChange={e => setTitle(e.target.value)} placeholder={tr('Veckans trender', 'Weekly trends')} /></label>
    <label>{tr('Vad ska Aura göra?', 'What should Aura do?')}<textarea value={goal} onChange={e => setGoal(e.target.value)} rows={3} /></label>
    <div role="group" aria-label={tr('Dagar', 'Days')}>{DAYS.map(([id, sv, en]) => <label key={id} className="mr-2"><input type="checkbox" checked={days.includes(id)} onChange={e => setDays(d => e.target.checked ? [...d, id] : d.filter(x => x !== id))} /> {language === 'sv' ? sv : en}</label>)}</div>
    <label>{tr('Tid', 'Time')}<input type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
    <button type="button" disabled={goal.trim().length < 10 || !days.length} onClick={async () => { if (await send('/api/aura/routines', 'POST', { title, goal, days, time })) { setTitle(''); setGoal(''); } }}>{tr('Godkänn och spara rutinen', 'Approve and save the routine')}</button>
    {error && <p role="alert" className="text-amber-300">{error}</p>}
  </section>;
}
