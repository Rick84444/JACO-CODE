// Logins the operator has approved for Aura (operator 2026-11-08: "Aura should handle passwords the user has approved
// in a larger plan and sign in to sites, but work within policy and never create costs such as subscriptions").
//
// The operator saves a site, a username and a password in JACO's own interface. The password goes straight into the
// encrypted secret store (secret-store.mjs) and never into a prompt, the chat, a receipt or a log. Only the browser
// bridge reads it, at the moment it fills the sign-in form on that very site; Aura learns only whether the sign-in
// worked. What stays out of reach whatever is saved: identity providers and bank or payment sign-ins
// (browser-scope.mjs BLOCKED_ORIGIN_PATTERN), and every purchase or subscription (spendGuard.mjs).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SecretStore, stateDir } from './secret-store.mjs';
import { BLOCKED_ORIGIN_PATTERN, isPrivateHost } from './browser-scope.mjs';

const FILE = 'site-logins.json';
const MAX_LOGINS = 100;

// The origin a login belongs to: https only, a public host, never an identity provider or a payment service.
export function loginOrigin(value) {
  let url;
  try { url = new URL(String(value || '').trim().includes('://') ? String(value).trim() : `https://${String(value || '').trim()}`); }
  catch { throw new Error('LOGIN_SITE_INVALID'); }
  if (url.protocol !== 'https:') throw new Error('LOGIN_SITE_MUST_BE_HTTPS');
  if (isPrivateHost(url.hostname)) throw new Error('LOGIN_SITE_PRIVATE');
  if (BLOCKED_ORIGIN_PATTERN.test(url.hostname)) throw new Error('LOGIN_SITE_NOT_ALLOWED');
  return url.origin;
}

const secretName = origin => `SITE_LOGIN_${crypto.createHash('sha256').update(origin).digest('hex').slice(0, 16).toUpperCase()}`;
const file = env => path.join(stateDir(env), FILE);

function read(env) {
  try {
    const data = JSON.parse(fs.readFileSync(file(env), 'utf8'));
    return Array.isArray(data?.logins) ? data.logins : [];
  } catch { return []; }
}

function write(env, logins) {
  const target = file(env);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ schema: 'jaco.site-logins/v1', logins }, null, 2), { mode: 0o600 });
  fs.renameSync(temp, target);
}

/** What the operator sees and Aura may know: site, username, when it was saved. Never the password. */
export function listSiteLogins({ env = process.env } = {}) {
  return read(env).map(({ origin, username, savedAt }) => ({ origin, username, savedAt }));
}

/** The sites Aura may sign in to (and whose sign-in pages she may use). */
export function approvedLoginOrigins({ env = process.env } = {}) {
  return new Set(read(env).map(login => login.origin));
}

/** Saved from the operator's own interface only (the runtime route checks that). */
export function saveSiteLogin({ site, username, password }, { env = process.env, store = new SecretStore({ env }) } = {}) {
  const origin = loginOrigin(site);
  const user = String(username || '').trim();
  const secret = String(password || '');
  if (!user || user.length > 200) throw new Error('LOGIN_USERNAME_REQUIRED');
  if (!secret || secret.length > 1000) throw new Error('LOGIN_PASSWORD_REQUIRED');
  const logins = read(env).filter(login => login.origin !== origin);
  if (logins.length >= MAX_LOGINS) throw new Error('LOGIN_LIMIT_REACHED');
  store.set(secretName(origin), secret, { source: 'operator', purpose: `sign-in for ${origin}` });
  logins.push({ origin, username: user, savedAt: new Date().toISOString() });
  write(env, logins);
  return { origin, username: user };
}

export function removeSiteLogin(site, { env = process.env, store = new SecretStore({ env }) } = {}) {
  const origin = loginOrigin(site);
  const logins = read(env);
  if (!logins.some(login => login.origin === origin)) return false;
  write(env, logins.filter(login => login.origin !== origin));
  try { store.delete(secretName(origin)); } catch { /* already gone */ }
  return true;
}

/** For the browser bridge only, at the moment it fills the form on this origin. */
export function siteLoginFor(origin, { env = process.env, store = new SecretStore({ env }) } = {}) {
  const login = read(env).find(entry => entry.origin === origin);
  if (!login) return null;
  const password = store.get(secretName(origin));
  return password ? { username: login.username, password } : null;
}
