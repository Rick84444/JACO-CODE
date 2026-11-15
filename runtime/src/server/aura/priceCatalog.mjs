// Live model prices, USD per million tokens. No price is written in this repository: they are fetched from public catalogs,
// kept in JACO's state directory so a restart or an offline period keeps the last known prices, and always carry their source
// and fetch time. These catalogs are community and reseller listings, not provider invoices.
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from '../../../../agents/lib/secret-store.mjs';

const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/models';
// A catalog with fewer rows than this is truncated or something else, and must not replace known prices.
const MIN_ROWS = 50;
const MAX_USD_PER_MILLION = 1000;
export const PRICE_SYNC_INTERVAL_MS = 6 * 3600_000;

export const priceCatalogFile = (env = process.env) => path.join(stateDir(env), 'economy', 'prices.json');
const normalizeModel = model => String(model || '').trim().toLowerCase().replace(/^models\//, '');
const perMillion = perToken => Math.round(Number(perToken) * 1e6 * 1e6) / 1e6;
const validRate = (input, output) => [input, output].every(n => Number.isFinite(n) && n >= 0 && n <= MAX_USD_PER_MILLION);

export function parseLitellm(json) {
  const models = {};
  for (const [name, entry] of Object.entries(json || {})) {
    if (!entry || typeof entry !== 'object' || !['chat', 'responses'].includes(entry.mode)) continue;
    const provider = String(entry.litellm_provider || '').toLowerCase();
    const input = perMillion(entry.input_cost_per_token), output = perMillion(entry.output_cost_per_token);
    if (!provider || !validRate(input, output) || input + output === 0) continue;
    const model = name.toLowerCase().startsWith(provider + '/') ? name.slice(provider.length + 1) : name;
    models[`${provider}/${normalizeModel(model)}`] = { input, output, source: 'litellm' };
  }
  return models;
}

const OPENROUTER_VENDOR = { google: 'gemini', 'x-ai': 'xai', mistralai: 'mistral' };
export function parseOpenrouter(json) {
  const models = {};
  for (const entry of Array.isArray(json?.data) ? json.data : []) {
    const id = normalizeModel(entry?.id);
    const input = perMillion(entry?.pricing?.prompt), output = perMillion(entry?.pricing?.completion);
    if (!id || !validRate(input, output)) continue;
    models[`openrouter/${id}`] = { input, output, source: 'openrouter', ...(input + output === 0 ? { free: true } : {}) };
    // The same model listed under its maker: only a paid rate says anything about what the maker charges.
    const slash = id.indexOf('/');
    if (slash > 0 && input + output > 0) {
      const vendor = id.slice(0, slash);
      models[`${OPENROUTER_VENDOR[vendor] || vendor}/${id.slice(slash + 1)}`] = { input, output, source: 'openrouter' };
    }
  }
  return models;
}

let cached = { file: null, mtimeMs: 0, value: null };
export function readPriceCatalog(env = process.env) {
  const file = priceCatalogFile(env);
  try {
    const { mtimeMs } = fs.statSync(file);
    if (cached.file === file && cached.mtimeMs === mtimeMs) return cached.value;
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value?.models || typeof value.models !== 'object') return null;
    cached = { file, mtimeMs, value };
    return value;
  } catch { return null; }
}

// The rate for this exact model, or null.
export function syncedPrice(providerId, model, env = process.env) {
  const catalog = readPriceCatalog(env);
  const rate = catalog?.models?.[`${String(providerId).toLowerCase()}/${normalizeModel(model)}`];
  return rate ? { ...rate, fetchedAt: catalog.fetchedAt } : null;
}

// A provider no catalog lists (an API the operator added themselves): the median of today's paid rates. It is an estimate and is
// labelled as one, but it follows the market and a connected provider is not refused for being new.
export function catalogMedianPrice(env = process.env) {
  const catalog = readPriceCatalog(env);
  const paid = Object.values(catalog?.models || {}).filter(rate => rate.input + rate.output > 0);
  if (!paid.length) return null;
  const middle = key => paid.map(rate => rate[key]).sort((a, b) => a - b)[Math.floor(paid.length / 2)];
  return { input: middle('input'), output: middle('output'), source: 'catalog-median', fetchedAt: catalog.fetchedAt };
}

// A model the catalogs do not list yet: reserve at the provider's own highest listed rate, so a guess can only overstate.
export function providerHighestPrice(providerId, env = process.env) {
  const catalog = readPriceCatalog(env);
  const prefix = `${String(providerId).toLowerCase()}/`;
  let highest = null;
  for (const [key, rate] of Object.entries(catalog?.models || {})) {
    if (key.startsWith(prefix) && (!highest || rate.input + rate.output > highest.input + highest.output)) highest = rate;
  }
  return highest ? { input: highest.input, output: highest.output, source: 'provider-highest', fetchedAt: catalog.fetchedAt } : null;
}

export async function syncPrices({ env = process.env, fetchImpl = fetch, now = () => new Date().toISOString() } = {}) {
  const fetchSource = async (id, url, parse) => {
    try {
      const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const models = parse(await response.json());
      const count = Object.keys(models).length;
      if (count < MIN_ROWS) throw new Error('CATALOG_TOO_SMALL');
      return { id, url, ok: true, count, models };
    } catch (error) { return { id, url, ok: false, error: String(error?.message || error).slice(0, 160) }; }
  };
  const results = await Promise.all([fetchSource('openrouter', OPENROUTER_URL, parseOpenrouter), fetchSource('litellm', LITELLM_URL, parseLitellm)]);
  const previous = readPriceCatalog(env);
  const sources = results.map(({ models, ...rest }) => ({ ...rest, checkedAt: now() }));
  if (!results.some(r => r.ok)) return { ok: false, sources, fetchedAt: previous?.fetchedAt || null };
  // Later sources win: LiteLLM lists what the provider itself charges, OpenRouter what it resells at. A source that failed
  // this time keeps its previous rows instead of disappearing.
  const models = {};
  for (const result of results) {
    if (result.ok) Object.assign(models, result.models);
    else for (const [key, rate] of Object.entries(previous?.models || {})) if (rate.source === result.id) models[key] = rate;
  }
  const value = { schema: 'jaco.price-catalog/v1', fetchedAt: now(), sources, models };
  const file = priceCatalogFile(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
  return { ok: true, sources, fetchedAt: value.fetchedAt, count: Object.keys(models).length };
}
