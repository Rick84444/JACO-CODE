import React, { useCallback, useEffect, useState } from 'react';
import { readAuraResponse } from '../lib/auraApi.mjs';

type Secret = { name: string; configured: boolean; purpose?: string; source?: string; updatedAt?: string };
type WindowsVault = { available: boolean; keys: string[]; reason?: string };
const EXAMPLES = [
  { label: 'Välj referens för en tjänst', name: '' },
  { label: 'Coinbase CDP — API key ID', name: 'CDP_API_KEY_ID' },
  { label: 'Coinbase CDP — API key secret', name: 'CDP_API_KEY_SECRET' },
  { label: 'Coinbase Commerce', name: 'COINBASE_COMMERCE_KEY' },
  { label: 'Cloudflare — API token', name: 'CLOUDFLARE_API_TOKEN' },
  { label: 'Stripe — API secret', name: 'STRIPE_SECRET_KEY' },
  { label: 'GitHub — personal access token', name: 'GITHUB_TOKEN' },
  { label: 'Egen tjänst', name: 'CUSTOM_API_KEY' },
];
const KEY_NAME = /^[A-Z][A-Z0-9_]{1,127}$/;

export function ApiVaultPanel({ onChanged }: { onChanged?: () => void | Promise<void> }) {
  const [secrets, setSecrets] = useState<Secret[] | null>(null);
  const [windows, setWindows] = useState<WindowsVault | null>(null);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = useCallback(async () => {
    const results = await Promise.allSettled([
      fetch('/api/aura/workbench/secrets', { cache: 'no-store' }).then(readAuraResponse),
      fetch('/api/aura/workbench/vault/windows', { cache: 'no-store' }).then(readAuraResponse),
    ]);
    if (results[0].status === 'fulfilled') setSecrets(results[0].value.secrets || []);
    else { setSecrets(null); setError('JACO:s krypterade Vault kunde inte läsas.'); }
    if (results[1].status === 'fulfilled') setWindows(results[1].value);
    else setWindows({ available: false, keys: [], reason: 'WINDOWS_VAULT_UNAVAILABLE' });
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(''); setNotice('');
    const key = name.trim().toUpperCase();
    if (!KEY_NAME.test(key)) { setError('Använd ett namn som CUSTOM_API_KEY, med versaler, siffror och understreck.'); return; }
    if (!value.trim()) { setError('Ange nyckeln eller token som ska lagras.'); return; }
    if (secrets?.some(secret => secret.name === key)) { setError('Nyckeln finns redan. Befintliga nycklar skrivs inte över från detta formulär.'); return; }
    setBusy('save');
    try {
      await fetch('/api/aura/workbench/secrets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: key, value: value.trim(), purpose: purpose.trim() || key }),
      }).then(readAuraResponse);
      setValue(''); setNotice(`${key} lagrad krypterat. Ingen extern API-anslutning har verifierats ännu.`);
      await refresh();
      await onChanged?.();
    } catch (err: any) { setError(err?.message || 'Nyckeln kunde inte sparas.'); }
    finally { setBusy(''); }
  };

  const importWindows = async (key: string) => {
    if (busy) return;
    setBusy(key); setError(''); setNotice('');
    try {
      await fetch('/api/aura/workbench/vault/import-windows', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: key }),
      }).then(readAuraResponse);
      setNotice(`${key} kopierad till JACO:s krypterade Vault. Originalet i Windows är oförändrat.`);
      await refresh();
      await onChanged?.();
    } catch (err: any) { setError(`Import av ${key}: ${err?.message || 'misslyckades'}`); }
    finally { setBusy(''); }
  };

  const imported = new Set(secrets?.map(s => s.name) || []);
  return <section aria-label="API och Vault">
    <h3>API &amp; Vault</h3>
    <p>Samma krypterade SecretStore som JACO-runtime använder. Endast namn och status visas, aldrig nyckelvärden. Lagrad betyder inte ansluten eller API-verifierad.</p>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <form onSubmit={e => void save(e)}>
      <h4>Lägg till en tjänstnyckel</h4>
      <label>Tjänst
        <select aria-label="Välj tjänst" value={EXAMPLES.some(x => x.name === name) ? name : ''} onChange={e => { setName(e.target.value); setPurpose(e.target.selectedOptions[0]?.text || ''); }}>
          {EXAMPLES.map(x => <option key={x.label} value={x.name}>{x.label}</option>)}
        </select>
      </label>
      <label>Vault-referens
        <input aria-label="Vault-referens" value={name} onChange={e => setName(e.target.value.toUpperCase())} placeholder="MIN_TJANST_API_KEY" autoComplete="off" />
      </label>
      <label>API-nyckel / token
        <input aria-label="API-nyckel i Vault" type="password" value={value} onChange={e => setValue(e.target.value)} autoComplete="off" placeholder="Klistra in hemligheten" />
      </label>
      <label>Beskrivning (valfri)
        <input aria-label="Vault-beskrivning" value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="Tjänstens användning" />
      </label>
      <button type="submit" disabled={!!busy || !value.trim() || !KEY_NAME.test(name.trim())}> {busy === 'save' ? 'Sparar…' : 'Spara i Vault'} </button>
    </form>
    <h4>Lagrat i JACO Vault</h4>
    {secrets === null ? <p>Status kunde inte verifieras.</p> : secrets.length === 0 ? <p>Inga nycklar observerade i den krypterade lagringen.</p> :
      secrets.map(secret => <article key={secret.name}>
        <strong>{secret.name}</strong> <span> Lagrad · Inte API-verifierad</span>
        {secret.purpose && <p>{secret.purpose}</p>}
        <small>Källa: {secret.source || 'okänd'}{secret.updatedAt ? ` · Uppdaterad ${secret.updatedAt}` : ''}</small>
      </article>)}
    <h4>Äldre Windows Vault (DPAPI)</h4>
    {!windows ? <p>Kontrollerar Windows Credential Manager…</p> :
      !windows.available ? <p>{windows.reason === 'WINDOWS_ONLY' ? 'Windows Credential Manager finns inte på denna enhet.' : 'Windows Vault kunde inte kontrolleras.'}</p> :
      windows.keys.length === 0 ? <p>Inga JACO-nycklar hittades i Windows Credential Manager.</p> :
      <><p>Nycklar här kan importeras individuellt. Ingenting raderas ur Windows Vault, och inga befintliga JACO-nycklar skrivs över.</p>
        {windows.keys.map(key => <article key={key}>
          <strong>{key}</strong> <span>{imported.has(key) ? 'Finns redan i JACO Vault' : 'Endast Windows Vault'}</span>
          {!imported.has(key) && <button type="button" disabled={!!busy} onClick={() => void importWindows(key)}>
            {busy === key ? 'Importerar…' : 'Importera till JACO'}
          </button>}
        </article>)}</>}
    <button type="button" disabled={!!busy} onClick={() => void refresh()}>Kontrollera Vault igen</button>
    <p>Vault lagrar autentiseringsuppgifter. API-anrop, OAuth och externa skrivåtgärder behöver fortfarande en ansluten tjänsteadapter eller ett MCP-verktyg med rätt behörighet.</p>
  </section>;
}
