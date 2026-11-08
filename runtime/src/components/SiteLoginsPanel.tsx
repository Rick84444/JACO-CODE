import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Trash2 } from 'lucide-react';
import { readAuraResponse } from '../lib/auraApi.mjs';
import { useUiLanguage } from '../i18n/UiLanguage';

// The sign-ins the operator lets Aura use. The password goes from this form straight into JACO's encrypted store and
// is never shown again, not here, not in the chat, not to the model; Aura only learns whether a sign-in worked.
type Login = { origin: string; username: string; savedAt: string };

export function SiteLoginsPanel() {
  const { tr } = useUiLanguage();
  const [logins, setLogins] = useState<Login[] | null>(null);
  const [site, setSite] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    try { const r = await fetch('/api/aura/logins', { cache: 'no-store' }).then(readAuraResponse); setLogins(r.logins || []); }
    catch (e: any) { setNotice({ ok: false, text: String(e?.message || e) }); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!agreed) { setNotice({ ok: false, text: tr('Kryssa i rutan först, så vet Aura att du godkänner inloggningen.', 'Tick the box first, so Aura knows you approve the sign-in.') }); return; }
    setBusy(true); setNotice(null);
    try {
      const r = await fetch('/api/aura/logins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site, username, password }) }).then(readAuraResponse);
      if (r.success === false) throw new Error(r.error);
      setPassword(''); setSite(''); setUsername(''); setAgreed(false);
      setNotice({ ok: true, text: tr(`Sparat. Aura kan nu logga in på ${r.login.origin}.`, `Saved. Aura can now sign in to ${r.login.origin}.`) });
      await load();
    } catch (e: any) { setPassword(''); setNotice({ ok: false, text: explain(String(e?.message || e), tr) }); }
    finally { setBusy(false); }
  };
  const remove = async (origin: string) => {
    setBusy(true);
    try { await fetch(`/api/aura/logins?site=${encodeURIComponent(origin)}`, { method: 'DELETE' }).then(readAuraResponse); await load(); }
    catch (e: any) { setNotice({ ok: false, text: String(e?.message || e) }); }
    finally { setBusy(false); }
  };
  return <section className="space-y-3">
    <h3>{tr('Inloggningar Aura får använda', 'Sign-ins Aura may use')}</h3>
    <p>{tr('Spara en webbplats du vill att Aura ska kunna logga in på. Lösenordet sparas krypterat på den här datorn och visas aldrig igen, inte heller för Aura: JACO fyller i det åt henne och hon får bara veta om det gick. Inloggad gör hon inga köp, prenumerationer eller uppgraderingar; sådant frågar hon dig om. CAPTCHA och engångskoder lämnar hon till dig.',
      'Save a site you want Aura to be able to sign in to. The password is stored encrypted on this computer and is never shown again, not to Aura either: JACO fills it in for her and she only learns whether it worked. Signed in, she makes no purchases, subscriptions or upgrades; she asks you about those. CAPTCHAs and one-time codes are left to you.')}</p>
    <form onSubmit={e => void save(e)} className="space-y-2" autoComplete="off">
      <label>{tr('Webbplats', 'Site')}<input value={site} onChange={e => setSite(e.target.value)} placeholder="https://example.com" required /></label>
      <label>{tr('Användarnamn eller e-post', 'Username or email')}<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" required /></label>
      <label>{tr('Lösenord', 'Password')}<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" required /></label>
      <label className="flex items-start gap-2"><input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
        <span>{tr('Jag godkänner att Aura loggar in på den här webbplatsen med de här uppgifterna, inom JACO:s regler.', 'I approve Aura signing in to this site with these details, within JACO\'s rules.')}</span></label>
      <button type="submit" disabled={busy}><KeyRound size={14} /> {tr('Spara inloggning', 'Save sign-in')}</button>
    </form>
    {notice && <p role={notice.ok ? 'status' : 'alert'} className={notice.ok ? 'text-emerald-400' : 'text-amber-300'}>{notice.text}</p>}
    {logins && logins.length === 0 && <p>{tr('Inga sparade inloggningar än.', 'No saved sign-ins yet.')}</p>}
    {logins && logins.length > 0 && <ul className="space-y-1">{logins.map(l => <li key={l.origin} className="flex items-center justify-between gap-2">
      <span><strong>{l.origin}</strong> · {l.username}</span>
      <button type="button" disabled={busy} onClick={() => void remove(l.origin)} aria-label={tr(`Ta bort inloggningen för ${l.origin}`, `Remove the sign-in for ${l.origin}`)}><Trash2 size={14} /> {tr('Ta bort', 'Remove')}</button>
    </li>)}</ul>}
  </section>;
}

function explain(code: string, tr: (sv: string, en: string) => string) {
  if (code.includes('MUST_BE_HTTPS')) return tr('Webbplatsen måste använda https.', 'The site must use https.');
  if (code.includes('NOT_ALLOWED')) return tr('Inloggningar hos Google, Microsoft, Apple, BankID och betaltjänster gör du alltid själv.', 'Sign-ins at Google, Microsoft, Apple, BankID and payment services are always yours to do.');
  if (code.includes('PRIVATE')) return tr('Det går bara att spara inloggningar för publika webbplatser.', 'Only public sites can have a saved sign-in.');
  if (code.includes('SITE_INVALID')) return tr('Skriv webbplatsens adress, till exempel https://example.com.', 'Write the site\'s address, for example https://example.com.');
  return tr('Inloggningen kunde inte sparas.', 'The sign-in could not be saved.') + ` (${code})`;
}
