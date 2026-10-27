import { readAuraResponse } from '../lib/auraApi.mjs';
import { useUiLanguage } from '../i18n/UiLanguage';
import React, { useEffect, useRef, useState } from 'react';

// Devices view: other computers and the phone that work with this hub (src/server/connected/deviceAccess.mjs).
// Two kinds: 'nova' (the device runs its own Nova for missions routed to it) and 'ide' (a browser signed
// in to the remote IDE, ideAccess.mjs). Pairing gives a one-time code; the device or browser exchanges it
// for its own key, which is never shown here. Every key can be revoked on its own.
type Kind = 'nova' | 'ide';
interface Device { name: string; kind: Kind; executor: string | null; createdAt: string; revokedAt: string | null; lastSeenAt: string | null; online: boolean; memoryAccess?: boolean }
interface Invite { name: string; kind: Kind; executor: string | null; code: string; expiresAt: string }

const ago = (iso: string | null) => {
  if (!iso) return 'aldrig';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 90) return `${s} s sedan`;
  if (s < 5400) return `${Math.round(s / 60)} min sedan`;
  if (s < 172800) return `${Math.round(s / 3600)} h sedan`;
  return new Date(iso).toLocaleDateString('sv-SE');
};


export const DevicesView: React.FC<{ browser?: { targetCount: number; error: string | null }; onInspectBrowser?: () => void }> = ({ browser, onInspectBrowser }) => {
  const { tr } = useUiLanguage();
  const KIND_LABEL = { nova: tr('Lokal agent', 'Local agent'), ide: tr('Webbläsare', 'Browser') };
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [hubUrl, setHubUrl] = useState<string | null>(null);
  const [ideUrl, setIdeUrl] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ remote: boolean; name?: string }>({ remote: false });
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('ide');
  const [invite, setInvite] = useState<Invite | null>(null);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const loading = useRef(false);
  const load = async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const body = await fetch('/api/aura/workbench/devices', { signal: AbortSignal.timeout(10000) }).then(readAuraResponse);
      if (!body.success) throw new Error(body.error || 'DEVICES_UNAVAILABLE');
      setDevices(body.devices); setHubUrl(body.hubUrl); setIdeUrl(body.ideUrl || null); setViewer(body.viewer || { remote: false }); setError('');
      // A pending code is finished once its device or browser has joined.
      setInvite(current => current && body.devices.some((d: Device) => d.name === current.name && d.kind === current.kind && !d.revokedAt
        && Date.parse(d.createdAt) > Date.parse(current.expiresAt) - 600_000) ? null : current);
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { loading.current = false; }
  };
  useEffect(() => {
    void load();
    const poll = setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, 15_000);
    return () => clearInterval(poll);
  }, []);
  useEffect(() => {
    if (!invite) return;
    setNow(Date.now());
    const clock = setInterval(() => {
      const time = Date.now();
      if (document.visibilityState !== 'hidden') setNow(time);
      if (time >= Date.parse(invite.expiresAt)) clearInterval(clock);
    }, 1000);
    return () => clearInterval(clock);
  }, [invite]);

  const createInvite = async () => {
    if (busy) return;
    if (!(kind === 'ide' ? ideUrl : hubUrl)) { setActionError('Konfigurera anslutningsadressen innan parkoppling.'); return; }
    const wanted = name.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(wanted)) { setActionError('Namnet får bara innehålla a-z, 0-9 och bindestreck (2-40 tecken).'); return; }
    setBusy(true); setActionError('');
    try {
      const body = await fetch('/api/aura/workbench/devices/invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: wanted, kind }),
      }).then(readAuraResponse);
      if (!body.success) throw new Error(body.error);
      setInvite(body.invite); setHubUrl(body.hubUrl); setIdeUrl(body.ideUrl || null); setName(''); setCopied(null); setError('');
    } catch (e: any) { setActionError(`Parkoppling kunde inte bekräftas. Kontrollera enhetslistan före nytt försök: ${String(e?.message || e)}`); }
    finally { setBusy(false); }
  };
  const keyOf = (d: { name: string; kind: Kind }) => `${d.kind}:${d.name}`;
  const revoke = async (d: Device) => {
    if (busy) return;
    setBusy(true); setActionError('');
    setConfirmRevoke(null);
    try {
      const body = await fetch(`/api/aura/workbench/devices/${encodeURIComponent(d.name)}?kind=${d.kind}`, { method: 'DELETE' }).then(readAuraResponse);
      if (!body.success) throw new Error(body.error);
      await load();
    } catch (e: any) { setActionError(`Spärrning kunde inte bekräftas. Kontrollera enhetens status: ${String(e?.message || e)}`); }
    finally { setBusy(false); }
  };

  const memoryAccess = async (d: Device) => {
    if (busy) return;setBusy(true);setActionError('');
    try {
      const body=await fetch('/api/aura/workbench/devices/'+encodeURIComponent(d.name)+'/memory', {method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({allowed:!d.memoryAccess})}).then(readAuraResponse);
      if (!body.success) throw Error(body.error);await load();
    } catch (e:any) {setActionError('Minnesbehörigheten kunde inte bekräftas. Uppdatera listan: '+e.message);}
    finally {setBusy(false);}
  };
  const hub = hubUrl;
  const commands = invite?.kind === 'nova' && hub ? [
    { id: 'termux', label: 'Android (Termux), i JACO-mappen efter git pull', text: `bash tools/termux-device.sh join ${hub} ${invite.code}` },
    { id: 'pc', label: 'Dator, i JACO-mappen efter git pull', text: `node tools/join-hub.mjs ${hub} ${invite.code}` },
  ] : [];
  const secondsLeft = invite ? Math.max(0, Math.round((Date.parse(invite.expiresAt) - now) / 1000)) : 0;
  const copy = async (id: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(id); } catch { setCopied(null); setActionError('Kopiering misslyckades. Markera och kopiera texten manuellt.'); }
  };
  const active = devices?.filter(d => !d.revokedAt) || [];
  const revoked = devices?.filter(d => d.revokedAt) || [];

  return (
    <section className="device-workspace flex flex-col min-h-0 flex-1">
      <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-400 flex items-center justify-between">
        <span>{tr('Enheter', 'Devices')}</span>
        <button onClick={() => void load()} className="text-[9px] text-cyan-400 hover:text-cyan-300">{tr('Uppdatera', 'Refresh')}</button>
      </div>
      <div className="flex-1 overflow-auto px-2 space-y-2 text-[11px] min-w-0">
        {actionError && <div role="alert" className="border border-red-900 text-red-300 rounded p-2 break-words">{actionError}</div>}
        {error && <div className="border border-red-900 text-red-300 rounded p-2 break-words">{error}</div>}
        <div className="device-summary" aria-live="polite">
          <span>{active.filter(d => d.online).length} {tr('anslutna enheter', 'connected devices')}</span>
          <span>{error ? tr('Status inaktuell', 'Status outdated') : tr('Registrerade', 'Registered')}: {active.length}</span>
        </div>
        <div className="device-browser">
          <strong>{tr('Webbläsarkontroll', 'Browser control')}</strong>
          <p>{browser?.error ? tr('Kontakten behöver kontrolleras', 'Connection needs attention') : browser?.targetCount ? `${browser.targetCount} ${tr('observerade flikar', 'observed tabs')}` : tr('Ingen webbläsarflik observerad', 'No browser tab observed')}</p>
          <button type="button" onClick={onInspectBrowser} disabled={!onInspectBrowser}>{tr('Inspektera webbläsare', 'Inspect browser')}</button>
        </div>
        {viewer.remote && (
          <div className="border border-cyan-900 bg-[#10202a] rounded p-2 text-[10px] text-cyan-200">
            Du är inloggad på distans som <span className="text-white">{viewer.name}</span>. Terminalen finns bara på datorn.
          </div>
        )}

        <div className="border border-[#333] bg-[#1d1d1d] rounded p-2 space-y-1.5 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-slate-100">{tr('Den här datorn', 'This host')}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-900 text-emerald-200">{tr('hubb', 'Host')}</span>
          </div>
          <div className="text-[9px] text-slate-500">{tr('Standardvärd för uppdrag', 'Default mission host')}</div>
        </div>

        {!devices && !error && <div className="text-slate-500 px-1">{tr('Läser enheter…', 'Loading devices…')}</div>}
        {active.map(d => (
          <div key={keyOf(d)} className="border border-[#333] bg-[#1d1d1d] rounded p-2 space-y-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-100 truncate">{d.name} <span className="text-[9px] text-slate-500">{KIND_LABEL[d.kind]}</span></span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${d.online ? 'bg-emerald-900 text-emerald-200' : d.lastSeenAt ? 'bg-[#333] text-slate-300' : 'bg-amber-900 text-amber-200'}`}>
                {d.online ? (d.kind === 'ide' ? 'aktiv' : 'ansluten') : d.lastSeenAt ? (d.kind === 'ide' ? 'inloggad' : 'ej ansluten') : 'väntar på första kontakt'}
              </span>
            </div>
            <div className="text-[9px] text-slate-500 break-all">{d.executor ? `${d.executor} · ` : ''}senaste kontakt {ago(d.lastSeenAt)} · parkopplad {new Date(d.createdAt).toLocaleDateString('sv-SE')}</div>
            {d.kind === 'nova' && <div className="py-1"><p className="text-slate-400">Delat minne: {d.memoryAccess ? 'Tillåtet' : 'Ej tillåtet'}</p>{!viewer.remote && <button disabled={busy} onClick={() => void memoryAccess(d)} className="text-cyan-300 py-1">{d.memoryAccess ? 'Stäng minnesåtkomst' : 'Tillåt delat minne på denna enhet'}</button>}</div>}
            {confirmRevoke === keyOf(d) ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[9px] text-amber-300">{d.kind === 'ide' ? 'Logga ut webbläsaren?' : 'Spärra nyckeln? Enheten måste parkopplas igen.'}</span>
                <button disabled={busy} onClick={() => void revoke(d)} className="px-1.5 py-0.5 rounded bg-red-900 hover:bg-red-800 text-white text-[9px]">{tr('Spärra', 'Revoke')}</button>
                <button onClick={() => setConfirmRevoke(null)} className="px-1.5 py-0.5 rounded bg-[#333] text-slate-200 text-[9px]">{tr('Avbryt', 'Cancel')}</button>
              </div>
            ) : (
              <button onClick={() => setConfirmRevoke(keyOf(d))} className="text-[9px] text-red-300 hover:text-red-200">{tr('Spärra nyckel', 'Revoke access')}</button>
            )}
          </div>
        ))}

        <div className="border border-cyan-900 bg-[#10202a] rounded p-2 space-y-1.5 min-w-0">
          <div className="text-slate-100">{tr('Lägg till enhet', 'Add device')}</div>
          {!(kind === 'ide' ? ideUrl : hubUrl) && <p role="status" className="text-amber-300">{kind === 'ide' ? tr('En delbar IDE-adress behövs för parkoppling.', 'Pairing requires a shareable IDE address.') : tr('En delbar hubbadress behövs för parkoppling.', 'Pairing requires a shareable hub address.')}</p>}
          {!invite ? (
            <>
              <div className="grid grid-cols-2 gap-1">
                {(['ide', 'nova'] as Kind[]).map(k => (
                  <button key={k} onClick={() => setKind(k)}
                    className={`px-1.5 py-1 rounded text-[10px] border ${kind === k ? 'border-cyan-600 bg-cyan-950 text-white' : 'border-[#333] text-slate-400'}`}>{KIND_LABEL[k]}</button>
                ))}
              </div>
              <div className="text-[9px] text-slate-500">{kind === 'ide'
                ? 'Öppna IDE:t i mobilens webbläsare, som vscode.dev. Inloggningen gäller 30 dagar på den enheten.'
                : 'Enheten kör en egen Nova och tar bara uppdrag som riktas till den.'}</div>
              <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void createInvite(); }}
                aria-label={tr('Enhetsnamn', 'Device name')} placeholder={tr('telefon eller laptop', 'phone or laptop')} className="w-full bg-[#0b0b0b] border border-[#333] rounded p-1 text-[11px] text-slate-200" />
              <button onClick={() => void createInvite()} disabled={busy || !name.trim() || !(kind === 'ide' ? ideUrl : hubUrl)}
                className="px-2 py-1 rounded bg-cyan-800 hover:bg-cyan-700 text-white text-[10px] disabled:opacity-40">{tr('Skapa parkopplingskod', 'Create pairing code')}</button>
            </>
          ) : secondsLeft > 0 ? (
            <>
              <div className="text-[10px] text-slate-400">Kod för <span className="text-cyan-300">{invite.name}</span> ({KIND_LABEL[invite.kind]}), gäller en gång i {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</div>
              <div className="font-mono text-[18px] tracking-[0.2em] text-white text-center py-1 select-all">{invite.code}</div>
              {invite.kind === 'ide' ? (
                <div className="text-[10px] text-slate-300 space-y-1">
                  <div>Öppna i mobilens webbläsare och skriv koden:</div>
                  <div className="font-mono text-[12px] text-cyan-200 break-all select-all">{ideUrl || 'IDE-adress saknas. Konfigurera JACO_IDE_PUBLIC_HOST på servern.'}</div>
                  <div className="text-[9px] text-slate-500">I Chrome: meny, Lägg till på startskärmen, så öppnas IDE:t som en app.</div>
                </div>
              ) : commands.map(c => (
                <div key={c.id} className="space-y-1">
                  <div className="text-[10px] text-slate-400">{c.label}:</div>
                  <pre className="whitespace-pre-wrap break-all font-mono text-[10px] text-slate-200 bg-[#0b0b0b] border border-[#333] rounded p-1.5 select-all">{c.text}</pre>
                  <button onClick={() => void copy(c.id, c.text)} className="px-2 py-1 rounded bg-cyan-800 hover:bg-cyan-700 text-white text-[10px]">{copied === c.id ? 'Kopierat' : 'Kopiera'}</button>
                </div>
              ))}
              <button onClick={() => setInvite(null)} className="px-2 py-1 rounded bg-[#333] text-slate-200 text-[10px]">{tr('Klar', 'Done')}</button>
            </>
          ) : (
            <>
              <div className="text-[10px] text-amber-300">Koden för {invite.name} har gått ut.</div>
              <button onClick={() => { setName(invite.name); setKind(invite.kind); setInvite(null); }} className="px-2 py-1 rounded bg-[#333] text-slate-200 text-[10px]">{tr('Skapa ny kod', 'Create new code')}</button>
            </>
          )}
        </div>

        {revoked.length > 0 && (
          <div className="text-[9px] text-slate-600 px-1 break-words">Spärrade: {revoked.map(d => `${d.name} (${d.kind})`).join(', ')}</div>
        )}
      </div>
    </section>
  );
};
