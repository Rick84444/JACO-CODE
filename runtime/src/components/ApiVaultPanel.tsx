import { useUiLanguage } from '../i18n/UiLanguage';
import React, { useCallback, useEffect, useState } from 'react';
import { readAuraResponse } from '../lib/auraApi.mjs';

type Secret = { name: string; configured: boolean; purpose?: string; source?: string; updatedAt?: string };
type WindowsVault = { available: boolean; keys: string[]; reason?: string };
type Discovery = { localEnvFiles: string[]; localEnvImported: string[]; windowsModelLoaded: string[]; configured: Array<{ name: string; source: string; state: string }> };
const EXAMPLES = [
  { label: "Choose a service credential", name: '' },
  { label: 'Coinbase CDP — API key ID', name: 'CDP_API_KEY_ID' },
  { label: 'Coinbase CDP — API key secret', name: 'CDP_API_KEY_SECRET' },
  { label: 'Coinbase Commerce', name: 'COINBASE_COMMERCE_KEY' },
  { label: 'Cloudflare — API token', name: 'CLOUDFLARE_API_TOKEN' },
  { label: 'Stripe — API secret', name: 'STRIPE_SECRET_KEY' },
  { label: 'GitHub — personal access token', name: 'GITHUB_TOKEN' },
  { label: "Custom service", name: 'CUSTOM_API_KEY' },
];
const KEY_NAME = /^[A-Z][A-Z0-9_]{1,127}$/;

export function ApiVaultPanel({ onChanged }: { onChanged?: () => void | Promise<void> }) {
  const { t: uiText } = useUiLanguage();
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
    else { setSecrets(null); setError(uiText("JACO’s encrypted credential store could not be read.")); }
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
    if (!KEY_NAME.test(key)) { setError(uiText("Use a name such as CUSTOM_API_KEY, with uppercase letters, numbers and underscores.")); return; }
    if (!value.trim()) { setError(uiText("Enter the key or token to save.")); return; }
    if (secrets?.some(secret => secret.name === key)) { setError(uiText("This key already exists. This form does not replace existing keys.")); return; }
    setBusy('save');
    try {
      await fetch('/api/aura/workbench/secrets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: key, value: value.trim(), purpose: purpose.trim() || key }),
      }).then(readAuraResponse);
      setValue(''); setNotice(uiText("{0} saved with encryption. External API access has not been verified yet.", [key]));
      await refresh();
      await onChanged?.();
    } catch (err: any) { setError(err?.message || uiText("The key could not be saved.")); }
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
      setNotice(uiText("{0} copied to JACO’s encrypted credential store. The Windows original is preserved.", [key]));
      await refresh();
      await onChanged?.();
    } catch (err: any) { setError(uiText("Import of {0}: {1}", [key, err?.message || uiText("failed")])); }
    finally { setBusy(''); }
  };

  const imported = new Set(secrets?.map(s => s.name) || []);
  return <section aria-label={uiText("API and credentials")}>
    <h3>{uiText("API & credentials")}</h3>
    <p>{uiText("Manage JACO’s encrypted credentials. Only names and status are shown. Saved credentials still need a successful connection test.")}</p>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <h4>{uiText("Local connection discovery")}</h4>
    {discovery ? <div>
      <p>{uiText("JACO found")}{' '}{discovery.configured.length} {' '}{uiText("known credential references and")}{' '}{discovery.localEnvFiles.length} {' '}{uiText("local JACO configuration files. Credential values are never displayed.")}</p>
      {discovery.configured.length ? <p>{uiText("Configured locally:")}{' '}{discovery.configured.map(item => item.name).join(', ')}.</p> : <p>{uiText("No known keys were observed in the running system. Local models and tools can still connect without an API key.")}</p>}
      <p>{uiText("JACO checks model catalogs and permitted tools automatically. Other services remain configured until their connection has been tested. This check does not make purchases, transfers or publications.")}</p>
    </div> : <p>{uiText("No current discovery report. Check that JACO is running.")}</p>}
    <form onSubmit={e => void save(e)}>
      <h4>{uiText("Add a service key")}</h4>
      <label>{uiText("Service")}{' '}<select aria-label={uiText("Choose service")} value={EXAMPLES.some(x => x.name === name) ? name : ''} onChange={e => { setName(e.target.value); setPurpose(e.target.selectedOptions[0]?.text || ''); }}>
          {EXAMPLES.map(x => <option key={x.label} value={x.name}>{uiText(x.label)}</option>)}
        </select>
      </label>
      <label>{uiText("Credential name")}{' '}<input aria-label={uiText("Credential name")} value={name} onChange={e => setName(e.target.value.toUpperCase())} placeholder={uiText("MY_SERVICE_API_KEY")} autoComplete="off" />
      </label>
      <label>{uiText("API key / token")}{' '}<input aria-label={uiText("API key in credential store")} type="password" value={value} onChange={e => setValue(e.target.value)} autoComplete="off" placeholder={uiText("Paste the credential")} />
      </label>
      <label>{uiText("Description (optional)")}{' '}<input aria-label={uiText("Credential description")} value={purpose} onChange={e => setPurpose(e.target.value)} placeholder={uiText("What the service is used for")} />
      </label>
      <button type="submit" disabled={!!busy || !value.trim() || !KEY_NAME.test(name.trim())}> {busy === 'save' ? uiText("Saving…") : uiText("Save credential")} </button>
    </form>
    <h4>{uiText("Stored credentials")}</h4>
    {secrets === null ? <p>{uiText("Status could not be verified.")}</p> : secrets.length === 0 ? <p>{uiText("No keys observed in the encrypted credential store.")}</p> :
      secrets.map(secret => <article key={secret.name}>
        <strong>{secret.name}</strong> <span> {' '}{uiText("Stored · API access not verified")}</span>
        {secret.purpose && <p>{secret.purpose}</p>}
        <small>{uiText("Source:")}{' '}{secret.source || uiText("unknown")}{secret.updatedAt ? uiText(" · Updated {0}", [secret.updatedAt]) : ''}</small>
      </article>)}
    <h4>{uiText("Windows credentials (DPAPI)")}</h4>
    {!windows ? <p>{uiText("Checking Windows Credential Manager…")}</p> :
      !windows.available ? <p>{windows.reason === 'WINDOWS_ONLY' ? uiText("Windows Credential Manager is not available on this device.") : uiText("Windows credentials could not be checked.")}</p> :
      windows.keys.length === 0 ? <p>{uiText("No JACO keys found in Windows Credential Manager.")}</p> :
      <><p>{uiText("Import keys individually. The originals stay in Windows Credential Manager and existing JACO keys are preserved.")}</p>
        {windows.keys.map(key => <article key={key}>
          <strong>{key}</strong> <span>{imported.has(key) ? uiText("Already stored in JACO") : uiText("Windows credentials only")}</span>
          {!imported.has(key) && <button type="button" disabled={!!busy} onClick={() => void importWindows(key)}>
            {busy === key ? uiText("Importing…") : uiText("Import into JACO")}
          </button>}
        </article>)}</>}
    <button type="button" disabled={!!busy} onClick={() => void refresh()}>{uiText("Check credentials again")}</button>
    <p>{uiText("Credentials are stored here. API calls, OAuth and external changes require a connected service or tool with the appropriate permission.")}</p>
  </section>;
}
