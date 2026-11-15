import React, { useEffect, useState } from 'react';
import { auraErrorMessage, readAuraResponse } from '../lib/auraApi.mjs';
import { useOptionalUiLanguage } from '../i18n/UiLanguage';

// The operator's time-limited grant for Windows desktop control (UI Automation). Aura's desktop actions are refused
// until a grant names the program; credential and system-security programs can never be granted (enforced server-side).
type Grant = { enabled: boolean; allowed_processes?: string[]; allow_value_set?: boolean; expires_at?: string };
const DURATIONS = [30, 120, 480];

export const DesktopControlCard: React.FC = () => {
  const { tr, language } = useOptionalUiLanguage();
  const [grant, setGrant] = useState<Grant | null>(null);
  const [processes, setProcesses] = useState('code');
  const [minutes, setMinutes] = useState(120);
  const [allowTyping, setAllowTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    try { setGrant((await fetch('/api/desktop/hands-off/operator/grant', { cache: 'no-store' }).then(readAuraResponse)).grant); setError(null); }
    catch (cause: any) { setError(auraErrorMessage(cause?.message)); }
  };
  useEffect(() => { void load(); }, []);
  const save = async (body: Record<string, unknown>) => {
    setBusy(true); setError(null);
    try {
      const result = await fetch('/api/desktop/hands-off/operator/grant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(readAuraResponse);
      setGrant(result.grant);
    } catch (cause: any) { setError(auraErrorMessage(cause?.message)); }
    finally { setBusy(false); }
  };
  const active = Boolean(grant?.enabled && grant.expires_at && Date.parse(grant.expires_at) > Date.now());
  const until = grant?.expires_at ? new Date(grant.expires_at).toLocaleTimeString(language === 'sv' ? 'sv-SE' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : '';
  const names = processes.split(',').map(name => name.trim()).filter(Boolean);
  return (
    <div className="device-browser" data-testid="desktop-control">
      <strong>{tr('Windows-skrivbordskontroll', 'Windows desktop control')}</strong>
      {active
        ? <p>{tr('Aura får styra', 'Aura may control')} {grant!.allowed_processes!.join(', ')} {tr('till', 'until')} {until}{grant!.allow_value_set ? tr(', även skriva text', ', including typing text') : ''}.</p>
        : <p>{tr('Av. Aura kan inte klicka i program på datorn förrän du ger tillstånd.', 'Off. Aura cannot click in programs on this computer until you allow it.')}</p>}
      {error && <p role="alert" className="text-red-300 break-words">{error}</p>}
      {active
        ? <button type="button" disabled={busy} onClick={() => void save({ enabled: false })}>{tr('Stäng av', 'Turn off')}</button>
        : <div className="space-y-1.5">
            <label className="block">{tr('Program (processnamn, kommaseparerade)', 'Programs (process names, comma separated)')}
              <input className="mt-1 w-full rounded border border-[#505153] bg-[#242527] px-2 py-1" value={processes} onChange={e => setProcesses(e.target.value)} placeholder="code, notepad"/>
            </label>
            <label className="block">{tr('Hur länge', 'For how long')}
              <select className="mt-1 w-full rounded border border-[#505153] bg-[#242527] px-2 py-1" value={minutes} onChange={e => setMinutes(Number(e.target.value))}>
                {DURATIONS.map(m => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={allowTyping} onChange={e => setAllowTyping(e.target.checked)}/>{tr('Får också skriva text i fält', 'May also type text into fields')}</label>
            <button type="button" disabled={busy || !names.length} onClick={() => void save({ enabled: true, processes: names, minutes, allowTyping })}>{tr('Ge tillstånd', 'Allow')}</button>
          </div>}
    </div>
  );
};
