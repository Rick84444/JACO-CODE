#!/usr/bin/env node
// Launcher for the canonical JACO MCP stdio server.
//
// An MCP client (Claude Code, VS Code) spawns this with no environment of its
// own, so this process is what loads .env, installs the gateway dependencies
// when they are missing, and hands a correct environment to
// gateway/src/mcp-stdio.mjs.
//
// stdout belongs to the MCP JSON-RPC stream. Nothing here may write to it.
//
// Environment sources, highest priority first:
//   1. variables the MCP client passed explicitly
//   2. the file named by JACO_ENV_FILE
//   3. every .env from the runtime folder up to the filesystem root, nearest first
//   4. ~/.jaco/.env and ~/.env
// A key is taken from the first source that defines it, so a repo .env can
// supply the gateway token while API keys still come from the user's home .env.
//
// Set JACO_MCP_AUTO_INSTALL=0 to disable the dependency install.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveMcpCoreBaseUrl } from './mcp-runtime-url.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const runtimeDir = resolve(here, '..');
const gatewayDir = join(runtimeDir, 'gateway');
const server = join(gatewayDir, 'src', 'mcp-stdio.mjs');
const log = message => console.error(`[JACO MCP] ${message}`);

// Mirrors agents/start-all.ps1: Stripe moves money, and the HuggingFace/GitHub
// tokens can publish as the operator. Only the runtime GUI process receives
// them; MCP clients must not inherit them.
const RUNTIME_ONLY = /^(STRIPE_|HUGGINGFACE_TOKEN$|HF_TOKEN$|GITHUB_TOKEN$|GH_TOKEN$|JACO_CHATGPT_WORKPLACE_TOKEN$)/;

function envFileCandidates() {
  const files = [];
  if (process.env.JACO_ENV_FILE) files.push(resolve(process.env.JACO_ENV_FILE));
  for (let dir = runtimeDir, prev = null; dir !== prev; prev = dir, dir = dirname(dir)) {
    files.push(join(dir, '.env'));
  }
  files.push(join(homedir(), '.jaco', '.env'), join(homedir(), '.env'));
  return [...new Set(files)].filter(file => existsSync(file));
}

function loadEnv(file) {
  const keys = [];
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([^#=\s][^=]*)=(.*)$/.exec(raw);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    if (!key || !value) continue;
    if (RUNTIME_ONLY.test(key)) continue;
    // An explicitly passed variable, or one from a nearer file, wins.
    if (process.env[key] !== undefined) continue;
    process.env[key] = value;
    keys.push(key);
  }
  return keys;
}

// Returns the first missing package, or null when the server can be imported.
function missingDependency() {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(gatewayDir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
  return Object.keys(pkg.dependencies || {})
    .find(name => !existsSync(join(gatewayDir, 'node_modules', ...name.split('/'), 'package.json'))) ?? null;
}

function installDependencies(missing) {
  if (process.env.JACO_MCP_AUTO_INSTALL === '0') {
    log(`fatal: gateway dependency ${missing} is missing and JACO_MCP_AUTO_INSTALL=0; run "npm ci" in ${gatewayDir}`);
    process.exit(1);
  }
  log(`gateway dependency ${missing} is missing; installing in ${gatewayDir}`);
  // npm output goes to stderr (fd 2) so the MCP stream on stdout stays clean.
  // shell is needed on Windows, where npm is npm.cmd.
  const run = args => spawnSync('npm', args, {
    cwd: gatewayDir, stdio: ['ignore', 2, 2], shell: process.platform === 'win32',
  }).status === 0;
  const flags = ['--no-audit', '--no-fund', '--omit=dev'];
  const ok = (existsSync(join(gatewayDir, 'package-lock.json')) && run(['ci', ...flags])) || run(['install', ...flags]);
  const still = missingDependency();
  if (!ok || still) {
    log(`fatal: dependency install failed${still ? ` (${still} still missing)` : ''}; run "npm ci" in ${gatewayDir}`);
    process.exit(1);
  }
  log('gateway dependencies installed');
}

for (const key of Object.keys(process.env)) {
  if (RUNTIME_ONLY.test(key)) delete process.env[key];
}

for (const file of envFileCandidates()) {
  // Key names only; values are never logged.
  const keys = loadEnv(file);
  log(`env ${file}: ${keys.length ? keys.join(', ') : 'nothing new'}`);
}

process.env.JACO_BASE_URL = resolveMcpCoreBaseUrl(process.env);
if (!process.env.JACO_MODEL_ID) process.env.JACO_MODEL_ID = 'mcp-client';
if (!process.env.JACO_GATEWAY_TOKEN && process.env.GATEWAY_TOKEN) {
  process.env.JACO_GATEWAY_TOKEN = process.env.GATEWAY_TOKEN;
}

log(
  `core=${process.env.JACO_BASE_URL} model=${process.env.JACO_MODEL_ID} ` +
  `token=${process.env.JACO_GATEWAY_TOKEN ? 'set' : 'MISSING (set JACO_GATEWAY_TOKEN or GATEWAY_TOKEN in a .env)'}`
);

if (!existsSync(server)) {
  log(`fatal: server not found at ${server}`);
  process.exit(1);
}

const missing = missingDependency();
if (missing) installDependencies(missing);

// config.mjs freezes its values at import time, so the environment above must
// already be in place before the server module is evaluated.
await import(pathToFileURL(server).href);
