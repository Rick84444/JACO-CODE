// Local operator import. No network requests, raw values in receipts, or new vault.
import { SecretStore } from './secret-store.mjs';
import { CATALOG } from '../../runtime/src/server/connected/providerCatalog.mjs';

const aliases = new Map(Object.entries({
  'openai':'OPENAI_API_KEY','open ai':'OPENAI_API_KEY',
  'deepseek':'DEEPSEEK_API_KEY','deepseek api':'DEEPSEEK_API_KEY',
  'qwen':'QWEN_API_KEY','qwen api':'QWEN_API_KEY','qwen 3.7':'QWEN_API_KEY',
  'gemini':'GEMINI_API_KEY','google ai':'GEMINI_API_KEY',
  'google cloud api':'GOOGLE_CLOUD_API_KEY','cloudrun api':'GOOGLE_CLOUD_API_KEY',
  'openrouter':'OPENROUTER_API_KEY','huggingface':'HUGGINGFACE_TOKEN',
  'lm studio':'LM_STUDIO_API_KEY','lmstudio':'LM_STUDIO_API_KEY',
  'ollama':'OLLAMA_API_KEY','open claws ollama key':'OLLAMA_API_KEY',
  'render':'RENDER_API_KEY','render api':'RENDER_API_KEY',
  'stripe':'STRIPE_SECRET_KEY','stripe åtkomst':'STRIPE_SECRET_KEY',
  'skyfire api':'SKYFIRE_API_KEY','skyfire seller':'SKYFIRE_SELLER_ID',
  'cloudflare':'CLOUDFLARE_API_TOKEN','cloudflare api':'CLOUDFLARE_API_TOKEN',
  'git':'GITHUB_TOKEN','github':'GITHUB_TOKEN','github token':'GITHUB_TOKEN',
  'bolt':'BOLT_API_KEY','pydantic':'LOGFIRE_TOKEN','logfire':'LOGFIRE_TOKEN',
  'zapier':'ZAPIER_API_KEY','zapier mcp url':'ZAPIER_MCP_URL',
  'apollo':'APOLLO_API_KEY','appollo':'APOLLO_API_KEY',
  'twilio api key':'TWILIO_API_KEY','twilio auth token':'TWILIO_AUTH_TOKEN',
  'coinbase cdp key id':'CDP_API_KEY_ID','coinbase cdp key secret':'CDP_API_KEY_SECRET',
  'coinbase commerce':'COINBASE_COMMERCE_KEY'
}));
for (const p of CATALOG) aliases.set(p.id,p.apiKeyEnv);
const names = new Set([...aliases.values(), ...CATALOG.map(p => p.apiKeyEnv)]);
const patterns = [
  [/^github_pat_|^gh[pousr]_/, 'GITHUB_TOKEN'],
  [/^(?:rk|sk)_(?:live|test)_/, 'STRIPE_SECRET_KEY'],
  [/^rnd_/, 'RENDER_API_KEY'],
  [/^sk-lm-/, 'LM_STUDIO_API_KEY'],
  [/^cfut_/, 'CLOUDFLARE_API_TOKEN'],
  [/^pylf_/, 'LOGFIRE_TOKEN']
];
function candidates(value) {
  return [...new Set([...patterns.filter(([p]) => p.test(value)).map(([,n]) => n),
    ...CATALOG.filter(p => p.keyPrefix?.test(value)).map(p => p.apiKeyEnv),
    ...(/^AIza/.test(value) ? ['GOOGLE_CLOUD_API_KEY'] : [])])];
}
const token = /^[^\s"'\\]{8,16384}$/;
const valid = value => token.test(value) && !/^(?:your[_-]|replace[_-]|example[_-]|changeme|placeholder|<|\$\{)/i.test(value);
function zapierUrl(value) {
  try {
    const u = new URL(value);
    return u.origin === 'https://mcp.zapier.com' && !u.username && !u.password &&
      u.pathname === '/api/v1/connect' && Boolean(u.searchParams.get('token')) && !u.hash;
  } catch { return false; }
}
function labelled(name, value) {
  if (name === 'ZAPIER_MCP_URL') return zapierUrl(value) ? {name,value} : {reason:'INVALID_ENDPOINT'};
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return {reason:'UNEXPECTED_URL'};
  const matches = candidates(value);
  if (matches.length && !matches.includes(name)) return {reason:'LABEL_MISMATCH',candidates:matches};
  return {name,value};
}
function parseLine(raw) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) return null;
  // dotenv assignment, or explicit service label followed by one opaque token.
  const assignment = line.match(/^(?:export\s+)?([A-Z][A-Z0-9_]{1,127})\s*=\s*(.*)$/);
  if (assignment) {
    if (!names.has(assignment[1])) return { reason: 'UNRECOGNIZED_NAME' };
    let value = assignment[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1,-1);
    if (!valid(value)) return { reason: 'INVALID_VALUE' };
    return labelled(assignment[1], value);
  }
  const normalized = line.toLowerCase();
  for (const [label,name] of [...aliases].sort((a,b) => b[0].length-a[0].length)) {
    if (!normalized.startsWith(label+' ') && !normalized.startsWith(label+':')) continue;
    const value = line.slice(label.length).replace(/^\s*:\s*|^\s+/,'').trim();
    if (!valid(value)) return { reason:'MULTIPLE_OR_INVALID_VALUES' };
    return labelled(name,value);
  }
  if (!valid(line)) return { reason:'UNRECOGNIZED_LINE' };
  if (zapierUrl(line)) return {name:'ZAPIER_MCP_URL',value:line};
  const matches = candidates(line);
  return matches.length === 1 ? { name:matches[0], value:line } :
    { reason: matches.length ? 'AMBIGUOUS' : 'UNRECOGNIZED_LINE', candidates:matches };
}
/** Returns ONLY canonical references and line numbers. Never returns secret values or sends them anywhere. */
export function importVaultText(text, { store = new SecretStore(), dryRun = false } = {}) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 128*1024) throw Error('VAULT_IMPORT_TOO_LARGE');
  const report = { imported:[], kept:[], pending:[], ready:[], failed:[] };
  const entries = new Map();
  const conflicts = new Set();
  for (const [i,raw] of text.split(/\r?\n/).entries()) {
    const item = parseLine(raw), line = i+1;
    if (!item) continue;
    if (!item.name) { report.pending.push({ line, reason:item.reason, ...(item.candidates?.length ? { candidates:item.candidates } : {}) }); continue; }
    const {name,value} = item;
    if (entries.has(name) && entries.get(name).value !== value) {
      conflicts.add(name);
      report.pending.push({ line, reason:'CONFLICTING_VALUES', candidates:[name] });
    } else if (!entries.has(name)) entries.set(name,{value,line});
  }
  let writeBusy = false;
  for (const [name,{value,line}] of entries) {
    if (conflicts.has(name)) { report.pending.push({line,reason:'CONFLICTING_VALUES',candidates:[name]}); continue; }
    if (writeBusy) { report.failed.push({name,line,reason:'VAULT_WRITE_BUSY'}); continue; }
    try {
      if (dryRun) {
        (store.has(name) ? report.kept : report.ready).push(name);
        continue;
      }
      const meta = {source:'operator-bulk-import',purpose:'Operator-selected service credential'};
      if (!store.setIfAbsent(name,value,meta)) { report.kept.push(name); continue; }
      report.imported.push(name);
    } catch (error) {
      writeBusy = error?.message === 'VAULT_WRITE_BUSY';
      report.failed.push({name,line,reason:writeBusy ? 'VAULT_WRITE_BUSY' : 'STORE_FAILED'});
    }
  }
  return report;
}
