// Swedish for the catalog of what Aura may do (runtime/src/server/capabilities/capabilityPolicy.mjs keeps the
// English as the canonical text). A group or task the table does not know is shown as the server sent it.
type Group = { id: string; name: string; description: string };
type Task = { id: string; label: string };

const GROUPS: Record<string, [string, string]> = {
  files: ['Filer och kod', 'Läsa, skapa, ändra och testa filerna i ditt projekt.'],
  git: ['Spara och dela versioner', 'Git och GitHub: spara versioner av arbetet, dela dem och skapa arkiv.'],
  shell: ['Köra kommandon', 'Köra program och kommandon, som en utvecklare använder en terminal.'],
  web: ['Surfa på webben', 'Öppna sidor, läsa dem samt klicka och skriva i webbläsaren.'],
  desktop: ['Styra den här datorn', 'Titta på dina fönster, flytta musen, klicka och skriva som du gör.'],
  android: ['Styra din telefon', 'Använda en ansluten Android-telefon.'],
  tools: ['Verktyg och färdigheter', 'Använda de anslutna verktygen (MCP) och de färdiga färdigheterna.'],
  secrets: ['Lösenord och e-post', 'Skapa och använda sparade lösenord och nycklar samt läsa den e-post Aura har fått.'],
  system: ['Kontrollera att allt fungerar', 'Se vad som finns och om det mår bra.'],
  other: ['Övrigt', ''],
};

const TASKS: Record<string, string> = {
  'repo-list': 'Lista filer', 'repo-read': 'Läsa filer', 'repo-write': 'Skapa filer', 'repo-edit': 'Ändra filer',
  'repo-test': 'Köra tester', 'repo-service': 'Starta projektets tjänster', 'repo-scan': 'Skanna ett publikt arkiv (kostar)',
  'git-status': 'Git-status', 'git-diff': 'Git-skillnader', 'git-commit': 'Spara en version', 'git-push': 'Skicka upp', 'git-merge': 'Slå ihop',
  'github-create-repo': 'Skapa ett GitHub-arkiv',
  shell: 'Köra kommandon', 'invoke-worker': 'Starta en arbetare',
  'web-fetch': 'Hämta en webbsida', 'browser-survey-site': 'Läsa en webbläsarflik', 'browser-click': 'Klicka i webbläsaren',
  'browser-type': 'Skriva i webbläsaren',
  'desktop-windows': 'Lista fönster', 'desktop-observe': 'Titta på ett fönster', 'desktop-action': 'Agera i ett fönster',
  'desktop-invoke': 'Använda en kontroll', 'windows-wmi-read': 'Läsa Windows systeminformation', screenshot: 'Ta en skärmbild',
  'mouse-move': 'Flytta musen', 'mouse-click': 'Klicka med musen', 'mouse-scroll': 'Scrolla', 'key-press': 'Trycka på tangenter',
  'type-text': 'Skriva text', 'get-cursor': 'Läsa muspekarens plats',
  'mcp-call': 'Använda ett MCP-verktyg (läsa)', 'mcp-write': 'Använda ett MCP-verktyg (skriva)', 'skill-load': 'Använda en färdighet',
  'vault-generate-secret': 'Skapa en hemlighet', 'vault-get-secret': 'Använda en sparad hemlighet', 'vault-list-secrets': 'Lista hemligheters namn',
  'secret-store': 'Spara en hemlighet', 'email-inbox': 'Läsa agentens inkorg',
  'detect-surfaces': 'Se vad som finns', 'health-check': 'Hälsokontroll', 'check-revenue': 'Kontrollera intäkter', 'promote-hf': 'Marknadsföra på Hugging Face',
  'android-status': 'Android-status', 'android-observe': 'Titta på telefonen', 'android-begin': 'Börja en telefonsession', 'android-target': 'Välja telefon',
  'android-open-app': 'Öppna en app på telefonen', 'android-tap': 'Trycka på telefonen', 'android-type': 'Skriva på telefonen',
  'android-scroll': 'Scrolla på telefonen', 'android-back': 'Gå tillbaka på telefonen', 'android-home': 'Gå till telefonens startsida',
};

const ASK: Record<string, [string, string]> = {
  spend: ['Utgående betalningar och nya ekonomiska åtaganden', 'Pengar som lämnar dina konton kräver alltid ditt beslut.'],
  'leaving-sandbox': ['Lämna den skyddade ytan', 'Skicka upp en delad gren, publicera, driftsätta, skicka i ditt namn, logga in och radera utanför arbetskopian.'],
};

export const groupText = (group: Group, sv: boolean): Group => {
  const known = sv ? GROUPS[group.id] : undefined;
  return known ? { ...group, name: known[0], description: known[1] } : group;
};
export const taskText = (task: Task, sv: boolean): string => (sv && TASKS[task.id]) || task.label;
export const askText = (item: { id: string; label: string; why: string }, sv: boolean) => {
  const known = sv ? ASK[item.id] : undefined;
  return known ? { ...item, label: known[0], why: known[1] } : item;
};
