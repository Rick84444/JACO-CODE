#!/usr/bin/env node
// Registers every model provider the operator actually has credentials for, probes each one and
// disables the ones that do not answer.
//
// The registry had three entries, one of them broken (DeepSeek behind the Ollama protocol, which
// could never work), while working credentials for Gemini and the HuggingFace router sat unused in
// .env. Routing quality depends on the registry being true, so this makes it true and keeps it true.
//
// Usage: node scripts/continuum/sync-providers.mjs [--probe] [--dry-run]
//   --probe  send one tiny completion per provider and disable those that fail

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const PROBE = args.includes('--probe');
const DRY_RUN = args.includes('--dry-run');

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]).filter(([, v]) => v));
}
const ROOT = path.resolve(process.cwd());
const env = { ...readEnvFile(path.join(ROOT, '.env')), ...readEnvFile(path.join(ROOT, '..', '.env')) };
const BASE = process.env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000';
const TOKEN = process.env.JACO_GATEWAY_TOKEN || env.JACO_GATEWAY_TOKEN || '';
const H = { 'Content-Type': 'application/json', ...(TOKEN ? { 'x-gateway-token': TOKEN } : {}) };

async function api(method, route, body) {
  const res = await fetch(`${BASE}/api/continuum${route}`, { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw new Error(`${method} ${route} -> ${res.status} ${JSON.stringify(json).slice(0, 220)}`);
  return json;
}

// priority is a preference score, not a cost: the local model stays first, paid models last.
const CATALOGUE = [
  {
    id: 'ollama-local', name: 'Ollama Local', protocol: 'ollama', local: true, priority: 10,
    baseUrl: process.env.JACO_OLLAMA_URL || 'http://127.0.0.1:11434',
    model: env.OLLAMA_MODEL || 'gemma3:4b', secretEnv: null,
    capabilities: ['reasoning', 'text', 'code'],
    requires: () => true,
  },
  {
    id: 'deepseek-planner', name: 'DeepSeek Flash (planning)', protocol: 'openai-chat', local: false, priority: 6,
    baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', secretEnv: 'DEEPSEEK_API_KEY',
    capabilities: ['reasoning', 'planning', 'text'],
    requires: (e) => Boolean(e.DEEPSEEK_API_KEY),
    probe: { reasoningEffort: 'low', maxOutputTokens: 2000 },
  },
  {
    id: 'deepseek-pro', name: 'DeepSeek V4 Pro (hard problems)', protocol: 'openai-chat', local: false, priority: 4,
    baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro', secretEnv: 'DEEPSEEK_API_KEY',
    capabilities: ['reasoning', 'planning', 'code', 'text'],
    requires: (e) => Boolean(e.DEEPSEEK_API_KEY),
    probe: { reasoningEffort: 'low', maxOutputTokens: 2000 },
  },
  {
    id: 'huggingface-router', name: 'HuggingFace Router', protocol: 'openai-chat', local: false, priority: 5,
    baseUrl: 'https://router.huggingface.co/v1', model: 'Qwen/Qwen3-8B', secretEnv: 'HUGGINGFACE_TOKEN',
    capabilities: ['reasoning', 'text'],
    requires: (e) => Boolean(e.HUGGINGFACE_TOKEN),
    probe: { maxOutputTokens: 500 },
  },
  {
    id: 'gemini-flash', name: 'Gemini 2.5 Flash', protocol: 'google-generate-content', local: false, priority: 3,
    baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash', secretEnv: 'GEMINI_API_KEY',
    capabilities: ['reasoning', 'text', 'vision'],
    requires: (e) => Boolean(e.GEMINI_API_KEY),
    probe: { maxOutputTokens: 500 },
  },
];

// Entries that exist in the registry but can never work, and should not be routed to.
const RETIRE = [{ id: 'deepseek-cloud', reason: 'registered under the ollama protocol against a cloud endpoint; every call failed' }];

const before = (await api('GET', '/providers')).providers || [];
console.log(`registry before: ${before.map((p) => p.id).join(', ') || '(empty)'}\n`);

for (const spec of CATALOGUE) {
  const has = spec.requires(env) || (spec.secretEnv && process.env[spec.secretEnv]);
  if (!has) { console.log(`skip  ${spec.id}: no ${spec.secretEnv} configured`); continue; }
  if (DRY_RUN) { console.log(`would register ${spec.id} (${spec.protocol}, ${spec.model})`); continue; }
  const { requires, probe, ...payload } = spec;
  const res = await api('POST', '/providers', { ...payload, enabled: true });
  console.log(`ok    ${spec.id.padEnd(20)} ${spec.protocol.padEnd(24)} secret=${res.provider.secretConfigured}`);
}

for (const dead of RETIRE) {
  const existing = before.find((p) => p.id === dead.id);
  if (!existing || DRY_RUN) continue;
  // The registry has no delete, so rewrite it as disabled with its reason recorded.
  await api('POST', '/providers', { ...existing, id: dead.id, enabled: false, notes: dead.reason });
  console.log(`off   ${dead.id}: ${dead.reason}`);
}

if (PROBE && !DRY_RUN) {
  console.log('\nprobing:');
  for (const spec of CATALOGUE) {
    if (!(spec.requires(env) || (spec.secretEnv && process.env[spec.secretEnv]))) continue;
    const started = Date.now();
    try {
      const res = await api('POST', '/models/reason', {
        providerId: spec.id,
        prompt: 'Reply with the single word: works',
        purpose: 'provider-probe',
        estimatedUsd: 0.002,
        timeoutMs: 120000,
        ...(spec.probe || {}),
      });
      const text = String(res.result?.text || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      console.log(`  pass ${spec.id.padEnd(20)} ${Date.now() - started} ms "${text}"`);
    } catch (error) {
      const message = String(error.message).slice(0, 150);
      console.log(`  FAIL ${spec.id.padEnd(20)} ${message}`);
      await api('POST', '/providers', { ...spec, enabled: false, notes: `probe failed: ${message}` });
      console.log(`       disabled ${spec.id}`);
    }
  }
}

const after = (await api('GET', '/providers')).providers || [];
console.log('\nregistry after:');
for (const p of after) console.log(`  ${p.id.padEnd(20)} ${p.protocol.padEnd(24)} enabled=${String(p.enabled).padEnd(5)} secret=${String(p.secretConfigured).padEnd(5)} reliability=${p.reliability}`);
