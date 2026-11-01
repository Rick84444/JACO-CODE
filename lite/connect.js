const $ = id => document.getElementById(id);
const languageKey = 'jaco:aura:ui-language:v1';
let language = 'en';
try { language = localStorage.getItem(languageKey) === 'sv' ? 'sv' : 'en'; } catch {}
let pending = false, state = null;
const messages = {
  language:['Language','Språk'], welcome:['YOUR WORKSPACE. YOUR MODELS.','DIN ARBETSYTA. DINA MODELLER.'],
  title:['Make yourself at home.','Gör dig hemmastadd.'], intro:['Set up Aura, connect your models and choose how JACO works on this device.','Ställ in Aura, anslut dina modeller och välj hur JACO arbetar på den här enheten.'],
  preferences:['Choose how JACO starts','Välj hur JACO startar'], preferencesHelp:['Your choices are saved on this device. Task permissions and spending limits remain available in Settings.','Dina val sparas på den här enheten. Behörigheter och kostnadsgränser finns kvar i Inställningar.'],
  discover:['Find available models','Hitta tillgängliga modeller'], discoverHelp:['Check known local model servers and saved provider connections. Files and your local network are not searched.','Kontrollera kända lokala modellservrar och sparade leverantörsanslutningar. Filer och ditt lokala nätverk genomsöks inte.'],
  tools:['Connect installed tools','Anslut installerade verktyg'], toolsHelp:['Start the bundled project tools. Each tool keeps its configured read or write permissions.','Starta de medföljande projektverktygen. Varje verktyg behåller sina inställda läs- och skrivbehörigheter.'],
  agent:['Enable Aura to carry out tasks','Låt Aura utföra uppgifter'], agentHelp:['Aura can execute tasks you assign within their permissions. Purchases and unresolved results still need your attention.','Aura kan utföra de uppgifter du ger inom deras behörigheter. Köp och oklara resultat kräver fortfarande din uppmärksamhet.'],
  cloudModels:['Allow connected cloud models','Tillåt anslutna molnmodeller'], cloudModelsHelp:['Task content can be sent to your selected provider, which may charge for API use. No spending cap is added unless you set one in Settings.','Uppgiftsinnehåll kan skickas till din valda leverantör som kan ta betalt för API-användning. Ingen kostnadsgräns läggs till om du inte ställer in en i Inställningar.'],
  models:['Connect your models','Anslut dina modeller'], modelsHelp:['Use a model already running on this device, or import your own provider keys. You can also connect a provider later in Aura.','Använd en modell som redan körs på enheten eller importera dina egna leverantörsnycklar. Du kan även ansluta en leverantör senare i Aura.'],
  scan:['Find local models','Hitta lokala modeller'], importTitle:['Import model API keys from an environment file','Importera modellnycklar från en miljöfil'],
  importHelp:['Only recognised model API keys are copied to JACO’s encrypted credential store. Existing keys are kept. File contents stay out of the conversation.','Bara kända modellnycklar kopieras till JACOs krypterade nyckellager. Befintliga nycklar behålls. Filinnehållet hamnar inte i samtalet.'],
  projectFile:['A file in this project','En fil i det här projektet'], chooseFile:['Choose a file','Välj en fil'], importProject:['Import selected file','Importera vald fil'], chooseEnv:['Or choose your own environment file','Eller välj din egen miljöfil'],
  external:['Connect another AI client','Anslut en annan AI-klient'], externalHelp:['Optional. Give Codex, Claude Code or VS Code access to this project through JACO MCP. Existing configuration is backed up; existing JACO entries need review.','Valfritt. Ge Codex, Claude Code eller VS Code åtkomst till projektet via JACO MCP. Befintliga inställningar säkerhetskopieras; befintliga JACO-poster behöver granskas.'],
  clientHelp:['After saving, open this project in the client, reload its MCP connections and approve JACO there.','Efter att du sparat öppnar du projektet i klienten, laddar om MCP-anslutningarna och godkänner JACO där.'],
  checkTool:['Check the project connection','Kontrollera projektanslutningen'], devices:['Connect your phone or another device','Anslut telefonen eller en annan enhet'], openLogin:['Open your installation’s sign-in page','Öppna installationens inloggningssida'],
  devicesHelp:['Create a one-time code in Aura’s Devices view and enter it on the other device. Remote access needs your own configured HTTPS address. The host must remain on.','Skapa en engångskod i Auras enhetsvy och ange den på den andra enheten. Fjärråtkomst kräver din egen konfigurerade HTTPS-adress. Värden måste vara på.'],
  accept:['I have reviewed these settings and approve this setup.','Jag har granskat inställningarna och godkänner konfigurationen.'], finish:['Save and open Aura','Spara och öppna Aura'], refresh:['Check again','Kontrollera igen'],
  footnote:['JACO runs locally. Saved credentials, an available model list and a completed task are checked separately.','JACO körs lokalt. Sparade nycklar, en tillgänglig modellista och en slutförd uppgift kontrolleras var för sig.'],
  checking:['Checking your installation…','Kontrollerar installationen…'], setupReady:['Your installation responded. Review your choices to continue.','Installationen svarade. Granska dina val för att fortsätta.'],
  reconnect:['The installation could not be checked. Start JACO from its shortcut and open the setup address it prints.','Installationen kunde inte kontrolleras. Starta JACO från genvägen och öppna setup-adressen som visas.'],
  configured:['Settings are saved. You can review them or open Aura.','Inställningarna är sparade. Du kan granska dem eller öppna Aura.'],
  noEnv:['No environment files were found directly in this project. Choose a file yourself or connect a provider in Aura.','Ingen miljöfil hittades direkt i projektet. Välj en fil själv eller anslut en leverantör i Aura.'],
  envFound:['No file is read until you choose to import it.','Ingen fil läses förrän du väljer att importera den.'],
  cloudReady:['An HTTPS address is configured. Sign-in and access must be verified on the other device.','En HTTPS-adress är inställd. Inloggning och åtkomst behöver verifieras på den andra enheten.'],
  cloudMissing:['No remote address is configured. You can continue locally.','Ingen fjärradress är inställd. Du kan fortsätta lokalt.'],
  scanning:['Checking four local model servers…','Kontrollerar fyra lokala modellservrar…'],
  scanDone:['Model lists checked. A model list does not verify inference or tool use.','Modellistor kontrollerade. En modellista verifierar inte inferens eller verktygsanvändning.'],
  noModels:['No running local model with an available model list was found.','Ingen körande lokal modell med tillgänglig modellista hittades.'],
  stored:['Imported providers: ','Importerade leverantörer: '], kept:['Existing keys kept: ','Befintliga nycklar behållna: '], none:['none','inga'],
  savedClient:['Configuration saved in ','Inställningar sparade i '], toolChecking:['Reading project information through the project tool…','Läser projektinformation genom projektverktyget…'],
  toolVerified:['The project tool responded. This does not verify an external client connection.','Projektverktyget svarade. Det verifierar inte en extern klientanslutning.'],
  saving:['Saving your preferences…','Sparar dina val…'], restarting:['Setup saved. Restarting the local workspace…','Inställningar sparade. Startar om den lokala arbetsytan…'],
  restartManual:['Settings saved. Restart JACO from its shortcut to apply startup changes.','Inställningar sparade. Starta om JACO från genvägen för att tillämpa startändringarna.'],
  restartWait:['Settings saved. Startup is taking longer than expected. Check the local logs before starting another instance.','Inställningarna är sparade. Starten tar längre tid än väntat. Kontrollera lokala loggar innan du startar en till instans.'],
  failed:['The result could not be confirmed. Check its status before retrying. Code: ','Resultatet kunde inte bekräftas. Kontrollera status före nytt försök. Kod: '],
  JACO_ALREADY_CONFIGURED:['JACO is already configured. Nothing was replaced. Reload the client and review any older JACO entry.','JACO är redan konfigurerat. Inget ersattes. Ladda om klienten och granska eventuella äldre JACO-poster.'],
  CONFIG_NEEDS_REVIEW:['The existing client configuration needs review. It was not replaced.','Klientens befintliga inställningar behöver granskas. De ersattes inte.'],
  CONFIG_CHANGED_RETRY:['The configuration changed during saving. Check it before trying again.','Inställningarna ändrades under sparandet. Kontrollera dem innan du försöker igen.'],
  MCP_NOT_INCLUDED:['The project tool is missing. Reinstall a complete JACO download.','Projektverktyget saknas. Installera om ett fullständigt JACO-paket.'],
  ENV_FILE_TOO_LARGE:['Choose an environment file smaller than 128 KB.','Välj en miljöfil som är mindre än 128 KB.'],
};
const tr = key => messages[key]?.[language === 'sv' ? 1 : 0] || key;
function showLanguage() {
  document.documentElement.lang = language; document.title = language === 'sv' ? 'JACO Installation' : 'JACO Setup';
  $('language').value = language;
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = tr(node.dataset.i18n); });
  try { localStorage.setItem(languageKey, language); } catch {}
}
async function request(route, body) {
  const response = await fetch('/api/aura/workbench/setup' + route, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw Error(typeof data.error === 'string' ? data.error : 'REQUEST_FAILED');
  return data;
}
function error(e) { $('error').textContent = messages[e.message] ? tr(e.message) : tr('failed') + String(e.message).slice(0, 140); }
function imported(data) { $('env-status').textContent = tr('stored') + (data.imported.join(', ') || tr('none')) + '. ' + tr('kept') + (data.kept.join(', ') || tr('none')) + '.'; }
async function refresh() {
  $('error').textContent = ''; $('status').textContent = tr('checking');
  try {
    const data = await request(''); state = data; pending = data.setupPending;
    $('status').textContent = data.setup ? tr('configured') : tr('setupReady');
    $('project').textContent = data.project;
    const files = $('env-file'); files.replaceChildren(new Option(tr('chooseFile'), ''));
    for (const file of data.envFiles || []) files.add(new Option(file, file));
    $('import-env').disabled = !(data.envFiles || []).length;
    $('env-status').textContent = tr(data.envFiles?.length ? 'envFound' : 'noEnv');
    document.querySelectorAll('[data-client]').forEach(button => { button.disabled = !data.mcpIncluded || !data.workplace; });
    $('check').disabled = !data.mcpIncluded || !data.workplace || pending;
    $('cloud').textContent = tr(data.cloud.configured ? 'cloudReady' : 'cloudMissing');
    const link = $('cloud-link'); link.hidden = true;
    if (data.cloud.url && new URL(data.cloud.url).protocol === 'https:') { link.href = data.cloud.url; link.hidden = false; }
    if (data.setup) for (const [field, key] of [['discover-local','discoverLocal'],['connect-tools','connectTools'],['run-agent','runAgent'],['cloud-models','cloudModels']]) $(field).checked = data.setup[key] === true;
  } catch(e) { error(e); $('status').textContent = tr('reconnect'); }
}
$('language').addEventListener('change', () => { language = $('language').value === 'sv' ? 'sv' : 'en'; showLanguage(); void refresh(); });
$('scan-local').addEventListener('click', async () => {
  $('scan-local').disabled = true; $('error').textContent = ''; $('model-status').textContent = tr('scanning'); $('local-models').replaceChildren();
  try {
    const result = await request('/discover-local', { confirmed: true });
    const found = result.providers.filter(provider => provider.models.length);
    for (const provider of found) { const row = document.createElement('li'); row.textContent = provider.id + ': ' + provider.models.join(', '); $('local-models').append(row); }
    $('model-status').textContent = tr(found.length ? 'scanDone' : 'noModels');
  } catch(e) { error(e); } finally { $('scan-local').disabled = false; }
});
document.querySelectorAll('[data-client]').forEach(button => button.addEventListener('click', async () => {
  button.disabled = true; $('error').textContent = '';
  try { const data = await request('/client', { client: button.dataset.client }); $('client-status').textContent = tr('savedClient') + data.file + '. ' + tr('clientHelp'); }
  catch(e) { error(e); } finally { button.disabled = false; }
}));
$('check').addEventListener('click', async () => {
  $('check').disabled = true; $('check-status').textContent = tr('toolChecking');
  try { await request('/check', {}); $('check-status').textContent = tr('toolVerified'); }
  catch(e) { error(e); } finally { $('check').disabled = false; }
});
$('import-env').addEventListener('click', async () => {
  const file = $('env-file').value; if (!file) { $('env-status').textContent = tr('chooseFile'); return; }
  $('import-env').disabled = true;
  try { imported(await request('/import-env', { file, confirmed: true })); }
  catch(e) { error(e); } finally { $('import-env').disabled = false; }
});
$('env-upload').addEventListener('change', async () => {
  const file = $('env-upload').files[0]; if (!file) return;
  $('env-upload').disabled = true; let text = '';
  try {
    if (file.size > 128 * 1024) throw Error('ENV_FILE_TOO_LARGE');
    text = await file.text(); imported(await request('/import-env-text', { text, confirmed: true }));
  } catch(e) { error(e); } finally { text = ''; $('env-upload').value = ''; $('env-upload').disabled = false; }
});
$('accept').addEventListener('change', () => { $('finish').disabled = !$('accept').checked; });
$('setup-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!$('accept').checked) return;
  $('finish').disabled = true; $('error').textContent = ''; $('finish-status').textContent = tr('saving');
  try {
    await request('/complete', { confirmed: true, language, discoverLocal: $('discover-local').checked, connectTools: $('connect-tools').checked, runAgent: $('run-agent').checked, cloudModels: $('cloud-models').checked });
    if (!pending) { $('finish-status').textContent = tr('restartManual'); return; }
    $('finish-status').textContent = tr('restarting');
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      try { const response = await fetch('/api/runtime/identity', { signal: AbortSignal.timeout(2000), cache: 'no-store' }); const identity = await response.json();
        if (response.ok && identity.success === true && identity.product === 'JACO Autonomus IDE' && identity.setupPending === false) { location.assign('/'); return; }
      } catch { /* The owned runtime is restarting. */ }
    }
    $('finish-status').textContent = tr('restartWait');
  } catch(e) { error(e); } finally { $('finish').disabled = !$('accept').checked; }
});
$('refresh').addEventListener('click', refresh);
showLanguage(); void refresh();
