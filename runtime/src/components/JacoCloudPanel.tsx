import React, { useCallback, useEffect, useState } from 'react';
import { readAuraResponse } from '../lib/auraApi.mjs';
import { useOptionalUiLanguage } from '../i18n/UiLanguage';

// JacoCloud: reach your own JACO from your phone (runtime/src/server/connected/jacocloud.mjs). The tunnel is
// temporary and free, needs no account, and only a phone paired with a one-time code gets past its sign-in page.
type Device = { name: string; lastSeenAt: string | null; createdAt: string };
type Cloud = { state: 'off' | 'starting' | 'on' | 'error'; url: string | null; error: string | null; devices: Device[] };
type Invite = { code: string; expiresAt: string; link: string; qr: string };

const post = (url: string, method = 'POST') => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'DELETE' ? undefined : '{}', signal: AbortSignal.timeout(90000) }).then(readAuraResponse);

export function JacoCloudPanel() {
  const { tr } = useOptionalUiLanguage();
  const [cloud, setCloud] = useState<Cloud | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    try { const data = await fetch('/api/aura/jacocloud', { cache: 'no-store', signal: AbortSignal.timeout(10000) }).then(readAuraResponse); setCloud(data); }
    catch { /* the last known state stays */ }
  }, []);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 5000); return () => window.clearInterval(timer); }, [refresh]);
  useEffect(() => { if (!invite) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [invite]);

  const words = (code: string) => ({
    CLOUDFLARED_MISSING: tr('Programmet cloudflared saknas på datorn. Installera det (i Windows: winget install Cloudflare.cloudflared) och försök igen.', 'The cloudflared program is missing on this computer. Install it (on Windows: winget install Cloudflare.cloudflared) and try again.'),
    TUNNEL_START_TIMEOUT: tr('Cloudflare svarade inte inom en minut. Kontrollera nätverket och försök igen.', 'Cloudflare did not answer within a minute. Check the network and try again.'),
    CLOUDFLARED_EXITED: tr('Tunneln stängdes direkt. Försök igen om en stund.', 'The tunnel closed right away. Try again in a moment.'),
    TUNNEL_ALREADY_RUNNING: tr('Tunneln är redan igång.', 'The tunnel is already running.'),
    TUNNEL_NOT_RUNNING: tr('Starta tunneln först.', 'Start the tunnel first.'),
    LOGIN_CHANGE_REQUIRES_INTERFACE: tr('Det här kan bara göras i JACO på den här datorn.', 'This can only be done in JACO on this computer.'),
    JACOCLOUD_LOCAL_ONLY: tr('Det här kan bara göras i JACO på den här datorn.', 'This can only be done in JACO on this computer.'),
  } as Record<string, string>)[code] || tr('Det gick inte: ', 'It did not work: ') + code;

  const act = async (name: string, run: () => Promise<void>) => {
    if (busy) return;
    setBusy(name); setError('');
    try { await run(); } catch (e: any) { setError(words(String(e?.message || e))); }
    finally { setBusy(''); await refresh(); }
  };
  const start = () => act('start', async () => { await post('/api/aura/jacocloud/start'); setInvite(null); });
  const stop = () => act('stop', async () => { await post('/api/aura/jacocloud/stop'); setInvite(null); });
  const pair = () => act('invite', async () => { setInvite(await post('/api/aura/jacocloud/invite')); setNow(Date.now()); });
  const remove = (name: string) => act('remove:' + name, async () => { await post(`/api/aura/jacocloud/devices/${encodeURIComponent(name)}`, 'DELETE'); });

  const on = cloud?.state === 'on';
  const secondsLeft = invite ? Math.max(0, Math.round((Date.parse(invite.expiresAt) - now) / 1000)) : 0;
  const mmss = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;

  return <section className="jacocloud" aria-label="JacoCloud">
    <h3>{tr('Koppla telefonen', 'Connect your phone')}</h3>
    <p>{tr('Använd din egen JACO från telefonen, hemifrån eller på språng. Det kostar ingenting och kräver inget konto. Adressen är tillfällig och ändras varje gång du startar. Terminalen stannar på datorn.', 'Use your own JACO from your phone, at home or on the move. It costs nothing and needs no account. The address is temporary and changes each time you start. The terminal stays on this computer.')}</p>
    {error && <p role="alert">{error}</p>}
    {!cloud && <p>{tr('Läser läget…', 'Checking…')}</p>}
    {cloud && !on && <>
      <button type="button" disabled={!!busy || cloud.state === 'starting'} onClick={() => void start()}>
        {busy === 'start' || cloud.state === 'starting' ? tr('Startar, det kan ta upp till en minut…', 'Starting, it can take up to a minute…') : tr('Starta och koppla telefonen', 'Start and connect your phone')}
      </button>
      {cloud.state === 'error' && cloud.error && !error && <p role="alert">{words(cloud.error)}</p>}
    </>}
    {on && <>
      <p role="status"><strong>{tr('Tunneln är igång.', 'The tunnel is on.')}</strong> {tr('Bara en telefon som du själv parar ihop kommer förbi inloggningssidan.', 'Only a phone you pair yourself gets past the sign-in page.')}</p>
      {!invite && <button type="button" disabled={!!busy} onClick={() => void pair()}>{tr('Visa QR-kod för telefonen', 'Show a QR code for your phone')}</button>}
      {invite && <div className="jacocloud-pair">
        <img src={`data:image/svg+xml;utf8,${encodeURIComponent(invite.qr)}`} alt={tr('QR-kod för att koppla telefonen', 'QR code to connect your phone')} width={220} height={220} />
        <p>{tr('Rikta telefonens kamera mot koden och öppna länken. Fungerar inte det, öppna', 'Point the phone camera at the code and open the link. If that does not work, open')} <code>{cloud.url}/ide-login</code> {tr('och skriv koden', 'and type the code')}: <strong style={{ fontFamily: 'monospace', fontSize: 20, letterSpacing: 2 }}>{invite.code}</strong></p>
        <p>{secondsLeft > 0 ? tr(`Koden gäller en gång, ytterligare ${mmss}.`, `The code works once, for another ${mmss}.`) : tr('Koden har gått ut. Visa en ny.', 'The code has expired. Show a new one.')}</p>
        {secondsLeft === 0 && <button type="button" disabled={!!busy} onClick={() => void pair()}>{tr('Visa en ny kod', 'Show a new code')}</button>}
      </div>}
      <button type="button" disabled={!!busy} onClick={() => void stop()}>{tr('Stäng tunneln', 'Close the tunnel')}</button>
    </>}
    {cloud && cloud.devices.length > 0 && <>
      <h4>{tr('Parade telefoner', 'Paired phones')}</h4>
      {cloud.devices.map(device => <article key={device.name}>
        <strong>{device.name}</strong>
        <small> {device.lastSeenAt ? `${tr('senast', 'last seen')} ${new Date(device.lastSeenAt).toLocaleString()}` : tr('har inte använts än', 'not used yet')}</small>
        <button type="button" disabled={!!busy} onClick={() => void remove(device.name)}>{tr('Ta bort', 'Remove')}</button>
      </article>)}
      <p>{tr('En borttagen telefon loggas ut direkt.', 'A removed phone is signed out at once.')}</p>
    </>}
  </section>;
}
