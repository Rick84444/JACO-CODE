// The structured start of JACO on the Operator Stage: five steps, each ticked from what the runtime reports.
// 1 start the API, 2 an AI brain (cloud key or local model), 3 fetch from the vault, 4 connect the provider,
// 5 activate everything. Uses only the endpoints the IDE already uses; no secret value is ever displayed or kept here.
import { setupSteps, suggestModel, plausibleKey, vaultRows } from '/setup-steps.mjs';

const sv = (navigator.language || '').toLowerCase().startsWith('sv');
const t = (swedish, english) => (sv ? swedish : english);
const $ = id => document.getElementById(id);

const TITLES = {
  api: t('Starta JACO', 'Start JACO'),
  brain: t('AI-hjärna: moln eller lokal', 'AI brain: cloud or local'),
  vault: t('Hämta från vault', 'Fetch from the vault'),
  provider: t('Koppla provider', 'Connect the provider'),
  activate: t('Aktivera hela systemet', 'Activate the whole system'),
};

// "Skip" is remembered in this browser, so a finished setup does not reopen on every visit.
function remembered(key) { try { return localStorage.getItem(key); } catch { return null; } }
function remember(key, value) { try { localStorage.setItem(key, value); } catch { /* private window: asked again next time */ } }

const state = { report: null, error: '', vault: null, providers: [], catalog: [], skippedVault: remembered('jaco.setup.skipVault') === '1', busy: '', message: '', open: false, view: null, local: false };

const get = (url, ms = 30000) => fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(ms) }).then(r => r.json()).catch(() => null);
const post = async (url, body, ms = 45000) => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(ms) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.success !== false, status: res.status, data };
};

export async function refresh() {
  // A slow computer can need a minute to answer: that is "checking", not "JACO is not running".
  state.checking = true; if (state.open) render();
  const [activation, windows, discovery, models, catalog] = await Promise.all([
    get('/api/jaco/activation', 150000), get('/api/aura/workbench/vault/windows', 90000), get('/api/aura/workbench/vault/discovery', 90000),
    get('/api/aura/chat/models', 90000), get('/api/aura/workbench/providers/catalog', 90000),
  ]);
  state.checking = false;
  state.report = activation?.success ? activation.report : null;
  state.error = state.report ? '' : 'unreachable';
  state.vault = windows?.available ? { available: true, keys: windows.keys || [], fetched: windows.fetched || [], configured: (discovery?.configured || []).map(c => c.name) } : { available: false, keys: [], fetched: [], configured: [] };
  state.providers = Array.isArray(models?.providers) ? models.providers : [];
  state.catalog = (catalog?.providers || []).map(p => p.id);
  render();
  return setupSteps({ report: state.report, error: state.error, vault: state.vault, skippedVault: state.skippedVault });
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value; else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child != null && child !== false) node.append(child.nodeType ? child : document.createTextNode(String(child)));
  return node;
}
const button = (label, onclick, { primary = false, disabled = false } = {}) => el('button', { type: 'button', class: primary ? 'primary' : '', onclick, disabled }, label);

async function act(name, work) {
  if (state.busy) return;
  state.busy = name; state.message = ''; render();
  try { await work(); } catch (error) { state.message = String(error?.message || error); }
  state.busy = ''; await refresh();
}

const explainKey = code => ({
  KEY_REJECTED: t('Tjänsten sa nej till nyckeln. Kontrollera att du kopierade hela nyckeln.', 'The service did not accept the key. Check that you copied all of it.'),
  UNREACHABLE: t('Ingen kontakt med tjänsten. Kontrollera internetanslutningen.', 'No contact with the service. Check your internet connection.'),
  AMBIGUOUS: t('Nyckeln passar flera tjänster. Välj tjänst i listan och försök igen.', 'The key fits several services. Pick the service in the list and try again.'),
  UNKNOWN_KEY: t('Nyckeln känns inte igen. Välj tjänst i listan och försök igen.', 'The key is not recognised. Pick the service in the list and try again.'),
}[code] || t('Något gick fel. Försök igen om en stund.', 'Something went wrong. Try again in a moment.'));

// --- Step panels ---
function apiPanel() {
  return el('div', {}, el('p', {}, state.checking
    ? t('Kontrollerar att JACO svarar. På en upptagen dator kan det ta upp till en minut…', 'Checking that JACO answers. On a busy computer this can take up to a minute…')
    : state.error
      ? t('JACO svarar inte än. Starta det på datorn (kommandot "npm run jaco:start" eller programmet JACO) och kontrollera igen.', 'JACO does not answer yet. Start it on this computer (the command "npm run jaco:start", or the JACO app) and check again.')
      : t('Kontrollerar att JACO svarar…', 'Checking that JACO answers…')), button(t('Kontrollera igen', 'Check again'), () => act('api', async () => {}), { primary: true, disabled: Boolean(state.busy || state.checking) }));
}

// The key field and the service list live as long as the page: a status check redraws the panel while the
// operator is typing, and a new field would drop what was typed. The value is only ever in the field itself.
let keyFields = null;
function keyControls() {
  keyFields ??= {
    key: el('input', { type: 'password', autocomplete: 'off', placeholder: t('Klistra in din nyckel', 'Paste your key'), 'aria-label': t('API-nyckel', 'API key') }),
    which: el('select', { 'aria-label': t('Tjänst', 'Service') }),
  };
  const { which } = keyFields;
  if (which.options.length !== state.catalog.length + 1) {
    const chosen = which.value;
    which.replaceChildren(el('option', { value: '' }, t('Känn igen från nyckeln', 'Detect from the key')), ...state.catalog.map(id => el('option', { value: id }, id)));
    which.value = state.catalog.includes(chosen) ? chosen : '';
  }
  return keyFields;
}

function brainPanel() {
  const suggestion = suggestModel(state.providers), localOk = state.providers.some(p => p.local && p.credentialReady !== false && p.models?.length);
  const { key, which } = keyControls();
  const connect = () => act('key', async () => {
    if (!plausibleKey(key.value)) throw new Error(t('Det där ser inte ut som en nyckel.', 'That does not look like a key.'));
    const r = await post('/api/aura/workbench/providers/key', { key: key.value.trim(), ...(which.value ? { provider: which.value } : {}) });
    if (!r.ok || r.data.result?.state !== 'READY') throw new Error(explainKey(r.data.result?.state));
    key.value = '';
    state.message = t('Nyckeln fungerar och är sparad krypterad.', 'The key works and is stored encrypted.');
  });
  return el('div', {},
    el('p', {}, t('JACO tänker med en AI-modell. Välj hur:', 'JACO thinks with an AI model. Choose how:')),
    el('div', { class: 'setup-choice' },
      el('div', { class: 'setup-option' }, el('strong', {}, t('Lokal modell (inget lämnar datorn)', 'Local model (nothing leaves your computer)')),
        el('p', {}, localOk ? t('En lokal modell hittades. Den är gratis och privat.', 'A local model was found. It is free and private.')
          : t('Ingen lokal modell hittades. Installera Ollama (ollama.com), hämta en modell och kontrollera igen.', 'No local model found. Install Ollama (ollama.com), pull a model and check again.')),
        localOk ? button(t('Använd lokal modell', 'Use the local model'), () => { state.local = true; state.message = t('Lokal modell vald. Nästa steg kopplar den.', 'Local model chosen. The next step connects it.'); render(); }, { primary: true }) : button(t('Sök igen', 'Look again'), () => act('scan', async () => {}))),
      el('div', { class: 'setup-option' }, el('strong', {}, t('Molnmodell med nyckel', 'Cloud model with a key')),
        el('p', {}, t('Till exempel Gemini (gratis nivå) från aistudio.google.com/apikey. Nyckeln sparas krypterad på din dator.', 'For example Gemini (free tier) from aistudio.google.com/apikey. The key is stored encrypted on your computer.')),
        which, key, button(t('Koppla in nyckeln', 'Connect the key'), connect, { primary: true, disabled: Boolean(state.busy) }))),
    suggestion && !state.report?.providers?.some(p => p.active) ? el('p', { class: 'setup-hint' }, t('Redan tillgängligt: ', 'Already available: '), `${suggestion.provider} / ${suggestion.model}`) : null);
}

function vaultPanel() {
  const rows = vaultRows(state.vault), pending = rows.filter(row => row.state === 'PENDING').map(row => row.name);
  const fetch1 = async name => {
    const r = await post('/api/aura/workbench/vault/import-windows', { name });
    return r.ok || r.data.error === 'SECRET_ALREADY_EXISTS';
  };
  const fetchSome = names => async () => {
    const failed = [];
    for (const name of names) if (!(await fetch1(name).catch(() => false))) failed.push(name);
    if (failed.length) throw new Error(t('Kunde inte hämta: ', 'Could not fetch: ') + failed.join(', '));
    state.message = t(`Hämtat: ${names.join(', ')}`, `Fetched: ${names.join(', ')}`);
  };
  const labels = { FETCHED: t('✓ Hämtad', '✓ Fetched'), PRESENT: t('✓ Finns redan', '✓ Already set') };
  const list = rows.map(({ name, state: held }) => el('li', { class: held === 'PENDING' ? 'pending' : 'held' }, el('code', {}, name), ' ',
    held === 'PENDING' ? button(t('Hämta', 'Fetch'), () => act('vault-' + name, fetchSome([name])), { disabled: Boolean(state.busy) }) : el('span', { class: 'held-mark' }, labels[held])));
  const summary = !rows.length ? t('Inga sparade nycklar hittades i Windows-valvet.', 'No saved keys were found in the Windows vault.')
    : !pending.length ? t(`Alla ${rows.length} nycklar är hämtade.`, `All ${rows.length} keys are fetched.`)
    : t(`${rows.length - pending.length} av ${rows.length} nycklar är hämtade.`, `${rows.length - pending.length} of ${rows.length} keys are fetched.`);
  return el('div', {},
    el('p', {}, t('Sparade nycklar i Windows-valvet kan hämtas in i JACO:s egna krypterade förvar. Värdena visas aldrig.', 'Credentials saved in the Windows vault can be fetched into JACO\'s own encrypted store. The values are never shown.')),
    el('p', { class: 'setup-hint', role: 'status' }, summary),
    rows.length ? el('ul', { class: 'setup-list' }, list) : null,
    pending.length ? el('div', { class: 'setup-row' }, button(t('Hämta alla', 'Fetch all'), () => act('vault-all', fetchSome(pending)), { primary: true, disabled: Boolean(state.busy) }),
      button(t('Hoppa över', 'Skip'), () => { state.skippedVault = true; remember('jaco.setup.skipVault', '1'); state.view = null; render(); refresh(); })) : null);
}

function providerPanel() {
  const usable = state.providers.filter(p => p.credentialReady !== false && p.models?.length);
  const preferred = state.local ? usable.find(p => p.local) : null;
  const suggestion = (preferred && { provider: preferred.id, model: preferred.defaultModel && preferred.models.includes(preferred.defaultModel) ? preferred.defaultModel : preferred.models[0] }) || suggestModel(usable);
  const prov = el('select', { 'aria-label': t('Tjänst', 'Service') }, ...usable.map(p => el('option', { value: p.id, selected: p.id === suggestion?.provider }, `${p.id}${p.local ? ' (' + t('lokal', 'local') + ')' : ''}`)));
  const model = el('select', { 'aria-label': t('Modell', 'Model') });
  const fill = () => { const p = usable.find(x => x.id === prov.value); model.replaceChildren(...(p?.models || []).map(m => el('option', { value: m, selected: m === suggestion?.model && p.id === suggestion.provider }, String(m).replace(/^models\//, '')))); };
  prov.addEventListener('change', fill); fill();
  return el('div', {},
    el('p', {}, t('Välj modellen Aura ska tänka med. JACO ställer en testfråga innan den godkänns.', 'Choose the model Aura thinks with. JACO asks a test question before it is accepted.')),
    usable.length ? el('div', { class: 'setup-row' }, prov, model, button(t('Koppla', 'Connect'), () => act('provider', async () => {
      const r = await post('/api/aura/model', { provider: prov.value, model: model.value }, 60000);
      if (!r.ok || r.data.choice?.model !== model.value) throw new Error(String(r.data?.probe?.error || r.data?.error || t('Modellen svarade inte på testfrågan.', 'The model did not answer the test question.')).slice(0, 160));
      state.message = t('Modellen svarade. Den är kopplad.', 'The model answered. It is connected.');
    }), { primary: true, disabled: Boolean(state.busy) })) : el('p', {}, t('Ingen modell är tillgänglig än. Gå tillbaka till steg 2.', 'No model is available yet. Go back to step 2.')));
}

function activatePanel() {
  const tools = state.report?.tools;
  return el('div', {},
    el('p', {}, t('Sista steget startar verktygen (webbläsare, filer, git och fler) så att Aura kan arbeta på riktigt.', 'The last step starts the tools (browser, files, git and more) so Aura can really work.')),
    tools ? el('p', { class: 'setup-hint' }, `${tools.toolCount} ${t('verktyg', 'tools')} · ${tools.ready ?? 0} ${t('redo', 'ready')}`) : null,
    button(state.busy === 'activate' ? t('Startar…', 'Starting…') : t('Starta allt', 'Start everything'), () => act('activate', async () => {
      const r = await post('/api/jaco/activate', {}, 180000);
      if (!r.ok) throw new Error(t('Verktygen kunde inte startas. Se detaljer i IDE:n.', 'The tools could not be started. See the details in the IDE.'));
    }), { primary: true, disabled: Boolean(state.busy) }));
}

const PANELS = { api: apiPanel, brain: brainPanel, vault: vaultPanel, provider: providerPanel, activate: activatePanel };

export function render() {
  const body = $('setupBody'); if (!body) return;
  // Taken before the panel is built: building it moves the key field out of the page, which drops its focus.
  const typing = document.activeElement;
  const { steps, current, ready } = setupSteps({ report: state.report, error: state.error, vault: state.vault, skippedVault: state.skippedVault });
  const shown = state.view && steps.some(s => s.id === state.view) ? state.view : current;
  $('setupBtn').dataset.incomplete = String(!ready);
  // How many vault keys JACO holds, readable from the step list without opening the step.
  const held = vaultRows(state.vault), heldCount = held.length ? ` ${held.filter(row => row.state !== 'PENDING').length}/${held.length}` : '';
  const list = el('ol', { class: 'setup-steps' }, steps.map((step, i) => el('li', { class: `${step.done ? 'done' : step.skipped ? 'skipped' : step.id === shown ? 'current' : ''}`, onclick: () => { state.view = step.id; render(); } },
    el('span', { class: 'mark', 'aria-hidden': 'true' }, step.done ? '✓' : step.skipped ? '–' : String(i + 1)), el('span', {}, TITLES[step.id], step.id === 'vault' ? heldCount : null, step.optional ? el('em', {}, ' ' + t('(valfritt)', '(optional)')) : null))));
  // A finished setup still opens every step: a step the operator picked is shown, so a key can be added or changed.
  const panel = ready && !state.view
    ? el('div', {}, el('h3', {}, t('Klart! Aura kan arbeta.', 'Done! Aura can work.')), el('p', {}, t('Skriv vad du vill ha hjälp med, eller tryck Prata.', 'Write what you want help with, or press Talk.')), button(t('Börja', 'Start'), close, { primary: true }), ' ', button(t('Lägg till eller byt nyckel', 'Add or change a key'), () => { state.view = 'brain'; render(); }))
    : el('div', {}, el('h3', {}, TITLES[shown]), PANELS[shown](), state.busy ? el('p', { class: 'setup-busy', role: 'status' }, t('Arbetar…', 'Working…')) : null, state.message ? el('p', { class: 'setup-message', role: 'status' }, state.message) : null);
  body.replaceChildren(list, panel);
  if (typing && typing !== document.activeElement && body.contains(typing)) typing.focus();
}

export function open() { state.open = true; state.view = null; $('setup').hidden = false; render(); void refresh(); }
export function close() { state.open = false; if (keyFields) keyFields.key.value = ''; $('setup').hidden = true; }

export async function init() {
  $('setupBtn').addEventListener('click', open);
  $('setupClose').addEventListener('click', close);
  addEventListener('keydown', e => { if (e.key === 'Escape' && !$('setup').hidden) close(); });
  const result = await refresh();
  // A new user lands in the setup; a finished one is not interrupted.
  if (!result.ready) open();
}
