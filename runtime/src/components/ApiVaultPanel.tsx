import React, { useCallback, useEffect, useState } from 'react';
import { readAuraResponse } from '../lib/auraApi.mjs';
import { useOptionalUiLanguage } from '../i18n/UiLanguage';

type Secret = { name: string; configured: boolean; purpose?: string; source?: string; updatedAt?: string };
type WindowsVault = { available: boolean; keys: string[]; reason?: string };
type Discovery = { localEnvFiles: string[]; localEnvImported: string[]; windowsModelLoaded: string[]; configured: Array<{ name: string; source: string; state: string }> };
const EXAMPLES = [
  { label: 'Choose a reference for a service', sv: 'Välj en referens för en tjänst', name: '' },
  { label: 'Coinbase CDP — API key ID', sv: 'Coinbase CDP – API-nyckelns ID', name: 'CDP_API_KEY_ID' },
  { label: 'Coinbase CDP — API key secret', sv: 'Coinbase CDP – API-nyckelns hemlighet', name: 'CDP_API_KEY_SECRET' },
  { label: 'Coinbase Commerce', name: 'COINBASE_COMMERCE_KEY' },
  { label: 'Cloudflare — API token', sv: 'Cloudflare – API-token', name: 'CLOUDFLARE_API_TOKEN' },
  { label: 'Stripe — API secret', sv: 'Stripe – API-hemlighet', name: 'STRIPE_SECRET_KEY' },
  { label: 'GitHub — personal access token', sv: 'GitHub – personlig åtkomsttoken', name: 'GITHUB_TOKEN' },
  { label: 'Custom service', sv: 'Egen tjänst', name: 'CUSTOM_API_KEY' },
];
const KEY_NAME = /^[A-Z][A-Z0-9_]{1,127}$/;

export function ApiVaultPanel({ onChanged }: { onChanged?: () => void | Promise<void> }) {
  const { tr, language } = useOptionalUiLanguage();
  const [secrets, setSecrets] = useState<Secret[] | null>(null);
  const [windows, setWindows] = useState<WindowsVault | null>(null);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
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
      fetch('/api/aura/workbench/vault/discovery', { cache: 'no-store' }).then(readAuraResponse),
    ]);
    if (results[0].status === 'fulfilled') setSecrets(results[0].value.secrets || []);
    else { setSecrets(null); setError(tr('JACO:s krypterade kassaskåp gick inte att läsa.', "JACO's encrypted Vault could not be read.")); }
    if (results[1].status === 'fulfilled') setWindows(results[1].value);
    else setWindows({ available: false, keys: [], reason: 'WINDOWS_VAULT_UNAVAILABLE' });
    if (results[2].status === 'fulfilled') setDiscovery(results[2].value);
    else setDiscovery(null);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(''); setNotice('');
    const key = name.trim().toUpperCase();
    if (!KEY_NAME.test(key)) { setError(tr('Använd ett namn som CUSTOM_API_KEY, med stora bokstäver, siffror och understreck.', 'Use a name like CUSTOM_API_KEY, with uppercase letters, digits and underscores.')); return; }
    if (!value.trim()) { setError(tr('Skriv nyckeln eller token som ska sparas.', 'Enter the key or token to store.')); return; }
    if (secrets?.some(secret => secret.name === key)) { setError(tr('Nyckeln finns redan. Befintliga nycklar skrivs inte över från det här formuläret.', 'The key already exists. Existing keys are not overwritten from this form.')); return; }
    setBusy('save');
    try {
      await fetch('/api/aura/workbench/secrets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: key, value: value.trim(), purpose: purpose.trim() || key }),
      }).then(readAuraResponse);
      setValue(''); setNotice(tr(`${key} sparades krypterad. Ingen extern API-anslutning är kontrollerad än.`, `${key} stored encrypted. No external API connection has been verified yet.`));
      await refresh();
      await onChanged?.();
    } catch (err: any) { setError(err?.message || tr('Nyckeln kunde inte sparas.', 'The key could not be saved.')); }
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
      setNotice(tr(`${key} kopierades till JACO:s krypterade kassaskåp. Originalet i Windows är oförändrat.`, `${key} copied to JACO's encrypted Vault. The original in Windows is unchanged.`));
      await refresh();
      await onChanged?.();
    } catch (err: any) { setError(`${tr('Import av', 'Import of')} ${key}: ${err?.message || tr('misslyckades', 'failed')}`); }
    finally { setBusy(''); }
  };

  const imported = new Set(secrets?.map(s => s.name) || []);
  return <section aria-label={tr('API och kassaskåp', 'API and Vault')}>
    <h3>{tr('API och kassaskåp', 'API & Vault')}</h3>
    <p>{tr('Samma krypterade nyckellager som JACO använder. Bara namn och status visas, aldrig nyckelvärden. Sparad betyder inte ansluten eller API-kontrollerad.', 'The same encrypted SecretStore the JACO runtime uses. Only names and status are shown, never key values. Stored does not mean connected or API-verified.')}</p>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <h4>{tr('Automatisk lokal anslutning', 'Automatic local connection')}</h4>
    {discovery ? <div>
      <p>{tr(`JACO har hittat ${discovery.configured.length} kända nyckelreferenser och ${discovery.localEnvFiles.length} lokala konfigurationsfiler. Nyckelvärden visas aldrig.`, `JACO has discovered ${discovery.configured.length} known credential references and ${discovery.localEnvFiles.length} local JACO configuration files. Key values are never shown.`)}</p>
      {discovery.configured.length ? <p>{tr('Inställt lokalt', 'Configured locally')}: {discovery.configured.map(item => item.name).join(', ')}.</p> : <p>{tr('Inga kända nycklar hittades. Lokala modellservrar och MCP-verktyg kan ändå ansluta utan API-nyckel.', 'No known keys were observed in the active runtime. Local model servers and MCP tools can still connect without an API key.')}</p>}
      <p>{tr('JACO kontrollerar modellistor och tillåtna MCP-verktyg automatiskt. Andra tjänster är bara inställda tills en godkänd adapter har testats. Kontrollen gör inga köp, överföringar eller publiceringar.', 'JACO verifies model catalogues and permitted MCP tools automatically. Other services are only configured until an authorised adapter has been tested. This check makes no purchases, transfers or publications.')}</p>
    </div> : <p>{tr('Ingen aktuell rapport. Kontrollera att JACO svarar.', 'No current discovery report. Check that the runtime is responding.')}</p>}
    <form onSubmit={e => void save(e)}>
      <h4>{tr('Lägg till en tjänstenyckel', 'Add a service key')}</h4>
      <label>{tr('Tjänst', 'Service')}
        <select aria-label={tr('Välj tjänst', 'Choose service')} value={EXAMPLES.some(x => x.name === name) ? name : ''} onChange={e => { setName(e.target.value); setPurpose(EXAMPLES.find(x => x.name === e.target.value)?.label || ''); }}>
          {EXAMPLES.map(x => <option key={x.label} value={x.name}>{language === 'sv' ? x.sv : x.label}</option>)}
        </select>
      </label>
      <label>{tr('Referens i kassaskåpet', 'Vault reference')}
        <input aria-label={tr('Referens i kassaskåpet', 'Vault reference')} value={name} onChange={e => setName(e.target.value.toUpperCase())} placeholder="MY_SERVICE_API_KEY" autoComplete="off" />
      </label>
      <label>{tr('API-nyckel / token', 'API key / token')}
        <input aria-label={tr('API-nyckel i kassaskåpet', 'API key in Vault')} type="password" value={value} onChange={e => setValue(e.target.value)} autoComplete="off" placeholder={tr('Klistra in hemligheten', 'Paste the secret')} />
      </label>
      <label>{tr('Beskrivning (valfri)', 'Description (optional)')}
        <input aria-label={tr('Beskrivning i kassaskåpet', 'Vault description')} value={purpose} onChange={e => setPurpose(e.target.value)} placeholder={tr('Vad tjänsten används till', 'What the service is used for')} />
      </label>
      <button type="submit" disabled={!!busy || !value.trim() || !KEY_NAME.test(name.trim())}> {busy === 'save' ? tr('Sparar…', 'Saving…') : tr('Spara i kassaskåpet', 'Save to Vault')} </button>
    </form>
    <h4>{tr('Sparat i JACO:s kassaskåp', 'Stored in JACO Vault')}</h4>
    {secrets === null ? <p>{tr('Statusen gick inte att kontrollera.', 'Status could not be verified.')}</p> : secrets.length === 0 ? <p>{tr('Inga nycklar finns i det krypterade lagret.', 'No keys observed in the encrypted store.')}</p> :
      secrets.map(secret => <article key={secret.name}>
        <strong>{secret.name}</strong> <span> {tr('Sparad · Inte API-kontrollerad', 'Stored · Not API-verified')}</span>
        {secret.purpose && <p>{secret.purpose}</p>}
        <small>{tr('Källa', 'Source')}: {secret.source || tr('okänd', 'unknown')}{secret.updatedAt ? ` · ${tr('Uppdaterad', 'Updated')} ${secret.updatedAt}` : ''}</small>
      </article>)}
    <h4>{tr('Äldre Windows-kassaskåp (DPAPI)', 'Legacy Windows Vault (DPAPI)')}</h4>
    {!windows ? <p>{tr('Kontrollerar Windows Credential Manager…', 'Checking Windows Credential Manager…')}</p> :
      !windows.available ? <p>{windows.reason === 'WINDOWS_ONLY' ? tr('Windows Credential Manager finns inte på den här enheten.', 'Windows Credential Manager is not available on this device.') : tr('Windows-kassaskåpet gick inte att kontrollera.', 'Windows Vault could not be checked.')}</p> :
      windows.keys.length === 0 ? <p>{tr('Inga JACO-nycklar hittades i Windows Credential Manager.', 'No JACO keys were found in Windows Credential Manager.')}</p> :
      <><p>{tr('Nycklar här kan importeras en och en. Inget raderas i Windows-kassaskåpet och inga befintliga JACO-nycklar skrivs över.', 'Keys here can be imported individually. Nothing is deleted from Windows Vault, and no existing JACO keys are overwritten.')}</p>
        {windows.keys.map(key => <article key={key}>
          <strong>{key}</strong> <span>{imported.has(key) ? tr('Finns redan i JACO:s kassaskåp', 'Already in JACO Vault') : tr('Bara i Windows-kassaskåpet', 'Windows Vault only')}</span>
          {!imported.has(key) && <button type="button" disabled={!!busy} onClick={() => void importWindows(key)}>
            {busy === key ? tr('Importerar…', 'Importing…') : tr('Importera till JACO', 'Import to JACO')}
          </button>}
        </article>)}</>}
    <button type="button" disabled={!!busy} onClick={() => void refresh()}>{tr('Kontrollera kassaskåpet igen', 'Check Vault again')}</button>
    <p>{tr('Kassaskåpet sparar nycklar. API-anrop, OAuth och externa skrivåtgärder kräver fortfarande en ansluten tjänsteadapter eller ett MCP-verktyg med rätt behörighet.', 'Vault stores credentials. API calls, OAuth and external write actions still need a connected service adapter or an MCP tool with the right permission.')}</p>
  </section>;
}
