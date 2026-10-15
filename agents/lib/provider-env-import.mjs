import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import { SecretStore } from './secret-store.mjs';
import { CATALOG } from '../../runtime/src/server/connected/providerCatalog.mjs';

// Explicit operator-selected file only. Values never leave this function or enter a receipt.
export function providerEnvFiles(project) {
  return fs.readdirSync(project, { withFileTypes: true })
    .filter(e => e.isFile() && /^\.env(?:\.[a-zA-Z0-9_-]+)?$/.test(e.name)).map(e => e.name).sort();
}
export function importProviderEnv({ project, file, confirmed, store = new SecretStore() }) {
  if (confirmed !== true) throw Error('ENV_IMPORT_CONFIRMATION_REQUIRED');
  if (typeof file !== 'string' || !/^\.env(?:\.[a-zA-Z0-9_-]+)?$/.test(file)) throw Error('ENV_FILE_NOT_ALLOWED');
  const root = fs.realpathSync(project); const candidate = path.join(root, file);
  if (fs.lstatSync(candidate).isSymbolicLink() || path.dirname(fs.realpathSync(candidate)) !== root) throw Error('ENV_FILE_NOT_ALLOWED');
  if (fs.statSync(candidate).size > 128 * 1024) throw Error('ENV_FILE_TOO_LARGE');
  let data;
  try { data = parse(fs.readFileSync(candidate)); } catch { throw Error('ENV_READ_FAILED'); }
  const imported = [], kept = [];
  for (const p of CATALOG) {
    const value = data[p.apiKeyEnv];
    if (!value || value.length < 8) continue;
    if (store.has(p.apiKeyEnv)) { kept.push(p.id); continue; }
    store.set(p.apiKeyEnv, value, { source: 'operator-selected-env', purpose: 'Model provider connection' });
    imported.push(p.id);
  }
  return { state: 'STORED', imported, kept, note: 'Nyckelvärden visas inte. Befintliga nycklar har bevarats. Sparad nyckel betyder inte verifierad modellanslutning.' };
}
