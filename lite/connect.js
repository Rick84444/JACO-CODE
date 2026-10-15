const $ = id => document.getElementById(id);
async function request(route, body) {
  const response = await fetch('/api/aura/workbench/setup' + route, {
    method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw Error(data.error || 'Kontrollen misslyckades');
  return data;
}
const messages = {
  JACO_ALREADY_CONFIGURED: 'JACO finns redan i klientens inställningar. Ingenting har skrivits över. Ladda om klienten och testa anslutningen. Om den pekar på en äldre installation behöver posten granskas.',
  CONFIG_NEEDS_REVIEW: 'Inställningsfilen behöver granskas. JACO har inte skrivit över den.',
  CONFIG_CHANGED_RETRY: 'Inställningarna ändrades samtidigt. Kontrollera igen innan du försöker spara.',
  MCP_NOT_INCLUDED: 'Installationen saknar JACO Editor. Hämta den uppdaterade Lite-versionen.',
};
function error(e) { $('error').textContent = messages[e.message] || 'Kunde inte bekräfta: ' + e.message + '. Kontrollera status innan du försöker igen.'; }
async function refresh() {
  $('error').textContent = '';
  try {
    const d = await request('');
    $('status').textContent = (d.mcpIncluded && d.workplace ? 'Lokala anslutningstjänster svarar. ' : '') + d.next;
    $('project').textContent = 'Projekt: ' + d.project;
    const files = $('env-file'); files.replaceChildren(new Option('Välj fil', ''));
    for (const file of d.envFiles || []) files.add(new Option(file, file));
    $('import-env').disabled = !(d.envFiles || []).length;
    $('env-status').textContent = (d.envFiles || []).length ? 'Ingen fil läses förrän du väljer import.' : 'Ingen .env-fil hittades direkt i projektmappen. Du kan ansluta en modell i IDE-inställningarna.';
    document.querySelectorAll('[data-client]').forEach(b => { b.disabled = !d.mcpIncluded || !d.workplace; });
    $('cloud').textContent = d.cloud.configured ? 'En fjärradress är konfigurerad. Parkoppling och åtkomst måste bekräftas på den andra enheten.' : 'Ingen fjärradress är konfigurerad för den här installationen. Du kan fortsätta lokalt.';
    const link = $('cloud-link'); link.hidden = true;
    if (d.cloud.url && new URL(d.cloud.url).protocol === 'https:') { link.href = d.cloud.url; link.hidden = false; }
  } catch(e) { error(e); $('status').textContent = 'Installationen kunde inte kontrolleras. Starta JACO med START.cmd och öppna denna sida från adressen som visas.'; }
}
document.querySelectorAll('[data-client]').forEach(button => button.addEventListener('click', async () => {
  button.disabled = true; $('error').textContent = '';
  try { const d = await request('/client', { client: button.dataset.client }); $('client-status').textContent = 'Konfiguration sparad i ' + d.file + '. ' + d.next; }
  catch(e) { error(e); } finally { button.disabled = false; }
}));
$('check').addEventListener('click', async () => {
  $('check').disabled = true; $('check-status').textContent = 'Kontrollerar Workplace och läser projektet via JACO Editor…';
  try { const d = await request('/check', {}); $('check-status').textContent = 'Verktyg verifierat: ' + d.tool + ' · ' + d.project.name + '. ' + d.note; }
  catch(e) { $('check-status').textContent = 'Verktyget kunde inte verifieras.'; error(e); } finally { $('check').disabled = false; }
});
$('import-env').addEventListener('click', async () => {
  const file = $('env-file').value;
  if (!file) { $('env-status').textContent = 'Välj fil först.'; return; }
  $('import-env').disabled = true;
  try { const d = await request('/import-env', { file, confirmed: true }); $('env-status').textContent = 'Sparade tjänster: ' + (d.imported.join(', ') || 'inga nya') + '. ' + d.note; }
  catch(e) { error(e); } finally { $('import-env').disabled = false; }
});
$('refresh').addEventListener('click', refresh);
void refresh();
