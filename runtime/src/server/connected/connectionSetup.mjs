import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createEditorServer } from '../../../tools/jaco-editor-mcp.mjs';
import { providerEnvFiles, importProviderEnv } from '../../../../agents/lib/provider-env-import.mjs';

// One owner for client configuration. Never replaces a pre-existing JACO entry or trust settings.
export function clientConfig(client, { project, home = os.homedir(), command = process.execPath, entry, runtimeUrl, workplaceUrl }) {
  const server = { command, args: [entry], env: { JACO_RUNTIME_URL: runtimeUrl, JACO_WORKPLACE_URL: workplaceUrl } };
  if (client === 'claude') return { file: path.join(project, '.mcp.json'), key: 'mcpServers', server };
  if (client === 'vscode') return { file: path.join(project, '.vscode', 'mcp.json'), key: 'servers', server: { type: 'stdio', ...server } };
  if (client === 'codex') return { file: path.join(home, '.codex', 'config.toml'), server,
    block: '\n[mcp_servers.jaco-editor]\ncommand = ' + JSON.stringify(command) + '\nargs = ' + JSON.stringify([entry]) +
      '\n[mcp_servers.jaco-editor.env]\nJACO_RUNTIME_URL = ' + JSON.stringify(runtimeUrl) + '\nJACO_WORKPLACE_URL = ' + JSON.stringify(workplaceUrl) + '\n' };
  throw Error('UNKNOWN_CLIENT');
}
export function installClient(config) {
  // Reject symlinks at every existing path segment before touching client configuration.
  let cursor = config.file;
  while (cursor !== path.dirname(cursor)) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw Error('CONFIG_SYMLINK');
    cursor = path.dirname(cursor);
  }
  const exists = fs.existsSync(config.file);
  const before = exists ? fs.readFileSync(config.file, 'utf8') : '';
  if (Buffer.byteLength(before) > 512 * 1024) throw Error('CONFIG_TOO_LARGE');
  let after;
  if (config.block) {
    if (/^\s*\[mcp_servers\.(?:"jaco-editor"|'jaco-editor'|jaco-editor)(?:\]|\.)/m.test(before)) throw Error('JACO_ALREADY_CONFIGURED');
    after = before + config.block;
  } else {
    let doc;
    try { doc = before ? JSON.parse(before) : {}; } catch { throw Error('CONFIG_NEEDS_REVIEW'); }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc) || (doc[config.key] && (typeof doc[config.key] !== 'object' || Array.isArray(doc[config.key])))) throw Error('CONFIG_NEEDS_REVIEW');
    if (doc[config.key]?.['jaco-editor']) throw Error('JACO_ALREADY_CONFIGURED');
    doc[config.key] = { ...doc[config.key], 'jaco-editor': config.server };
    after = JSON.stringify(doc, null, 2) + '\n';
  }
  fs.mkdirSync(path.dirname(config.file), { recursive: true });
  const backup = exists ? config.file + '.jaco-backup-' + crypto.randomUUID() : null;
  if (backup) fs.copyFileSync(config.file, backup, fs.constants.COPYFILE_EXCL);
  if (exists && fs.readFileSync(config.file, 'utf8') !== before) throw Error('CONFIG_CHANGED_RETRY');
  // Exclusive creation for a new config; existing files retain a recovery copy.
  if (!exists) fs.writeFileSync(config.file, after, { flag: 'wx', mode: 0o600 });
  else {
    const temp = config.file + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(temp, after, { flag: 'wx', mode: fs.statSync(config.file).mode & 0o777 });
    try {
      if (fs.readFileSync(config.file, 'utf8') !== before) throw Error('CONFIG_CHANGED_RETRY');
      fs.renameSync(temp, config.file);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  return { state: 'CONFIGURED', file: config.file, backup, next: 'Starta om klienten, öppna projektet och godkänn JACO MCP där. Konfiguration är inte samma sak som en aktiv klient.' };
}
export function mountConnectionSetup(app, guard, { env = process.env, project = process.cwd(), home = os.homedir(), fetchImpl = fetch, onProviderImport = () => {} } = {}) {
  const install = env.JACO_RELEASE_ROOT || process.cwd();
  const entry = path.join(install, 'dist', 'jaco-editor.mjs');
  const workplaceUrl = env.JACO_WORKPLACE_URL || 'http://127.0.0.1:2995';
  const runtimeUrl = 'http://127.0.0.1:' + (env.PORT || 3000);
  let checking = false;
  app.get('/api/aura/workbench/setup', guard, async (_req, res) => {
    let workplace = false;
    try { const r = await fetchImpl(workplaceUrl + '/health', { signal: AbortSignal.timeout(2000) }); const d = await r.json(); workplace = r.ok && d.product === 'JACO Workplace'; } catch { /* reported below */ }
    res.json({ success: true, project, runtimeUrl, envFiles: providerEnvFiles(project), mcpIncluded: fs.existsSync(entry), workplace,
      cloud: { configured: Boolean(env.JACO_IDE_PUBLIC_HOST), url: env.JACO_IDE_PUBLIC_HOST ? 'https://' + env.JACO_IDE_PUBLIC_HOST + '/ide-login' : null },
      next: !fs.existsSync(entry) ? 'Installationen saknar JACO Editor MCP. Hämta det uppdaterade Lite-paketet.' : !workplace ? 'Starta JACO med START.cmd så att anslutningstjänsten startar automatiskt.' : 'Välj klient, spara anslutningen och kontrollera verktygen.' });
  });
  app.post('/api/aura/workbench/setup/import-env', guard, (req, res) => {
    try { const result = importProviderEnv({ project, file: req.body?.file, confirmed: req.body?.confirmed }); onProviderImport(); res.json({ success: true, ...result }); }
    catch (e) { res.status(409).json({ success: false, error: /^ENV_/.test(e.message) ? e.message : 'ENV_IMPORT_FAILED' }); }
  });
  app.post('/api/aura/workbench/setup/client', guard, (req, res) => {
    try {
      if (!fs.existsSync(entry)) throw Error('MCP_NOT_INCLUDED');
      const config = clientConfig(req.body?.client, { project, home, entry, runtimeUrl, workplaceUrl });
      res.json({ success: true, ...installClient(config) });
    } catch (e) { res.status(409).json({ success: false, error: e.message }); }
  });
  app.post('/api/aura/workbench/setup/check', guard, async (_req, res) => {
    if (checking) return res.status(409).json({ success: false, error: 'CHECK_IN_PROGRESS' });
    checking = true;
    const server = createEditorServer({ env: { ...env, JACO_RUNTIME_URL: runtimeUrl, JACO_WORKPLACE_URL: workplaceUrl } });
    try {
      const init = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'JACO connection check' } } });
      if (init.result?.isError || !init.result?.serverInfo) throw Error(init.result?.content?.[0]?.text || 'MCP_INITIALIZE_FAILED');
      const result = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'project', arguments: {} } });
      if (result.result?.isError) throw Error(result.result.content[0].text);
      res.json({ success: true, state: 'TOOL_VERIFIED', tool: 'project', project: JSON.parse(result.result.content[0].text), at: new Date().toISOString(),
        note: 'JACO Editor och Workplace svarar. Detta test bevisar inte att en extern klient har laddat sin konfiguration.' });
    } catch (e) { res.status(503).json({ success: false, error: e.message }); }
    finally { await server.close(); checking = false; }
  });
}
