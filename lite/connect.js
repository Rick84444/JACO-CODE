const $ = id => document.getElementById(id);
async function request(route, body) {
  const response = await fetch('/api/aura/workbench/setup' + route, {
    method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw Error(data.error || 'The check failed');
  return data;
}
const messages = {
  JACO_ALREADY_CONFIGURED: 'JACO is already in the client settings. Nothing was overwritten. Reload the client and test the connection. If it points to an older installation, the entry needs review.',
  CONFIG_NEEDS_REVIEW: 'The settings file needs review. JACO has not overwritten it.',
  CONFIG_CHANGED_RETRY: 'The settings changed at the same time. Check again before you try to save.',
  MCP_NOT_INCLUDED: 'The installation is missing JACO Editor. Download the updated Lite version.',
};
function error(e) { $('error').textContent = messages[e.message] || 'Could not confirm: ' + e.message + '. Check the status before you try again.'; }
async function refresh() {
  $('error').textContent = '';
  try {
    const d = await request('');
    $('status').textContent = (d.mcpIncluded && d.workplace ? 'Local connection services are answering. ' : '') + d.next;
    $('project').textContent = 'Project: ' + d.project;
    const files = $('env-file'); files.replaceChildren(new Option('Choose file', ''));
    for (const file of d.envFiles || []) files.add(new Option(file, file));
    $('import-env').disabled = !(d.envFiles || []).length;
    $('env-status').textContent = (d.envFiles || []).length ? 'No file is read until you choose import.' : 'No .env file was found directly in the project folder. You can connect a model in the IDE settings.';
    document.querySelectorAll('[data-client]').forEach(b => { b.disabled = !d.mcpIncluded || !d.workplace; });
    $('cloud').textContent = d.cloud.configured ? 'A remote address is configured. Pairing and access must be confirmed on the other device.' : 'No remote address is configured for this installation. You can continue locally.';
    const link = $('cloud-link'); link.hidden = true;
    if (d.cloud.url && new URL(d.cloud.url).protocol === 'https:') { link.href = d.cloud.url; link.hidden = false; }
  } catch(e) { error(e); $('status').textContent = 'The installation could not be checked. Start JACO with START.cmd and open this page from the address shown.'; }
}
document.querySelectorAll('[data-client]').forEach(button => button.addEventListener('click', async () => {
  button.disabled = true; $('error').textContent = '';
  try { const d = await request('/client', { client: button.dataset.client }); $('client-status').textContent = 'Configuration saved in ' + d.file + '. ' + d.next; }
  catch(e) { error(e); } finally { button.disabled = false; }
}));
$('check').addEventListener('click', async () => {
  $('check').disabled = true; $('check-status').textContent = 'Checking Workplace and reading the project via JACO Editor…';
  try { const d = await request('/check', {}); $('check-status').textContent = 'Tool verified: ' + d.tool + ' · ' + d.project.name + '. ' + d.note; }
  catch(e) { $('check-status').textContent = 'The tool could not be verified.'; error(e); } finally { $('check').disabled = false; }
});
$('import-env').addEventListener('click', async () => {
  const file = $('env-file').value;
  if (!file) { $('env-status').textContent = 'Choose a file first.'; return; }
  $('import-env').disabled = true;
  try { const d = await request('/import-env', { file, confirmed: true }); $('env-status').textContent = 'Stored services: ' + (d.imported.join(', ') || 'none new') + '. ' + d.note; }
  catch(e) { error(e); } finally { $('import-env').disabled = false; }
});
$('refresh').addEventListener('click', refresh);
void refresh();
