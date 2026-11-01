import React, { useEffect, useState } from 'react';
import { wouldCompleteTrifecta } from '../lib/organizationRisk.mjs';
import { AURA_SPECIALISTS, provisionAuraSpecialists } from '../lib/auraSpecialistBlueprints.mjs';
import { Bot, BriefcaseBusiness, Check, ChevronRight, KeyRound, Plus, RefreshCw, ShieldAlert, ShieldCheck, Users, X } from 'lucide-react';

type Locale = 'en' | 'sv';
type Risk = 'low' | 'medium' | 'high' | 'locked';
type Exposure = 'untrusted' | 'private' | 'external';
type Permission = { label: string; risk: Risk; exposure: Exposure[] };
type Grant = { grantedBy: string; grantedAt: string; riskAcceptedAt?: string; expiresAt?: string };
type Model = { kind: 'local' | 'api'; providerId: string; model: string };
type Agent = {
  id: string; name: string; title: string; reportsTo: string; status: string; mail: string; task: string; goal: string;
  model: Model; mandate: {
    permissions: Record<string, Grant>; budgetUsdPerDay: number; maxSubAgents: number;
    autoApproveSubAgents: boolean; autonomy: number;
  };
  traits: Record<string, number>;
  effective: {
    permissions: string[]; budgetUsdPerDay: number; autonomy: number;
    traits: Record<string, number>;
    exposure: { untrusted: boolean; private: boolean; external: boolean; trifecta: boolean };
  };
};
type Organization = {
  operator: { id: string; title: string };
  agents: Agent[];
  catalog: {
    permissions: Record<string, Permission>;
    traits: Record<string, { label: string; capped: boolean }>;
    autonomy: Record<string, { name: string; role: string }>;
    grantDays: { default: number; max: number };
  };
};
type NewAgent = { name: string; title: string; reportsTo: string; task: string; goal: string; mail: string; providerId: string; model: string; kind: 'local' | 'api' };

const translations = {
  en: {
    title: 'Agent Organization', subtitle: 'Operator → Aura → delegated agents', refresh: 'Refresh',
    registry: 'Configuration only — runtime enforcement is not connected yet.',
    key: 'Operator approval credential', keyHint: 'Session only. Never saved by the browser.',
    select: 'Select an agent to manage its mandate.', noServer: 'Organization registry is not available.',
    create: 'Create agent', cancel: 'Cancel', save: 'Save', apply: 'Apply', approve: 'Approve agent',
    pause: 'Pause', resume: 'Resume', permissions: 'Permissions', autonomy: 'Autonomy level',
    budget: 'Daily cloud budget (USD)', maxAgents: 'Maximum direct hires', autoApprove: 'Auto-approve hires',
    profile: 'Profile', traits: 'Behavior limits', current: 'Effective', pending: 'Pending approval',
    expires: 'Expires', untrusted: 'Untrusted content', private: 'Private data', outbound: 'External actions',
    trifecta: 'Lethal trifecta detected. Every outbound action will require operator approval.',
    risk: 'This permission is high risk. Granting it requires operator approval.',
    blocked: 'Blocked by manager ceiling', locked: 'Payments always require your approval.',
    model: 'Model', manager: 'Reports to', email: 'Email', task: 'Task', goal: 'Goal',
    name: 'Name', role: 'Title', tools: 'Tools', agency: 'Agency', freedom: 'Freedom',
    rigor: 'Rigor', reporting: 'Reporting', active: 'active', paused: 'paused',
    profileSaved: 'Profile saved', permissionSaved: 'Mandate updated',
    credentialNeeded: 'Enter your operator credential before changing the organization.',
    noExecution: 'These settings do not yet restrict Nova, MCP, chat, email or external processes.',
    teamTitle: 'Aura specialist team', teamInstall: 'Create four specialists',
    teamPreview: 'Research, architecture, debugging and user acceptance. Each agent starts at L1 with zero budget, zero permissions and no active model execution.',
    teamConfirm: 'Create four agent records under Aura? This changes the local organization register but does not start any worker or grant access.',
    teamCreated: 'Specialists registered', teamExists: 'All four specialists already exist.',
    teamPartial: 'A partial failure may have registered some agents; refresh the organization and retry safely.',
  },
  sv: {
    title: 'Agentorganisation', subtitle: 'Operatör → Aura → underagenter', refresh: 'Uppdatera',
    registry: 'Endast konfiguration — kontroll i runtime är ännu inte inkopplad.',
    key: 'Operatörens godkännandenyckel', keyHint: 'Endast under denna session. Sparas aldrig i webbläsaren.',
    select: 'Välj en agent för att hantera mandatet.', noServer: 'Organisationsregistret är inte tillgängligt.',
    create: 'Skapa agent', cancel: 'Avbryt', save: 'Spara', apply: 'Tillämpa', approve: 'Godkänn agent',
    pause: 'Pausa', resume: 'Återuppta', permissions: 'Befogenheter', autonomy: 'Autonominivå',
    budget: 'Daglig molnbudget (USD)', maxAgents: 'Max antal underagenter', autoApprove: 'Autogodkänn underagenter',
    profile: 'Profil', traits: 'Beteendegränser', current: 'Effektiv', pending: 'Väntar på godkännande',
    expires: 'Går ut', untrusted: 'Okänt innehåll', private: 'Privata data', outbound: 'Externa åtgärder',
    trifecta: 'Den dödliga trion uppstår. Varje utgående åtgärd kräver operatörsgodkännande.',
    risk: 'Den här befogenheten har hög risk och kräver operatörens godkännande.',
    blocked: 'Blockerad av chefens mandat', locked: 'Betalningar kräver alltid ditt godkännande.',
    model: 'Modell', manager: 'Rapporterar till', email: 'E-post', task: 'Uppgift', goal: 'Mål',
    name: 'Namn', role: 'Titel', tools: 'Verktyg', agency: 'Agentisk', freedom: 'Frihet',
    rigor: 'Noggrannhet', reporting: 'Rapportering', active: 'aktiv', paused: 'pausad',
    profileSaved: 'Profil sparad', permissionSaved: 'Mandat uppdaterat',
    credentialNeeded: 'Ange operatörsnyckeln innan du ändrar organisationen.',
    noExecution: 'Inställningarna begränsar ännu inte Nova, MCP, chatt, e-post eller externa processer.',
    teamTitle: 'Auras specialistteam', teamInstall: 'Skapa fyra specialister',
    teamPreview: 'Omvärldsanalys, arkitektur, felsökning och användartest. Alla startar på L1 med noll budget, inga behörigheter och utan att någon modell startas.',
    teamConfirm: 'Skapa fyra agenter under Aura? Detta ändrar det lokala organisationsregistret men startar inga arbetare eller tilldelar åtkomst.',
    teamCreated: 'Specialister registrerade', teamExists: 'Alla fyra specialister finns redan.',
    teamPartial: 'Några agenter kan ha registrerats innan felet. Uppdatera organisationen och försök igen.',
  },
} as const;

const emptyAgent: NewAgent = { name: '', title: '', reportsTo: 'aura', task: '', goal: '', mail: '', kind: 'local', providerId: 'ollama', model: '' };
const inputClass = 'w-full rounded-md border border-[#284359] bg-[#07131e] px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500';
const buttonClass = 'rounded-md border border-[#284359] px-3 py-2 text-xs font-medium text-slate-200 hover:border-cyan-600 disabled:opacity-40';
const dateText = (value?: string) => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleDateString() : '—';

export function AuraOrganizationPanel() {
  const [locale, setLocale] = useState<Locale>('en');
  const t = translations[locale];
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [selectedId, setSelectedId] = useState('aura');
  const [operatorKey, setOperatorKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState<NewAgent>(emptyAgent);
  const [grantDays, setGrantDays] = useState(30);
  const [profile, setProfile] = useState({ name: '', title: '', task: '', goal: '', mail: '', kind: 'local' as 'local' | 'api', providerId: 'ollama', model: '' });
  const [traitDraft, setTraitDraft] = useState<Record<string, number>>({});
  const [budgetDraft, setBudgetDraft] = useState('0');
  const [hiresDraft, setHiresDraft] = useState('0');

  async function api(method: string, suffix = '', body?: unknown) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (method !== 'GET') headers['x-jaco-operator-token'] = operatorKey;
    const response = await fetch('/api/aura/organization' + suffix, {
      method, headers, cache: 'no-store', credentials: 'same-origin',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || result.success === false) {
      throw new Error(String(result?.error || 'ORGANIZATION_HTTP_' + response.status));
    }
    return result;
  }
  async function refresh() {
    try {
      const result = await api('GET');
      setOrganization(result.organization as Organization);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  useEffect(() => { void refresh(); }, []);

  const agents = organization?.agents || [];
  const selected = agents.find(agent => agent.id === selectedId) || agents.find(agent => agent.id === 'aura') || null;
  useEffect(() => {
    if (!selected) return;
    setProfile({
      name: selected.name, title: selected.title, task: selected.task, goal: selected.goal, mail: selected.mail,
      kind: selected.model.kind, providerId: selected.model.providerId, model: selected.model.model,
    });
    setTraitDraft({ ...selected.traits });
    setBudgetDraft(String(selected.mandate.budgetUsdPerDay));
    setHiresDraft(String(selected.mandate.maxSubAgents));
  }, [selected?.id, organization]);

  async function mutate(suffix: string, method: string, body: unknown, success?: string) {
    if (!operatorKey.trim()) { setError(t.credentialNeeded); return false; }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(method, suffix, body);
      await refresh();
      setNotice(success || 'Saved');
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally { setBusy(false); }
  }

  async function changePermission(key: string, permission: Permission) {
    if (!selected) return;
    const granted = Boolean(selected.mandate.permissions[key]);
    if (!granted) {
      const warning = [permission.risk === 'high' ? t.risk : '', wouldCompleteTrifecta(selected.effective.permissions, organization!.catalog.permissions, key) ? t.trifecta : ''].filter(Boolean).join('\n\n');
      if (warning && !window.confirm(warning)) return;
    }
    await mutate('/agents/' + encodeURIComponent(selected.id) + '/permissions/' + encodeURIComponent(key), 'PUT',
      { granted: !granted, acceptRisk: !granted && permission.risk === 'high', days: grantDays }, t.permissionSaved);
  }
  async function saveProfile() {
    if (!selected) return;
    await mutate('/agents/' + encodeURIComponent(selected.id), 'PATCH', {
      name: profile.name, title: profile.title, task: profile.task, goal: profile.goal, mail: profile.mail,
      model: { kind: profile.kind, providerId: profile.providerId, model: profile.model },
    }, t.profileSaved);
  }
  async function createAgent() {
    const success = await mutate('/agents', 'POST', {
      name: draft.name, title: draft.title, reportsTo: draft.reportsTo, task: draft.task, goal: draft.goal, mail: draft.mail,
      model: { kind: draft.kind, providerId: draft.providerId, model: draft.model },
    });
    if (success) { setShowCreate(false); setDraft(emptyAgent); }
  }
  async function installSpecialists() {
    if (!operatorKey.trim()) { setError(t.credentialNeeded); return; }
    if (!window.confirm(t.teamConfirm)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await provisionAuraSpecialists({
        readAgents: async () => (await api('GET')).organization.agents as Agent[],
        createAgent: async definition => { await api('POST', '/agents', definition); },
      });
      await refresh();
      setNotice(result.created.length ? t.teamCreated + ': ' + result.created.join(', ') : t.teamExists);
    } catch (cause) {
      await refresh();
      setError((cause instanceof Error ? cause.message : String(cause)) + '. ' + t.teamPartial);
    } finally { setBusy(false); }
  }
  const managers = (parent: string) => agents.filter(agent => agent.reportsTo === parent);
  const branch = (parent: string, depth = 0): React.ReactNode => managers(parent).map(agent => (
    <React.Fragment key={agent.id}>
      <button type="button" onClick={() => setSelectedId(agent.id)}
        className={'w-full rounded-lg border px-3 py-3 text-left transition-colors ' + (selected?.id === agent.id ? 'border-cyan-600 bg-[#102b3b]' : 'border-[#284359] bg-[#0a1622] hover:border-[#48728e]')}
        style={{ marginLeft: Math.min(depth, 4) * 12, width: 'calc(100% - ' + Math.min(depth, 4) * 12 + 'px)' }}>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#41627a] bg-[#18364a] text-xs font-bold text-cyan-100">{agent.id === 'aura' ? <Bot size={18}/> : agent.name.slice(0, 2).toUpperCase()}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{agent.name}</span>
            <span className="block truncate text-xs text-slate-400">{agent.title || 'Agent'} · L{agent.effective.autonomy}</span>
          </span>
          <span className={'rounded px-2 py-1 text-[10px] ' + (agent.status === 'active' ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-300')}>{agent.status}</span>
          <ChevronRight size={14} className="text-slate-500"/>
        </div>
      </button>
      {branch(agent.id, depth + 1)}
    </React.Fragment>
  ));

  return <section aria-label="Agent organization" data-testid="aura-organization" className="h-full min-h-0 overflow-auto bg-[#030b12] p-3 text-slate-100 sm:p-5">
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-wrap items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-800 bg-cyan-950/30"><Users className="text-cyan-300"/></div>
        <div className="flex-1"><h2 className="text-xl font-semibold">{t.title}</h2><p className="text-xs text-slate-400">{t.subtitle}</p></div>
        <select aria-label="Interface language" className={inputClass + ' !w-auto'} value={locale} onChange={e => setLocale(e.target.value as Locale)}><option value="en">English</option><option value="sv">Svenska</option></select>
        <button className={buttonClass + ' flex items-center gap-2'} type="button" onClick={() => void refresh()}><RefreshCw size={14}/>{t.refresh}</button>
      </header>

      <div className="rounded-lg border border-amber-900/70 bg-amber-950/20 p-3 text-xs text-amber-200" role="status">
        <div className="flex items-center gap-2 font-semibold"><ShieldAlert size={16}/>{t.registry}</div>
        <p className="mt-1 opacity-90">{t.noExecution}</p>
      </div>
      <label className="block rounded-lg border border-[#284359] bg-[#091723] p-3 text-sm">
        <span className="mb-2 flex items-center gap-2 font-medium"><KeyRound size={15}/>{t.key}</span>
        <input aria-label={t.key} type="password" autoComplete="off" value={operatorKey} onChange={e => setOperatorKey(e.target.value)} className={inputClass} placeholder="JACO_ORG_OPERATOR_TOKEN"/>
        <span className="mt-1 block text-[11px] text-slate-400">{t.keyHint}</span>
      </label>
      {error && <div role="alert" className="rounded-md border border-red-900 bg-red-950/30 px-3 py-2 text-xs text-red-200">{error}</div>}
      {notice && <div role="status" className="rounded-md border border-emerald-900 px-3 py-2 text-xs text-emerald-300">{notice}</div>}

      {!organization ? <p className="text-sm text-slate-400">{t.noServer}</p> :
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(240px,0.8fr)_minmax(360px,1.3fr)]">
        <aside className="space-y-3 rounded-xl border border-[#284359] bg-[#08131f] p-3">
          <div className="flex items-center gap-2 rounded-lg border border-[#35546b] bg-[#122233] px-3 py-3">
            <BriefcaseBusiness className="text-cyan-300" size={19}/>
            <span className="flex-1"><strong className="block text-sm">Operator</strong><span className="text-xs text-slate-400">CEO · final authority</span></span>
            <ShieldCheck size={15} className="text-emerald-400"/>
          </div>
          {branch('operator')}
          <section aria-label="Aura specialist team" className="space-y-2 rounded-lg border border-cyan-900/60 bg-[#0b1e2b] p-3">
            <h3 className="text-sm font-semibold text-cyan-200">{t.teamTitle}</h3>
            <p className="text-xs text-slate-400">{t.teamPreview}</p>
            <div className="space-y-1">
              {AURA_SPECIALISTS.map(agent => <div key={agent.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{agent.name}</span>
                <span className="shrink-0 text-slate-500">{agents.some(row => row.id === agent.id) ? 'Registered' : 'Not registered'}</span>
              </div>)}
            </div>
            <button data-testid="create-aura-specialists" type="button" disabled={busy} onClick={() => void installSpecialists()} className={buttonClass + ' w-full'}>{t.teamInstall}</button>
          </section>
          <button type="button" disabled={busy} onClick={() => setShowCreate(value => !value)} className={buttonClass + ' flex w-full items-center justify-center gap-2'}><Plus size={15}/>{t.create}</button>
          {showCreate && <div className="space-y-2 rounded-lg border border-[#284359] p-3">
            {(['name','title','task','goal','mail','model','providerId'] as const).map(field => <label key={field} className="block text-xs text-slate-400">{field === 'title' ? t.role : field === 'mail' ? t.email : field === 'task' ? t.task : field === 'goal' ? t.goal : field === 'model' ? t.model : field === 'name' ? t.name : 'Provider ID'}
              <input className={inputClass} value={draft[field]} onChange={e => setDraft(current => ({ ...current, [field]: e.target.value }))}/>
            </label>)}
            <label className="block text-xs text-slate-400">{t.manager}
              <select className={inputClass} value={draft.reportsTo} onChange={e => setDraft(current => ({ ...current, reportsTo: e.target.value }))}>{agents.filter(a => a.status === 'active').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            </label>
            <label className="block text-xs text-slate-400">Model runtime
              <select className={inputClass} value={draft.kind} onChange={e => setDraft(current => ({ ...current, kind: e.target.value as 'local'|'api' }))}><option value="local">Local</option><option value="api">API</option></select>
            </label>
            <div className="flex gap-2"><button disabled={busy || !draft.name.trim()} onClick={() => void createAgent()} className={buttonClass}>{t.create}</button><button onClick={() => setShowCreate(false)} className={buttonClass}>{t.cancel}</button></div>
          </div>}
        </aside>

        {selected ? <div className="space-y-4">
          <div className="rounded-xl border border-[#284359] bg-[#08131f] p-4">
            <div className="flex flex-wrap items-start gap-2">
              <div className="flex-1"><h3 className="text-lg font-semibold">{selected.name}</h3><p className="text-xs text-slate-400">{selected.title || 'Agent'} · {selected.id} · {selected.status}</p></div>
              {selected.status === 'pending' && <button disabled={busy} onClick={() => void mutate('/agents/' + selected.id + '/approve', 'POST', {})} className={buttonClass + ' flex items-center gap-1'}><Check size={14}/>{t.approve}</button>}
              {selected.status === 'active' && <button disabled={busy} onClick={() => void mutate('/agents/' + selected.id + '/pause', 'POST', {})} className={buttonClass}>{t.pause}</button>}
              {selected.status === 'paused' && <button disabled={busy} onClick={() => void mutate('/agents/' + selected.id + '/resume', 'POST', {})} className={buttonClass}>{t.resume}</button>}
            </div>
            {selected.effective.exposure.trifecta && <p className="mt-3 rounded-md border border-amber-700 px-3 py-2 text-xs text-amber-200"><ShieldAlert size={14} className="mr-1 inline"/>{t.trifecta}</p>}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(['untrusted','private','external'] as const).map((kind, i) => <span key={kind} className={'rounded-md border px-2 py-2 text-xs ' + (selected.effective.exposure[kind] ? 'border-amber-700 text-amber-200' : 'border-[#284359] text-slate-500')}>{[t.untrusted,t.private,t.outbound][i]}: {selected.effective.exposure[kind] ? 'YES' : 'NO'}</span>)}
            </div>
          </div>

          <div className="rounded-xl border border-[#284359] bg-[#08131f] p-4">
            <h4 className="mb-3 text-sm font-semibold">{t.profile}</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['name','title','mail','task','goal','providerId','model'] as const).map(field => <label key={field} className="block text-xs text-slate-400">{field === 'title' ? t.role : field === 'mail' ? t.email : field === 'task' ? t.task : field === 'goal' ? t.goal : field === 'model' ? t.model : field === 'name' ? t.name : 'Provider ID'}
                <input className={inputClass} value={profile[field]} onChange={e => setProfile(current => ({ ...current, [field]: e.target.value }))}/>
              </label>)}
              <label className="block text-xs text-slate-400">Model runtime<select className={inputClass} value={profile.kind} onChange={e => setProfile(current => ({ ...current, kind: e.target.value as 'local'|'api' }))}><option value="local">Local</option><option value="api">API</option></select></label>
            </div>
            <button className={buttonClass + ' mt-3'} disabled={busy || !profile.name.trim()} onClick={() => void saveProfile()}>{t.save}</button>
          </div>

          <div className="rounded-xl border border-[#284359] bg-[#08131f] p-4">
            <h4 className="mb-3 text-sm font-semibold">{t.permissions}</h4>
            <label className="mb-3 block text-xs text-slate-400">High-risk grant duration (days, maximum 90)
              <input className={inputClass + ' !w-24'} type="number" min={1} max={90} value={grantDays} onChange={e => setGrantDays(Math.max(1, Math.min(90, Number(e.target.value) || 1)))}/>
            </label>
            <div className="space-y-1">
              {(Object.entries(organization.catalog.permissions) as [string, Permission][]).map(([key, permission]) => {
                const grant = selected.mandate.permissions[key];
                const parent = agents.find(agent => agent.id === selected.reportsTo);
                const cap = !parent || parent.effective.permissions.includes(key);
                const enabled = Boolean(grant);
                return <label key={key} className="flex items-start gap-3 rounded-lg border border-[#1c3445] p-3 text-xs">
                  <input aria-label={key} type="checkbox" className="mt-0.5 accent-cyan-500" checked={enabled} disabled={busy || permission.risk === 'locked' || (!cap && !enabled)}
                    onChange={() => void changePermission(key, permission)}/>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{permission.label}</span>
                    <span className="block text-slate-500">{key} · {permission.exposure.join(' / ') || 'local only'}</span>
                    {!cap && <span className="block text-amber-300">{t.blocked}</span>}
                    {grant?.expiresAt && <span className="block text-amber-300">{t.expires}: {dateText(grant.expiresAt)}</span>}
                    {permission.risk === 'locked' && <span className="block text-amber-300">{t.locked}</span>}
                  </span>
                  <span className={'rounded px-2 py-1 text-[10px] uppercase ' + (permission.risk === 'high' || permission.risk === 'locked' ? 'bg-amber-950 text-amber-300' : 'bg-[#1b3343] text-slate-300')}>{permission.risk}</span>
                </label>;
              })}
            </div>
          </div>

          <div className="rounded-xl border border-[#284359] bg-[#08131f] p-4">
            <h4 className="mb-3 text-sm font-semibold">{t.autonomy}</h4>
            <select aria-label={t.autonomy} className={inputClass} value={selected.mandate.autonomy}
              disabled={busy} onChange={e => {
                const level = Number(e.target.value);
                if (level >= 4 && !window.confirm('Grant higher autonomy (L' + level + ')?')) return;
                void mutate('/agents/' + selected.id + '/limits', 'PATCH', { autonomy: level });
              }}>
              {(Object.entries(organization.catalog.autonomy) as [string, {name: string; role: string}][]).map(([level, details]) => <option key={level} value={level}>L{level} — {details.name}</option>)}
            </select>
            <p className="mt-2 text-xs text-slate-400">{t.current}: L{selected.effective.autonomy}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-400">{t.budget}
                <input type="number" min={0} max={1000} step="0.01" className={inputClass} value={budgetDraft} onChange={e => setBudgetDraft(e.target.value)}/>
                <span className="block text-[11px]">{t.current}: ${selected.effective.budgetUsdPerDay} USD</span>
                <button disabled={busy} onClick={() => void mutate('/agents/' + selected.id + '/limits', 'PATCH', { budgetUsdPerDay: Number(budgetDraft) })} className={buttonClass + ' mt-1'}>{t.apply}</button>
              </label>
              <label className="text-xs text-slate-400">{t.maxAgents}
                <input type="number" min={0} max={50} step={1} className={inputClass} value={hiresDraft} onChange={e => setHiresDraft(e.target.value)}/>
                <button disabled={busy} onClick={() => void mutate('/agents/' + selected.id + '/limits', 'PATCH', { maxSubAgents: Number(hiresDraft) })} className={buttonClass + ' mt-1'}>{t.apply}</button>
              </label>
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={selected.mandate.autoApproveSubAgents} disabled={busy} onChange={e => {
              if (e.target.checked && !window.confirm('Allow automatic approval of new agents within this ceiling?')) return;
              void mutate('/agents/' + selected.id + '/limits', 'PATCH', { autoApproveSubAgents: e.target.checked });
            }}/>{t.autoApprove}</label>
          </div>

          <div className="rounded-xl border border-[#284359] bg-[#08131f] p-4">
            <h4 className="mb-3 text-sm font-semibold">{t.traits}</h4>
            {(Object.entries(organization.catalog.traits) as [string, {label: string; capped: boolean}][]).map(([key, trait]) => <div key={key} className="mb-3">
              <div className="mb-1 flex justify-between text-xs"><label htmlFor={'trait-' + key}>{trait.label}{trait.capped ? ' · capped by manager' : ''}</label><strong>{traitDraft[key] ?? selected.traits[key]}%</strong></div>
              <div className="flex items-center gap-2">
                <input id={'trait-' + key} type="range" min={0} max={100} step={1}
                  disabled={busy} value={traitDraft[key] ?? selected.traits[key]} className="w-full accent-cyan-500"
                  onChange={e => setTraitDraft(current => ({ ...current, [key]: Number(e.target.value) }))}/>
                <button disabled={busy || (traitDraft[key] ?? selected.traits[key]) === selected.traits[key]}
                  onClick={() => void mutate('/agents/' + selected.id + '/traits', 'PATCH', { [key]: traitDraft[key] })}
                  className={buttonClass}>{t.apply}</button>
              </div>
              <p className="text-[11px] text-slate-500">{t.current}: {selected.effective.traits[key]}%</p>
            </div>)}
          </div>
        </div> : <p>{t.select}</p>}
      </div>}
    </div>
  </section>;
}
