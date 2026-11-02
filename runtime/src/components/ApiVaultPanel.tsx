import React, { useCallback, useEffect, useState } from 'react';
import { readAuraResponse } from '../lib/auraApi.mjs';

type Secret = { name: string; configured: boolean; purpose?: string; source?: string; updatedAt?: string };
type WindowsVault = { available: boolean; keys: string[]; reason?: string };
type Discovery = { localEnvFiles: string[]; localEnvImported: string[]; windowsModelLoaded: string[]; configured: Array<{ name: string; source: string; state: string }> };
const EXAMPLES = [
  { label: 'Choose a reference for a service', name: '' },
  { label: 'Coinbase CDP — API key ID', name: 'CDP_API_KEY_ID' },
  { label: 'Coinbase CDP — API key secret', name: 'CDP_API_KEY_SECRET' },
  { label: 'Coinbase Commerce', name: 'COINBASE_COMMERCE_KEY' },
  { label: 'Cloudflare — API token', name: 'CLOUDFLARE_API_TOKEN' },
  { label: 'Stripe — API secret', name: 'STRIPE_SECRET_KEY' },
  { label: 'GitHub — personal access token', name: 'GITHUB_TOKEN' },
  { label: 'Custom service', name: 'CUSTOM_API_KEY' },
];
const KEY_NAME = /^[A-Z][A-Z0-9_]{1,127}$/;

export function ApiVaultPanel({ onChanged }: { onChanged?: () => void | Promise<void> }) {
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
    else { setSecrets(null); setError("JACO's encrypted Vault could not be read."); }
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
    if (!KEY_NAME.test(key)) { setError('Use a name like CUSTOM_API_KEY, with uppercase letters, digits and underscores.'); return; }
    if (!value.trim()) { setError('Enter the key or token to store.'); return; }
    if (secrets?.some(secret => secret.name === key)) { setError('The key already exists. Existing keys are not overwritten from this form.'); return; }
    setBusy('save');
    try {
      await fetch('/api/aura/workbench/secrets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: key, value: value.trim(), purpose: purpose.trim() || key }),
      }).then(readAuraResponse);
      setValue(''); setNotice(`${key} stored encrypted. No external API connection has been verified yet.`);
      await refresh();
      await onChanged?.();
    } catch (err: any) { setError(err?.message || 'The key could not be saved.'); }
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
      setNotice(`${key} copied to JACO's encrypted Vault. The original in Windows is unchanged.`);
      await refresh();
      await onChanged?.();
    } catch (err: any) { setError(`Import of ${key}: ${err?.message || 'failed'}`); }
    finally { setBusy(''); }
  };

  const imported = new Set(secrets?.map(s => s.name) || []);
  return <section aria-label="API and Vault">
    <h3>API &amp; Vault</h3>
    <p>The same encrypted SecretStore the JACO runtime uses. Only names and status are shown, never key values. Stored does not mean connected or API-verified.</p>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <h4>Automatic local connection</h4>
    {discovery ? <div>
      <p>JACO has discovered {discovery.configured.length} known credential references and {discovery.localEnvFiles.length} local JACO configuration files. Key values are never shown.</p>
      {discovery.configured.length ? <p>Configured locally: {discovery.configured.map(item => item.name).join(', ')}.</p> : <p>No known keys were observed in the active runtime. Local model servers and MCP tools can still connect without an API key.</p>}
      <p>JACO verifies model catalogues and permitted MCP tools automatically. Other services are only configured until an authorised adapter has been tested. This check makes no purchases, transfers or publications.</p>
    </div> : <p>No current discovery report. Check that the runtime is responding.</p>}
    <form onSubmit={e => void save(e)}>
      <h4>Add a service key</h4>
      <label>Service
        <select aria-label="Choose service" value={EXAMPLES.some(x => x.name === name) ? name : ''} onChange={e => { setName(e.target.value); setPurpose(e.target.selectedOptions[0]?.text || ''); }}>
          {EXAMPLES.map(x => <option key={x.label} value={x.name}>{x.label}</option>)}
        </select>
      </label>
      <label>Vault reference
        <input aria-label="Vault reference" value={name} onChange={e => setName(e.target.value.toUpperCase())} placeholder="MY_SERVICE_API_KEY" autoComplete="off" />
      </label>
      <label>API key / token
        <input aria-label="API key in Vault" type="password" value={value} onChange={e => setValue(e.target.value)} autoComplete="off" placeholder="Paste the secret" />
      </label>
      <label>Description (optional)
        <input aria-label="Vault description" value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="What the service is used for" />
      </label>
      <button type="submit" disabled={!!busy || !value.trim() || !KEY_NAME.test(name.trim())}> {busy === 'save' ? 'Saving…' : 'Save to Vault'} </button>
    </form>
    <h4>Stored in JACO Vault</h4>
    {secrets === null ? <p>Status could not be verified.</p> : secrets.length === 0 ? <p>No keys observed in the encrypted store.</p> :
      secrets.map(secret => <article key={secret.name}>
        <strong>{secret.name}</strong> <span> Stored · Not API-verified</span>
        {secret.purpose && <p>{secret.purpose}</p>}
        <small>Source: {secret.source || 'unknown'}{secret.updatedAt ? ` · Updated ${secret.updatedAt}` : ''}</small>
      </article>)}
    <h4>Legacy Windows Vault (DPAPI)</h4>
    {!windows ? <p>Checking Windows Credential Manager…</p> :
      !windows.available ? <p>{windows.reason === 'WINDOWS_ONLY' ? 'Windows Credential Manager is not available on this device.' : 'Windows Vault could not be checked.'}</p> :
      windows.keys.length === 0 ? <p>No JACO keys were found in Windows Credential Manager.</p> :
      <><p>Keys here can be imported individually. Nothing is deleted from Windows Vault, and no existing JACO keys are overwritten.</p>
        {windows.keys.map(key => <article key={key}>
          <strong>{key}</strong> <span>{imported.has(key) ? 'Already in JACO Vault' : 'Windows Vault only'}</span>
          {!imported.has(key) && <button type="button" disabled={!!busy} onClick={() => void importWindows(key)}>
            {busy === key ? 'Importing…' : 'Import to JACO'}
          </button>}
        </article>)}</>}
    <button type="button" disabled={!!busy} onClick={() => void refresh()}>Check Vault again</button>
    <p>Vault stores credentials. API calls, OAuth and external write actions still need a connected service adapter or an MCP tool with the right permission.</p>
  </section>;
}
