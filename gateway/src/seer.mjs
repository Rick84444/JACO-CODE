// JACO SEER — canonical cognitive + strategic kernel
// Persistent loop: purpose → beliefs → alternatives → mission → action → evidence → replan.
// Port 2997 | SQLite via Node 24 built-in | WebSocket pub/sub
// Start: node --experimental-sqlite gateway/src/seer.mjs

import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, renameSync } from 'node:fs';
import { buildAgentCard, joinWorkplace } from '../../agents/lib/workplace-session.mjs';
import { createStrategicKernel, SEER_PURPOSE } from './seer-strategy.mjs';
import { createMissionGraph } from './seer-mission-graph.mjs';
import { createMissionDispatcher } from './seer-mission-dispatch.mjs';
import { STRATEGIC_AGENT_INSTRUCTIONS } from '../../agents/lib/strategic-context.mjs';
import { buildSelfDevelopmentGraph } from './seer-self-development.mjs';
import { createAutonomyLoop, shouldAutoConfirmNova } from './seer-autonomy-loop.mjs';
import { createDevelopmentCycle, chooseGovernorFocus, governorBaseline } from './seer-development-cycle.mjs';
import { createExperienceStore } from './seer-experience-store.mjs';
import { discoverSeerLocalProvider, invokeSeerProvider, callSeerGovernorProvider, extractGovernorJson, providerOutputTruncated, budgetSeerLocalPrompt, compactGovernorGoals, clipGoalStatement, resolveAuraPlanner, invokeAuraPlanner } from './seer-model-provider.mjs';
import { createA2AColonyRevenueSync } from './a2acolony-revenue-sync.mjs';
import { normalizeProjectRoot, projectNodeContract, projectGraphPolicy, projectGoalGraph, projectGoalDone } from './seer-project.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const DB_DIR = process.env.SEER_STATE_DIR || join(ROOT, '.agent-state');
const PORT = parseInt(process.env.SEER_PORT || '2997');
const TOKEN = process.env.JACO_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || process.env.SEER_TOKEN || '';
if (TOKEN.length < 24) throw new Error('SEER_TOKEN_REQUIRED_MIN_24');

if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });

const db = new DatabaseSync(join(DB_DIR, 'seer.db'));
// WAL lets readers (diagnostics, Workplace, operator queries) coexist with SEER's
// writes; busy_timeout waits out a short lock instead of crashing the process
// with SQLITE_BUSY from emit().
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS missions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    goal TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    contract TEXT DEFAULT '{}',
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY,
    mission_id TEXT NOT NULL,
    step INTEGER NOT NULL,
    type TEXT NOT NULL,
    input TEXT DEFAULT '{}',
    precondition TEXT DEFAULT '{}',
    expected TEXT DEFAULT '{}',
    actual TEXT,
    delta REAL,
    status TEXT DEFAULT 'pending',
    error TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    executed_at INTEGER,
    verified_at INTEGER,
    FOREIGN KEY (mission_id) REFERENCES missions(id)
  );
  CREATE TABLE IF NOT EXISTS observations (
    id TEXT PRIMARY KEY,
    mission_id TEXT,
    action_id TEXT,
    source TEXT NOT NULL,
    data TEXT NOT NULL,
    certainty REAL DEFAULT 1.0,
    ts INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS experiences (
    id TEXT PRIMARY KEY,
    blueprint TEXT NOT NULL,
    tags TEXT DEFAULT '[]',
    uses INTEGER DEFAULT 0,
    success_rate REAL DEFAULT 1.0,
    promoted_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS memory (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    source TEXT DEFAULT 'system',
    ttl INTEGER,
    updated_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    capabilities TEXT DEFAULT '[]',
    endpoint TEXT,
    last_ping INTEGER DEFAULT (unixepoch()),
    status TEXT DEFAULT 'active'
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    source TEXT,
    ts INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_actions_mission ON actions(mission_id, step);
  CREATE INDEX IF NOT EXISTS idx_obs_mission ON observations(mission_id);
  CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, ts);
  CREATE INDEX IF NOT EXISTS idx_memory_ttl ON memory(ttl);
`);

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const now = () => Math.floor(Date.now() / 1000);
const jp = (value, fallback = {}) => {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
};
const js = value => JSON.stringify(value ?? {});

// ── Event stream ──────────────────────────────────────────────────────────────
const subscribers = new Set();
function broadcast(message) {
  const data = JSON.stringify(message);
  for (const ws of subscribers) {
    try { ws.send(data); } catch { subscribers.delete(ws); }
  }
}
function emit(type, payload, source = 'seer') {
  db.prepare('INSERT INTO events(type,payload,source) VALUES(?,?,?)').run(type, js(payload), source);
  broadcast({ type, payload, source, ts: Date.now() });
}

// Strategic state shares the canonical SEER SQLite database. It is advisory and
// stateful; execution authority remains Nova + ModelRelay + signed mandates.
const strategy = createStrategicKernel({ db, emit, uid, now, js, jp });
const missionGraph = createMissionGraph({ db, emit, uid, now, js, jp });

function computeDelta(expected, actual) {
  if (!expected || !actual) return 1.0;
  const exp = typeof expected === 'string' ? jp(expected) : expected;
  const act = typeof actual === 'string' ? jp(actual) : actual;
  const keys = new Set([...Object.keys(exp || {}), ...Object.keys(act || {})]);
  if (keys.size === 0) return 0;
  let mismatches = 0;
  for (const key of keys) if (js(exp[key]) !== js(act[key])) mismatches++;
  return mismatches / keys.size;
}

// ── Mission API ───────────────────────────────────────────────────────────────
const missions = {
  create({ title, goal, contract = {} }) {
    if (!title || !goal) throw new Error('mission title and goal are required');
    const id = uid();
    db.prepare('INSERT INTO missions(id,title,goal,contract) VALUES(?,?,?,?)').run(id, title, goal, js(contract));
    emit('mission.created', { id, title, goal });
    return { id, title, goal, status: 'active', contract };
  },
  get(id) {
    const mission = db.prepare('SELECT * FROM missions WHERE id=?').get(id);
    return mission ? { ...mission, contract: jp(mission.contract) } : null;
  },
  list(status = null) {
    const rows = status
      ? db.prepare('SELECT * FROM missions WHERE status=? ORDER BY created_at DESC').all(status)
      : db.prepare('SELECT * FROM missions ORDER BY created_at DESC').all();
    return rows.map(mission => ({ ...mission, contract: jp(mission.contract) }));
  },
  update(id, fields = {}) {
    const allowed = ['status', 'title', 'goal', 'contract'];
    const keys = Object.keys(fields).filter(key => allowed.includes(key));
    if (!keys.length) return missions.get(id);
    const values = keys.map(key => key === 'contract' ? js(fields[key]) : fields[key]);
    db.prepare(`UPDATE missions SET ${keys.map(key => `${key}=?`).join(',')},updated_at=? WHERE id=?`).run(...values, now(), id);
    emit('mission.updated', { id, ...fields });
    return missions.get(id);
  },
};

// ── Experience / Blueprint API ────────────────────────────────────────────────
// Query-aware, evidence-ranked reusable engineering experience. The store owns
// backward-compatible schema migration, deduplication, empirical reuse outcomes,
// and retrieval scoring; SEER owns when verified actions are admitted.
const experiences = createExperienceStore({ db, emit, uid, now });

// ── Action API ────────────────────────────────────────────────────────────────
const actions = {
  add({ mission_id, type, input = {}, precondition = {}, expected = {} }) {
    if (!missions.get(mission_id)) throw new Error('mission not found');
    const id = uid();
    const step = (db.prepare('SELECT COUNT(*) AS c FROM actions WHERE mission_id=?').get(mission_id)?.c || 0) + 1;
    db.prepare('INSERT INTO actions(id,mission_id,step,type,input,precondition,expected) VALUES(?,?,?,?,?,?,?)')
      .run(id, mission_id, step, type, js(input), js(precondition), js(expected));
    emit('action.added', { id, mission_id, type, step });
    return { id, step };
  },
  start(id) {
    db.prepare("UPDATE actions SET status='running',executed_at=? WHERE id=?").run(now(), id);
    emit('action.started', { id });
  },
  verify(id, actual = {}) {
    const action = db.prepare('SELECT * FROM actions WHERE id=?').get(id);
    if (!action) return null;
    const delta = computeDelta(action.expected, actual);
    const status = delta < 0.3 ? 'verified' : 'failed';
    db.prepare('UPDATE actions SET status=?,actual=?,delta=?,verified_at=? WHERE id=?').run(status, js(actual), delta, now(), id);
    emit('action.verified', { id, status, delta, actual });
    if (delta < 0.1) experiences.promote({ ...action, delta, actual }, missions.get(action.mission_id), actual);
    if (actual?.prediction_id) {
      try {
        strategy.predictions.resolve(actual.prediction_id, actual.outcome ?? actual);
      } catch (error) {
        emit('strategy.prediction.link_error', { action_id: id, prediction_id: actual.prediction_id, error: error.message });
      }
    }
    return { id, status, delta };
  },
  fail(id, error) {
    db.prepare("UPDATE actions SET status='failed',error=? WHERE id=?").run(String(error || 'unknown error'), id);
    emit('action.failed', { id, error: String(error || 'unknown error') });
  },
  list(mission_id) {
    return db.prepare('SELECT * FROM actions WHERE mission_id=? ORDER BY step').all(mission_id)
      .map(action => ({ ...action, input: jp(action.input), precondition: jp(action.precondition), expected: jp(action.expected), actual: jp(action.actual, null) }));
  },
  pending(mission_id) {
    const action = db.prepare("SELECT * FROM actions WHERE mission_id=? AND status='pending' ORDER BY step LIMIT 1").get(mission_id);
    return action ? { ...action, input: jp(action.input), precondition: jp(action.precondition), expected: jp(action.expected) } : null;
  },
};

// ── Observation API ───────────────────────────────────────────────────────────
const observations = {
  add({ mission_id = null, action_id = null, source, data, certainty = 1.0 }) {
    if (!source) throw new Error('observation source is required');
    const id = uid();
    db.prepare('INSERT INTO observations(id,mission_id,action_id,source,data,certainty) VALUES(?,?,?,?,?,?)')
      .run(id, mission_id, action_id, source, js(data), certainty);
    emit('observation', { id, source, certainty });
    return id;
  },
  latest(mission_id, limit = 10) {
    return db.prepare('SELECT * FROM observations WHERE mission_id=? ORDER BY ts DESC LIMIT ?').all(mission_id, Math.max(1, Number(limit) || 10))
      .map(observation => ({ ...observation, data: jp(observation.data) }));
  },
};

// ── Memory API ────────────────────────────────────────────────────────────────
// Durable memory (entries without TTL) lives in a fixed folder, one JSON file per key.
// The folder is the source of truth: it is loaded into SQLite at start and written through
// on every set/delete, so memory survives a lost or reset seer.db and can be read/edited by hand.
// With SEER_STATE_DIR (tests, isolated runs) the folder follows the state dir instead of the repo.
const MEMORY_DIR = process.env.JACO_MEMORY_DIR || (process.env.SEER_STATE_DIR ? join(DB_DIR, 'memory') : join(ROOT, '.jaco', 'memory', 'seer'));
// Readable file names for normal keys; long keys get a hashed suffix to stay within Windows path limits.
// The real key is stored inside the file, so the name only has to be unique and filesystem-safe.
const memoryFile = key => {
  const encoded = encodeURIComponent(key).replace(/[*'()!~]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const name = encoded.length > 120 ? `${encoded.slice(0, 80)}~${createHash('sha256').update(key).digest('hex').slice(0, 16)}` : encoded;
  return join(MEMORY_DIR, `${name}.json`);
};
function persistMemoryFile(key, value, source, updated_at) {
  try {
    mkdirSync(MEMORY_DIR, { recursive: true });
    const target = memoryFile(key);
    writeFileSync(`${target}.tmp`, JSON.stringify({ key, value, source, updated_at }, null, 2));
    renameSync(`${target}.tmp`, target);
  } catch (error) {
    // The SQLite row is already written; a folder failure must not break SEER.
    console.warn(`[SEER] memory folder write failed for ${String(key).slice(0, 80)}: ${error.message}`);
  }
}
function syncMemoryFolder() {
  mkdirSync(MEMORY_DIR, { recursive: true });
  let loaded = 0, exported = 0;
  for (const name of readdirSync(MEMORY_DIR).filter(n => n.endsWith('.json'))) {
    try {
      const entry = JSON.parse(readFileSync(join(MEMORY_DIR, name), 'utf8'));
      if (!entry?.key) continue;
      db.prepare('INSERT OR REPLACE INTO memory(key,value,source,ttl,updated_at) VALUES(?,?,?,NULL,?)')
        .run(entry.key, js(entry.value), entry.source || 'file', Number(entry.updated_at) || now());
      loaded++;
    } catch (error) { console.warn(`[SEER] memory file skipped ${name}: ${error.message}`); }
  }
  for (const row of db.prepare('SELECT * FROM memory WHERE ttl IS NULL').all()) {
    if (existsSync(memoryFile(row.key))) continue;
    persistMemoryFile(row.key, jp(row.value), row.source, row.updated_at);
    exported++;
  }
  console.log(`[SEER] memory folder ${MEMORY_DIR}: loaded ${loaded}, exported ${exported}`);
}

const memory = {
  set(key, value, source = 'system', ttl = null) {
    if (!key) throw new Error('memory key is required');
    const expiry = ttl ? now() + Number(ttl) : null;
    const updated = now();
    db.prepare('INSERT OR REPLACE INTO memory(key,value,source,ttl,updated_at) VALUES(?,?,?,?,?)').run(key, js(value), source, expiry, updated);
    if (expiry) { if (existsSync(memoryFile(key))) unlinkSync(memoryFile(key)); }
    else persistMemoryFile(key, value, source, updated);
    emit('memory.set', { key, source });
  },
  get(key) {
    const row = db.prepare('SELECT * FROM memory WHERE key=?').get(key);
    if (!row) return null;
    if (row.ttl && row.ttl < now()) {
      db.prepare('DELETE FROM memory WHERE key=?').run(key);
      return null;
    }
    return jp(row.value);
  },
  all(prefix = '') {
    const rows = db.prepare("SELECT * FROM memory WHERE key LIKE ? AND (ttl IS NULL OR ttl > ?)").all(`${prefix}%`, now());
    return Object.fromEntries(rows.map(row => [row.key, jp(row.value)]));
  },
  del(key) {
    db.prepare('DELETE FROM memory WHERE key=?').run(key);
    if (existsSync(memoryFile(key))) unlinkSync(memoryFile(key));
    emit('memory.deleted', { key });
  },
};
syncMemoryFolder();

const SYSTEM_MEMORY_IMAGE = Object.freeze({
  schema: 'jaco.system-memory-image/v1',
  identity: 'JACO is a model-independent Cognitive Runtime and A2A autonomous engineering system; Aura is the single operator workbench, SEER is strategic orchestration/memory, Nova executes, ModelRelay/Remote/Browser/Desktop are canonical actuators.',
  north_star: 'One operator goal should flow through memory -> reasoning -> planning -> capability/tool selection -> real execution -> independent verification -> repair/replan -> durable learning with minimal operator intervention.',
  architecture: {
    runtime_authority: 'JACO Runtime Kernel / canonical service graph',
    strategy: 'SEER',
    execution: 'Durable Nova missions',
    tools: ['local shell','npm/node/test','repository read/write','Git read/write/commit/push/merge','MCP','A2A','Remote/Desktop','Browser/CDP','Cloudflare','GitHub','skills','capabilities'],
    knowledge: ['SEER working memory','experiences','Continuum KnowledgeStore','CapabilityCompiler','evidence receipts'],
    ui: 'Aura single-chat workbench with explorer, editor, terminal, tools, Git, evidence and approvals only when genuinely required',
  },
  operator_profile: {
    autonomy_level: 5,
    default_authority: 'ALLOW_WITH_VERIFICATION',
    outgoing_financial_commitment: 'OPERATOR_APPROVAL_REQUIRED',
    local_execution: 'ALLOW',
    repository_write: 'ALLOW',
    git_commit_push_merge: 'ALLOW',
    web_and_browser: 'ALLOW',
    desktop_remote: 'ALLOW',
    skill_and_capability_creation: 'ALLOW',
    a2a_and_mcp_dispatch: 'ALLOW',
  },
  invariants: [
    'evidence_before_done',
    'single_writer_for_competing_mutations',
    'outgoing_financial_commitment_requires_operator_approval',
    'secrets_must_not_be_exposed_in_logs_prompts_or_artifacts',
    'reuse_and_improve_canonical_components_before_building_parallel_subsystems',
  ],
});

function seedSystemMemoryImage() {
  memory.set('system.memory_image', SYSTEM_MEMORY_IMAGE, 'operator-profile');
  memory.set('system.purpose', SEER_PURPOSE, 'operator-profile');
  memory.set('system.operator_policy', SYSTEM_MEMORY_IMAGE.operator_profile, 'operator-profile');
  memory.set('system.architecture', SYSTEM_MEMORY_IMAGE.architecture, 'operator-profile');
}
seedSystemMemoryImage();

function buildActiveMemoryContext() {
  const operatorGoal = memory.get('seer.operator_primary_goal');
  const experienceQuery = operatorGoal?.statement || '';
  return {
    system_memory: memory.all('system.'),
    operator_goal: operatorGoal,
    // Preserve the existing field name for prompt compatibility, but retrieve
    // against the active goal so SEER sees relevant proven patterns first.
    recent_experiences: experiences.search(experienceQuery, 4),
    strategic_state: strategy.state(),
    strategic_agent_instructions: STRATEGIC_AGENT_INSTRUCTIONS,
    mission_graphs: missionGraph.context(),
  };
}

// ── Agent registry ────────────────────────────────────────────────────────────
const agentRegistry = {
  ping({ id, name, capabilities = [], endpoint = null }) {
    if (!id || !name) throw new Error('agent id and name are required');
    db.prepare('INSERT OR REPLACE INTO agents(id,name,capabilities,endpoint,last_ping,status) VALUES(?,?,?,?,?,?)')
      .run(id, name, js(capabilities), endpoint, now(), 'active');
    emit('agent.ping', { id, name });
  },
  list() {
    const cutoff = now() - 60;
    db.prepare("UPDATE agents SET status='stale' WHERE last_ping < ? AND status='active'").run(cutoff);
    return db.prepare('SELECT * FROM agents').all().map(agent => ({ ...agent, capabilities: jp(agent.capabilities, []) }));
  },
};

// ── LLM bridge ────────────────────────────────────────────────────────────────
// seer-start.mjs selects one verified local provider and exposes it through the
// JACO_SEER_LOCAL_* contract. Direct seer.mjs launches keep backward-compatible
// Ollama behavior for tests/advanced operators. Paid providers remain disabled
// unless JACO_ALLOW_PAID_MODELS=1.
const legacyOllamaRoot = String(process.env.OLLAMA_BASE_URL || 'http://localhost:11434')
  .replace(/\/+$/, '')
  .replace(/\/v1$/i, '');

function bootstrapLocalProvider() {
  if (process.env.JACO_SEER_LOCAL_CHAT_URL && process.env.JACO_SEER_LOCAL_MODEL) {
    return {
      name: process.env.JACO_SEER_LOCAL_PROVIDER || 'local',
      url: process.env.JACO_SEER_LOCAL_CHAT_URL,
      envKey: null,
      model: process.env.JACO_SEER_LOCAL_MODEL,
      source: process.env.JACO_SEER_LOCAL_SOURCE || 'bootstrap',
      local: process.env.JACO_SEER_PROVIDER_LOCAL !== '0',
    };
  }
  if (process.env.JACO_SEER_BOOTSTRAP_NO_PROVIDER === '1') return null;
  return {
    name: 'ollama',
    url: `${legacyOllamaRoot}/v1/chat/completions`,
    envKey: null,
    model: process.env.OLLAMA_MODEL || process.env.JACO_OLLAMA_MODEL || 'llama3',
    source: 'direct-compatibility',
  };
}

let localLlmProvider = bootstrapLocalProvider();
let localProviderDiscovery = {
  lastAttemptAt: null,
  lastSuccessAt: localLlmProvider ? new Date().toISOString() : null,
  lastReason: localLlmProvider ? null : 'bootstrap-no-provider',
};

const PAID_LLM_PROVIDERS = [
  // Free tier first: tried before any metered provider when the local model fails.
  {
    name: 'groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    envKey: 'GROQ_API_KEY',
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    free: true,
  },
  {
    name: 'deepseek',
    url: 'https://api.deepseek.com/v1/chat/completions',
    envKey: 'DEEPSEEK_API_KEY',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
  },
  {
    name: 'qwen',
    url: process.env.QWEN_BASE_URL ? `${process.env.QWEN_BASE_URL.replace(/\/$/, '')}/chat/completions` : 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
    envKey: 'QWEN_API_KEY',
    model: process.env.QWEN_MODEL || 'qwen-max',
  },
  {
    name: 'gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    envKey: 'GEMINI_API_KEY',
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  },
];

function providerFromDiscovery(provider) {
  if (!provider) return null;
  return {
    name: provider.id,
    url: provider.chatUrl,
    envKey: null,
    model: provider.model,
    source: provider.source || 'rediscovery',
    local: provider.local,
  };
}

async function refreshLocalProvider() {
  const attemptedAt = new Date().toISOString();
  const selected = await discoverSeerLocalProvider();
  localProviderDiscovery = {
    lastAttemptAt: attemptedAt,
    lastSuccessAt: selected.provider ? attemptedAt : localProviderDiscovery.lastSuccessAt,
    lastReason: selected.reason || null,
  };
  localLlmProvider = providerFromDiscovery(selected.provider);
  return localLlmProvider;
}

async function invokeProvider(provider, { system, user, image, max_tokens, temperature }, failures = [], purpose = 'inference') {
  return invokeSeerProvider(provider, { system, user, image, max_tokens, temperature }, {
    purpose,
    onFailure: failure => {
      failures.push(failure);
      emit('provider.failed', failure);
    },
  });
}

async function callLLM({ system, user, image, max_tokens = 1024, temperature = 0.3, startup_probe = false, memory_chars, purpose = 'inference' }) {
  // A cloud model gets the full request (the governor asks for 8192: a cut-off plan is a failed turn);
  // local models keep the 2048 ceiling and the context budget below.
  const requestedTokens = Math.min(8192, Math.max(1, Number(max_tokens) || 1024));
  max_tokens = Math.min(2048, requestedTokens);
  const runtime = { runtimeUrl: process.env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000', token: process.env.GATEWAY_TOKEN || TOKEN };
  const aura = startup_probe ? null : await resolveAuraPlanner(runtime);
  const auraResult = aura ? await invokeAuraPlanner(aura, await seerPromptFor(aura, { system, user, image, temperature, memory_chars, startup_probe }, aura.local ? max_tokens : requestedTokens), {
    ...runtime, purpose, onFailure: failure => emit('provider.failed', failure),
  }) : null;
  if (auraResult) { emit('provider.used', { provider: aura.name, model: aura.model, source: 'aura-choice' }); return auraResult; }
  return callSeerLocalChain({ system, user, image, max_tokens, temperature, startup_probe, memory_chars, purpose });
}

// The request shape for one provider: every on-device model has a small context window and gets the
// budgeted prompt; only a remote one gets the unbudgeted prompt.
async function seerPromptFor(target, { system, user, image, temperature, memory_chars, startup_probe }, max_tokens) {
  let systemPrompt = String(system || '');
  let userPrompt = String(user || '');
  // A caller that brings its own live state (Aura chat) can ask for a smaller memory block: on a CPU
  // model every 1000 characters cost several seconds of prompt evaluation (2026-10-04: 12000 chars made
  // a one-word Aura answer take 60-90 s). 0 leaves the block out.
  const memoryLimit = memory_chars == null || !Number.isFinite(Number(memory_chars))
    ? Number(process.env.SEER_MEMORY_BLOCK_CHARS) || 12000
    : Math.min(Number(process.env.SEER_MEMORY_BLOCK_CHARS) || 12000, Math.max(0, Math.floor(Number(memory_chars))));
  if (!startup_probe && memoryLimit > 0) {
    const activeMemory = JSON.stringify(buildActiveMemoryContext());
    const wantsLlamaCpp = target?.name === 'llamacpp'
      || (target?.local !== false && String(process.env.JACO_SEER_PROVIDER_PREFERENCE || '').toLowerCase() === 'llamacpp');
    if (wantsLlamaCpp || (target && target.local !== false)) {
      const budget = budgetSeerLocalPrompt({
        system: systemPrompt, user: userPrompt, memory: activeMemory.slice(0, memoryLimit), maxTokens: max_tokens,
        contextTokens: Number((wantsLlamaCpp ? process.env.JACO_LLAMACPP_CTX : process.env.JACO_SEER_LOCAL_CTX) || 8192),
      });
      systemPrompt = budget.system;
      userPrompt = budget.user;
      max_tokens = budget.maxTokens;
    } else {
      systemPrompt = `${systemPrompt}\n\n[JACO ACTIVE MEMORY]\n${activeMemory.slice(0, memoryLimit)}\n[/JACO ACTIVE MEMORY]`;
    }
  }
  return { system: systemPrompt, user: userPrompt, image, max_tokens, temperature };
}

async function callSeerLocalChain({ system, user, image, max_tokens = 1024, temperature = 0.3, startup_probe = false, memory_chars, purpose = 'inference' }) {
  const attemptedLocal = localLlmProvider;
  const args = await seerPromptFor(attemptedLocal, { system, user, image, temperature, memory_chars, startup_probe }, max_tokens);
  const failures = [];
  let result = await invokeProvider(attemptedLocal, args, failures, purpose);
  if (result) return result;

  try {
    const refreshed = await refreshLocalProvider();
    // Discovery is not a retry budget: do not immediately repeat the same failed request.
    result = refreshed && (refreshed.url !== attemptedLocal?.url || refreshed.model !== attemptedLocal?.model)
      ? await invokeProvider(refreshed, args, failures, purpose) : null;
    if (result) return result;
  } catch (error) {
    localProviderDiscovery = {
      ...localProviderDiscovery,
      lastAttemptAt: new Date().toISOString(),
      lastReason: String(error?.message || error),
    };
  }

  const configuredFallbacks = new Set(String(process.env.JACO_SEER_CLOUD_FALLBACKS || '').split(',').map(value => value.trim()).filter(Boolean));
  // The operator's primary provider (JACO_PRIMARY_PROVIDER, the same switch Nova and the governor use)
  // is tried before the free tier when it is an allowed fallback (operator 2026-10-08: run on DeepSeek).
  const primary = String(process.env.JACO_PRIMARY_PROVIDER || '');
  const ordered = [...PAID_LLM_PROVIDERS].sort((a, b) => Number(b.name === primary && configuredFallbacks.has(b.name)) - Number(a.name === primary && configuredFallbacks.has(a.name)));
  for (const provider of ordered) {
    if (!provider.free && !configuredFallbacks.has(provider.name)) continue;
    result = await invokeProvider(provider, args, failures, purpose);
    if (result) return result;
  }
  return { ok: false, text: null, error: 'all_providers_failed', failures: failures.slice(-8) };
}

// Governor cloud routing follows the configured primary provider only when both
// cloud planning and the paid-model gate are enabled.
async function callGovernorLLM({ system, user, image, max_tokens = 2048, temperature = 0.2 }) {
  return callSeerGovernorProvider({ system, user, image, max_tokens, temperature }, {
    providers: PAID_LLM_PROVIDERS, fallback: callLLM,
    onFailure: failure => emit('provider.failed', failure),
    onUsed: provider => emit('governor.provider_used', provider),
  });
}

function buildClaudeContext() {
  const activeMissions = missions.list('active');
  return {
    generated_at: new Date().toISOString(),
    strategy: strategy.state(),
    mission_graphs: missionGraph.context(),
    strategic_agent_instructions: STRATEGIC_AGENT_INSTRUCTIONS,
    active_missions: activeMissions.map(mission => ({
      ...mission,
      pending_action: actions.pending(mission.id),
      recent_observations: observations.latest(mission.id, 3),
    })),
    agents: agentRegistry.list(),
    working_memory: memory.all(),
    recent_events: db.prepare('SELECT * FROM events ORDER BY ts DESC LIMIT 20').all().map(event => ({ ...event, payload: jp(event.payload) })),
    recent_experiences: experiences.search('', 5),
  };
}

// ── Workplace ─────────────────────────────────────────────────────────────────
let workplace = { state: 'REGISTERING', error: null };

function auth(req) {
  const header = req.headers.authorization || '';
  return header === `Bearer ${TOKEN}` || header === TOKEN;
}

async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 3_000_000) throw new Error('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
  catch { throw new Error('INVALID_JSON'); }
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data, null, 2));
}

async function createNovaGraphMission(spec) {
  const response = await fetch(`${process.env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000'}/api/connected/nova/missions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-gateway-token': process.env.GATEWAY_TOKEN || TOKEN },
    body: JSON.stringify(spec),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok || data?.success === false) {
    const detail = typeof data?.error === 'string' ? data.error : `NOVA_MISSION_HTTP_${response.status}`;
    throw new Error(detail);
  }
  const novaMission = data?.mission || data;
  if (!novaMission?.id) throw new Error('NOVA_MISSION_ID_MISSING');
  return novaMission;
}

// The explicit end of a strategic goal: its open graphs stop (dispatch reconciliation then stops their
// Nova missions) and it is no longer the operator's primary goal. History stays as it is.
function cancelStrategicGoal(goalId, reason = 'Operator ended the strategic goal') {
  if (!strategy.goals.get(goalId)) throw new Error('STRATEGIC_GOAL_NOT_FOUND');
  const graphs = missionGraph.list().filter(graph => graph.policy?.strategic_goal_id === goalId && ['ACTIVE','NEEDS_REPLAN'].includes(graph.status))
    .map(graph => missionGraph.cancel(graph.id, { reason, actor: 'operator' }).id);
  const goal = strategy.goals.cancel(goalId);
  const primary = memory.get('seer.operator_primary_goal');
  if (primary?.id === goalId) memory.set('seer.operator_primary_goal', null, 'operator');
  return { goal, cancelledGraphs: graphs };
}

async function cancelNovaGraphMission(id) {
  const response = await fetch(`${process.env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000'}/api/connected/nova/missions/${encodeURIComponent(id)}/cancel`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-gateway-token': process.env.GATEWAY_TOKEN || TOKEN },
    body: JSON.stringify({ note: 'SEER propagates the durable parent stop during dispatch reconciliation.' }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  if (!response.ok || data?.success === false) throw new Error(data?.error || `NOVA_CANCEL_HTTP_${response.status}`);
  if (!data?.mission || (data.mission.status !== 'CANCELLED' && !data.mission.cancelRequested && !['DONE','FAILED'].includes(data.mission.status))) {
    throw new Error('NOVA_CANCEL_NOT_ACKNOWLEDGED');
  }
  return data.mission;
}

const missionDispatcher = createMissionDispatcher({ missionGraph, createNova: createNovaGraphMission, cancelNova: cancelNovaGraphMission, emit });
const dispatchGraphNode = (graphId, nodeKey) => missionDispatcher.dispatch(graphId, nodeKey);

const NOVA_RECONCILE_INTERVAL_MS = Math.max(1_000, Math.min(60_000, Number(process.env.SEER_NOVA_RECONCILE_MS || 5_000)));
const AUTONOMY_INTERVAL_MS = Math.max(0, Math.min(60_000, Number(process.env.SEER_AUTONOMY_LOOP_MS ?? 2_500)));
const AUTONOMY_MAX_REPLANS = Math.max(0, Math.min(20, Number(process.env.SEER_AUTONOMY_MAX_REPLANS ?? 3)));
const AUTONOMY_MAX_DISPATCH = Math.max(1, Math.min(20, Number(process.env.SEER_AUTONOMY_MAX_DISPATCH ?? 2)));
let novaReconcileInFlight = false;
let novaReconcileTimer = null;
let autonomyTimer = null;
const novaReconcileErrors = new Map();
const missingNovaBindings = new Map();
const autonomyLoop = createAutonomyLoop({
  missionGraph,
  callLLM,
  dispatch: dispatchGraphNode,
  emit,
  maxReplans: AUTONOMY_MAX_REPLANS,
  maxDispatchPerTurn: AUTONOMY_MAX_DISPATCH,
});

async function fetchNovaMission(novaMissionId) {
  const response = await fetch(`${process.env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000'}/api/connected/nova/missions/${encodeURIComponent(novaMissionId)}`, {
    headers: { 'x-gateway-token': process.env.GATEWAY_TOKEN || TOKEN },
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json();
  if (!response.ok || data?.success === false) {
    const detail = typeof data?.error === 'string' ? data.error : `NOVA_MISSION_HTTP_${response.status}`;
    throw new Error(detail);
  }
  const mission = data?.mission || data;
  if (!mission?.id) throw new Error('NOVA_MISSION_ID_MISSING');
  return mission;
}

async function resolveNovaMission(novaMissionId, payload) {
  const response = await fetch(`${process.env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000'}/api/connected/nova/missions/${encodeURIComponent(novaMissionId)}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-gateway-token': process.env.GATEWAY_TOKEN || TOKEN },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json();
  if (!response.ok || data?.success === false) {
    const detail = typeof data?.error === 'string' ? data.error : `NOVA_RESOLVE_HTTP_${response.status}`;
    throw new Error(detail);
  }
  return data?.mission || data;
}

async function reconcileGraphNode(graphId, nodeKey) {
  const graph = missionGraph.get(graphId);
  const node = graph?.nodes?.find(item => item.key === nodeKey);
  if (!node) throw new Error('MISSION_GRAPH_NODE_NOT_FOUND');
  if (!node.nova_mission_id) throw new Error('NOVA_MISSION_NOT_BOUND');

  let novaMission = await fetchNovaMission(node.nova_mission_id);
  if (shouldAutoConfirmNova(graph, novaMission)) {
    novaMission = await resolveNovaMission(node.nova_mission_id, {
      decision: 'confirm',
      authority: 'seer',
      note: 'SEER closed-loop confirmation: machine-verified receipts satisfy the pre-authorized Mission Graph.',
    });
    emit('autonomy.nova_confirmed', {
      graph_id: graphId,
      node_key: nodeKey,
      nova_mission_id: node.nova_mission_id,
    });
  }

  return missionGraph.reconcileNova(graphId, nodeKey, novaMission);
}

// Graphs whose running work waits on an operator decision (graph id -> since). They keep their goal from
// being planned twice but do not hold a governor slot: SEER works on something else meanwhile instead of
// standing still on the operator (operator 2026-10-08).
const graphsWaitingOnOperator = new Map();
const OPERATOR_WAIT_OUTCOMES = new Set(['operator_required', 'awaiting_operator', 'blocked']);

async function reconcileNovaMissionGraphs() {
  if (novaReconcileInFlight) return;
  novaReconcileInFlight = true;
  try {
    await missionDispatcher.reconcile();
    const graphs = missionGraph.list().filter(graph => ['ACTIVE','NEEDS_REPLAN'].includes(graph.status));
    for (const id of [...graphsWaitingOnOperator.keys()]) if (!graphs.some(graph => graph.id === id)) graphsWaitingOnOperator.delete(id);
    for (const graph of graphs) {
      const outcomes = [];
      for (const node of graph.nodes.filter(item => item.nova_mission_id && ['DISPATCHED','RUNNING'].includes(item.status))) {
        const key = `${graph.id}:${node.key}`;
        try {
          const result = await reconcileGraphNode(graph.id, node.key);
          outcomes.push(result.outcome);
          novaReconcileErrors.delete(key);
          missingNovaBindings.delete(key);
          if (['verified','failed'].includes(result.outcome)) {
            const terminalEvent = {
              graph_id: graph.id,
              node_key: node.key,
              nova_mission_id: node.nova_mission_id,
              outcome: result.outcome,
            };
            emit('mission_graph.node.reconcile_terminal', terminalEvent);
            developmentCycle.trigger('mission-terminal', {
              eventKey: `${graph.id}:${node.key}:${result.outcome}`,
            });
          }
        } catch (error) {
          if (error.message === 'NOVA_MISSION_NOT_FOUND') {
            const count = (missingNovaBindings.get(key) || 0) + 1;
            missingNovaBindings.set(key, count);
            if (count >= 3) {
              missionGraph.reconcileNova(graph.id, node.key, { id: node.nova_mission_id, status: 'MISSING', observedMissing: true, observedAt: new Date().toISOString() });
              missingNovaBindings.delete(key);
              developmentCycle.trigger('missing-binding-quarantined', { eventKey: `missing-binding:${graph.id}:${node.key}` });
            }
          } else missingNovaBindings.delete(key);
          if (novaReconcileErrors.get(key) !== error.message) {
            novaReconcileErrors.set(key, error.message);
            emit('mission_graph.node.reconcile_error', {
              graph_id: graph.id,
              node_key: node.key,
              nova_mission_id: node.nova_mission_id,
              error: error.message,
            });
          }
        }
      }
      const waiting = outcomes.length > 0 && outcomes.every(outcome => OPERATOR_WAIT_OUTCOMES.has(outcome));
      if (waiting && !graphsWaitingOnOperator.has(graph.id)) {
        graphsWaitingOnOperator.set(graph.id, new Date().toISOString());
        emit('mission_graph.waiting_on_operator', { graph_id: graph.id, outcomes });
        // Reconsider now: the slot this graph held can go to other work.
        developmentCycle.trigger('graph-waiting-on-operator', { eventKey: `waiting:${graph.id}:${graphsWaitingOnOperator.get(graph.id)}` });
      } else if (!waiting && outcomes.length) graphsWaitingOnOperator.delete(graph.id);
    }
  } finally {
    novaReconcileInFlight = false;
  }
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const GET = req.method === 'GET';
  const POST = req.method === 'POST';

  if (GET && path === '/health') {
    const state = strategy.state();
    return json(res, {
      ok: true,
      service: 'seer',
      strategic_governor: true,
      purpose_id: state.purpose?.id || null,
      open_predictions: state.open_predictions.length,
      autonomy: {
        enabled: AUTONOMY_INTERVAL_MS > 0,
        interval_ms: AUTONOMY_INTERVAL_MS,
        ...autonomyLoop.state(),
      },
      development_cycle: developmentCycle.state(),
      local_model: localLlmProvider ? {
        provider: localLlmProvider.name,
        model: localLlmProvider.model,
        source: localLlmProvider.source,
        // "local_model" names the slot, not where inference runs: an operator may route it to an
        // Ollama cloud model on purpose. Agents reading health must see that truthfully.
        hosting: localLlmProvider.local === false ? 'remote' : 'on-device',
      } : null,
      local_model_discovery: localProviderDiscovery,
      ts: Date.now(),
    });
  }

  if (!auth(req)) return json(res, { error: 'unauthorized' }, 401);

  try {
    if (GET && path === '/cortex/context/claude') {
      const context = buildClaudeContext();
      try {
        const response = await fetch(`${process.env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000'}/api/connected/nova/current`, {
          headers: { 'x-gateway-token': process.env.GATEWAY_TOKEN || TOKEN },
          signal: AbortSignal.timeout(5000),
        });
        const data = await response.json();
        if (!response.ok || data.success !== true) throw new Error('NOVA_RUNTIME_UNAVAILABLE');
        context.nova = { source: 'durable-runtime', mission: data.mission };
      } catch (error) {
        context.nova = { available: false, error: error.message };
      }
      return json(res, context);
    }

    // Nova has one authoritative mission store. SEER routes to it; SEER does not copy it.
    if ((GET || POST) && /^\/cortex\/nova\/(current|missions(?:\/[^/]+(?:\/(?:claim|begin|finish|release|resolve))?)?)$/.test(path)) {
      const suffix = path.slice('/cortex/nova'.length);
      const response = await fetch(`${process.env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000'}/api/connected/nova${suffix}`, {
        method: req.method,
        headers: { 'content-type': 'application/json', 'x-gateway-token': process.env.GATEWAY_TOKEN || TOKEN },
        ...(POST ? { body: JSON.stringify(await body(req)) } : {}),
        signal: AbortSignal.timeout(15000),
      });
      return json(res, await response.json(), response.status);
    }

    // ── Evidence-backed experience retrieval
    if (GET && path === '/cortex/experiences') {
      const query = String(url.searchParams.get('q') || '').slice(0, 4000);
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 5));
      const results = experiences.search(query, limit);
      return json(res, {
        schema: 'jaco.experience-search/v1',
        query,
        count: results.length,
        experiences: results,
      });
    }
    const experienceOutcomeMatch = path.match(/^\/cortex\/experiences\/([^/]+)\/outcome$/);
    if (POST && experienceOutcomeMatch) {
      const payload = await body(req);
      if (typeof payload.success !== 'boolean') return json(res, { error: 'EXPERIENCE_OUTCOME_SUCCESS_REQUIRED' }, 400);
      const id = decodeURIComponent(experienceOutcomeMatch[1]);
      const updated = experiences.recordUse(id, { success: payload.success });
      return json(res, updated || { error: 'experience not found' }, updated ? 200 : 404);
    }

    // ── Strategic Governor
    if (GET && path === '/cortex/strategy/state') return json(res, strategy.state());
    if (GET && path === '/cortex/strategy/goals') return json(res, strategy.goals.list(url.searchParams.get('status') || 'active'));
    if (POST && path === '/cortex/strategy/goals') return json(res, strategy.goals.create(await body(req)), 201);
    const goalCancelMatch = path.match(/^\/cortex\/strategy\/goals\/([^/]+)\/cancel$/);
    if (POST && goalCancelMatch) {
      const payload = await body(req);
      if (payload.confirm !== true) return json(res, { error: 'GOAL_CANCEL_CONFIRM_REQUIRED' }, 400);
      return json(res, cancelStrategicGoal(decodeURIComponent(goalCancelMatch[1]), payload.reason));
    }
    if (POST && path === '/cortex/strategy/start') {
      const payload = await body(req);
      const statement = String(payload.goal || payload.statement || '').trim();
      if (!statement) return json(res, { error: 'GOAL_REQUIRED' }, 400);
      if (statement.length > 12000) return json(res, { error: 'GOAL_TOO_LARGE' }, 400);
      let projectRoot;
      try { projectRoot = normalizeProjectRoot(payload.project_root); }
      catch (error) { return json(res, { error: error.message }, 400); }
      const rawToolHint = payload.tool_hint && typeof payload.tool_hint === 'object' && !Array.isArray(payload.tool_hint)
        ? payload.tool_hint : null;
      const toolHint = rawToolHint && String(rawToolHint.toolName || '').trim() ? {
        kind: ['agent','mcp'].includes(String(rawToolHint.kind)) ? String(rawToolHint.kind) : null,
        provider: rawToolHint.provider == null ? null : String(rawToolHint.provider).slice(0,120),
        agentId: rawToolHint.agentId == null ? null : String(rawToolHint.agentId).slice(0,240),
        agentName: rawToolHint.agentName == null ? null : String(rawToolHint.agentName).slice(0,240),
        toolName: String(rawToolHint.toolName).slice(0,240),
      } : null;
      const goal = strategy.goals.create({
        statement,
        horizon: payload.horizon || 'medium',
        priority: payload.priority ?? 1,
        status: 'active',
        success_criteria: payload.success_criteria || { operator_prompt: true, verified_progress_required: true },
        invariants: [
          'operator_authority',
          'evidence_before_claim',
          'outgoing_financial_commitment_requires_operator_approval',
          'active_memory_before_planning',
          ...(Array.isArray(payload.invariants) ? payload.invariants.map(String).slice(0, 20) : []),
        ],
      });
      memory.set('seer.operator_primary_goal', {
        id: goal.id,
        statement: goal.statement,
        activated_at: new Date().toISOString(),
        source: 'operator-start-prompt',
        tool_hint: toolHint,
        project_root: projectRoot,
      }, 'operator');
      emit('strategy.operator_goal.activated', { goal_id: goal.id, statement: goal.statement });
      const development = developmentCycle.trigger('operator-goal', {
        eventKey: `operator-goal:${goal.id}`,
        force: true,
      });
      return json(res, {
        schema: 'jaco.operator-goal/v1',
        goal,
        development_cycle: development,
      }, 201);
    }
    if (GET && path === '/cortex/strategy/beliefs') return json(res, strategy.beliefs.list(url.searchParams.get('limit') || 100));
    if (POST && path === '/cortex/strategy/beliefs/observe') return json(res, strategy.beliefs.observe(await body(req)), 201);
    if (GET && path === '/cortex/strategy/decisions') return json(res, strategy.decisions.list(url.searchParams.get('limit') || 100));
    if (POST && path === '/cortex/strategy/decide') return json(res, strategy.decisions.decide(await body(req)), 201);
    if (GET && path === '/cortex/strategy/predictions') return json(res, strategy.predictions.list(url.searchParams.get('status') || null, url.searchParams.get('limit') || 100));
    if (POST && path.startsWith('/cortex/strategy/predictions/') && path.endsWith('/resolve')) {
      const id = path.split('/')[4];
      const payload = await body(req);
      return json(res, strategy.predictions.resolve(id, payload.actual ?? payload));
    }
    if (POST && path === '/cortex/strategy/capabilities/record') {
      const payload = await body(req);
      return json(res, { id: strategy.selfModel.record(payload), self_model: strategy.selfModel.summary() }, 201);
    }
    if (GET && path === '/cortex/strategy/capabilities') return json(res, strategy.selfModel.summary());
    if (POST && path === '/cortex/strategy/economy/record') return json(res, strategy.economy.record(await body(req)), 201);
    if (GET && path === '/cortex/strategy/economy') return json(res, strategy.economy.summary());

    // ── Contract-bound self-development
    // SEER may create code-improvement work only through an explicit coding contract.
    if (POST && path === '/cortex/self-development') {
      const payload = await body(req);
      const graph = missionGraph.create(buildSelfDevelopmentGraph(payload));
      emit('self_development.created', {
        graph_id: graph.id,
        objective: graph.objective,
        mutation_scope: graph.policy?.mutation_scope || [],
      });
      if (payload.dispatch === true) {
        const dispatched = await dispatchGraphNode(graph.id, 'code-change');
        return json(res, { schema: 'jaco.self-development/v1', ...dispatched }, 201);
      }
      return json(res, { schema: 'jaco.self-development/v1', graph }, 201);
    }

    // ── Long-horizon Mission Graph
    // SEER owns dependency/orchestration state. Nova remains the only execution owner.
    if (GET && path === '/cortex/mission-graphs') return json(res, missionGraph.list(url.searchParams.get('status') || null));
    if (POST && path === '/cortex/mission-graphs') return json(res, missionGraph.create(await body(req)), 201);

    if (GET && path === '/cortex/strategic-board') return json(res, {
      owner: 'seer', instructions: STRATEGIC_AGENT_INSTRUCTIONS,
      graphs: missionGraph.context(),
    });
    const boardMatch = path.match(/^\/cortex\/mission-graphs\/([^/]+)\/board$/);
    if (GET && boardMatch) {
      const graph = missionGraph.get(decodeURIComponent(boardMatch[1]));
      return graph ? json(res, { status: graph.status, board: graph.strategic_board, instructions: STRATEGIC_AGENT_INSTRUCTIONS })
        : json(res, { error: 'MISSION_GRAPH_NOT_FOUND' }, 404);
    }

    const graphNodeMatch = path.match(/^\/cortex\/mission-graphs\/([^/]+)\/nodes\/([^/]+)\/(dispatch|running|verify|fail|reconcile)$/);
    if (graphNodeMatch && POST) {
      const graphId = decodeURIComponent(graphNodeMatch[1]);
      const nodeKey = decodeURIComponent(graphNodeMatch[2]);
      const operation = graphNodeMatch[3];

      if (operation === 'dispatch') {
        return json(res, await dispatchGraphNode(graphId, nodeKey), 201);
      }
      if (operation === 'reconcile') {
        return json(res, await reconcileGraphNode(graphId, nodeKey));
      }

      const payload = await body(req);
      if (operation === 'running') return json(res, missionGraph.running(graphId, nodeKey, payload.nova_mission_id || null));
      if (operation === 'verify') {
        const result = missionGraph.verify(graphId, nodeKey, payload);
        resolveStrategicPrediction(graphId);
        return json(res, result);
      }
      if (operation === 'fail') {
        const result = missionGraph.fail(graphId, nodeKey, payload);
        resolveStrategicPrediction(graphId);
        return json(res, result);
      }
    }

    const graphMatch = path.match(/^\/cortex\/mission-graphs\/([^/]+)(?:\/(ready|checkpoints|replan|recover|cancel))?$/);
    if (graphMatch) {
      const graphId = decodeURIComponent(graphMatch[1]);
      const operation = graphMatch[2] || null;
      if (GET && !operation) {
        const graph = missionGraph.get(graphId);
        return json(res, graph || { error: 'not found' }, graph ? 200 : 404);
      }
      if (GET && operation === 'ready') return json(res, missionGraph.ready(graphId));
      if (POST && operation === 'cancel') {
        const payload = await body(req);
        // Stopping work is never implicit consent to abandon its strategic goal.
        // In particular, reject the legacy cancel_goal switch before changing
        // any graph; strategic cancellation requires its own confirmed endpoint.
        if (payload.cancel_goal === true) {
          return json(res, { error: 'STRATEGIC_GOAL_CANCEL_REQUIRES_CONFIRMED_ROUTE' }, 400);
        }
        const graph = missionGraph.cancel(graphId, {reason:payload.reason || 'Operator stopped this work from Aura',actor:'operator'});
        return json(res, graph);
      }
      if (POST && operation === 'checkpoints') return json(res, missionGraph.checkpoint(graphId, await body(req)), 201);
      if (POST && operation === 'replan') return json(res, missionGraph.replan(graphId, await body(req)), 201);
      if (POST && operation === 'recover') {
        const payload = await body(req);
        if (!payload.checkpoint_id) throw new Error('CHECKPOINT_ID_REQUIRED');
        return json(res, missionGraph.recover(graphId, payload.checkpoint_id));
      }
    }

    // ── Legacy SEER mission memory remains available for backward compatibility.
    if (GET && path === '/cortex/missions') return json(res, missions.list(url.searchParams.get('status')));
    if (POST && path === '/cortex/missions') return json(res, missions.create(await body(req)), 201);
    if (GET && path.startsWith('/cortex/missions/')) {
      const id = path.split('/')[3];
      if (path.endsWith('/actions')) return json(res, actions.list(id));
      const mission = missions.get(id);
      return json(res, mission || { error: 'not found' }, mission ? 200 : 404);
    }
    if (POST && path.startsWith('/cortex/missions/')) {
      const parts = path.split('/');
      const id = parts[3];
      if (parts[4] === 'actions') return json(res, actions.add({ mission_id: id, ...(await body(req)) }), 201);
      if (parts[4] === 'update') return json(res, missions.update(id, await body(req)) || { ok: true });
      if (parts[4] === 'complete') return json(res, missions.update(id, { status: 'completed' }) || { ok: true });
    }

    if (POST && path.startsWith('/cortex/actions/')) {
      const parts = path.split('/');
      const id = parts[3];
      if (parts[4] === 'start') { actions.start(id); return json(res, { ok: true }); }
      if (parts[4] === 'verify') { const payload = await body(req); return json(res, actions.verify(id, payload.actual ?? payload)); }
      if (parts[4] === 'fail') { const payload = await body(req); actions.fail(id, payload.error); return json(res, { ok: true }); }
    }

    if (POST && path === '/cortex/observe') return json(res, { id: observations.add(await body(req)) }, 201);

    if (GET && path === '/cortex/memory') return json(res, memory.all(url.searchParams.get('prefix') || ''));
    if (GET && path.startsWith('/cortex/memory/')) return json(res, { key: path.slice(15), value: memory.get(path.slice(15)) });
    if (POST && path === '/cortex/memory') {
      const payload = await body(req);
      memory.set(payload.key, payload.value, payload.source, payload.ttl);
      return json(res, { ok: true });
    }
    if (req.method === 'DELETE' && path.startsWith('/cortex/memory/')) {
      memory.del(path.slice(15));
      return json(res, { ok: true });
    }

    if (GET && path === '/cortex/agents') return json(res, agentRegistry.list());
    if (POST && path === '/cortex/agents/ping') {
      agentRegistry.ping(await body(req));
      return json(res, { ok: true, strategic_context: { owner: 'seer', path: '/cortex/strategic-board',
        instructions: STRATEGIC_AGENT_INSTRUCTIONS, authority: 'context only' } });
    }

    // Dispatch only proposes synchronized Workplace candidates; it does not execute.
    if (POST && path === '/cortex/dispatch') {
      const payload = await body(req);
      if (workplace.state !== 'READY') return json(res, { error: 'WORKPLACE_UNSYNCED', state: workplace.state, detail: workplace.error }, 503);
      const requires = Array.isArray(payload.requires) ? payload.requires.map(String) : [];
      const { agents } = await workplace.client.agents();
      const candidates = agents
        .filter(agent => agent.agentId !== workplace.registration.agentId)
        .map(agent => ({ ...agent, working: agent.sessions.filter(session => ['READY', 'AVAILABLE'].includes(session.status)) }))
        .filter(agent => agent.working.length && requires.every(required => agent.card?.capabilities?.[required] === true))
        .map(agent => ({
          agentId: agent.agentId,
          name: agent.requestedName,
          agentType: agent.agentType,
          role: agent.card?.role?.primary ?? null,
          sessions: agent.working.map(session => ({ sessionId: session.sessionId, status: session.status, lastSeenAt: session.lastSeenAt })),
        }));
      return json(res, { task: payload.task ?? null, requires, agent: candidates[0] || null, candidates, capabilitiesVerified: false });
    }

    if (POST && path === '/cortex/brain') {
      const payload = await body(req);
      if (!payload.system || !payload.user) return json(res, { error: 'system and user required' }, 400);
      const result = await callLLM(payload);
      return json(res, result, result.ok ? 200 : 503);
    }

    if (GET && path === '/cortex/experiences') return json(res, experiences.search(url.searchParams.get('q') || '', url.searchParams.get('limit') || 5));

    if (GET && path === '/cortex/events') {
      const since = parseInt(url.searchParams.get('since') || '0');
      const events = db.prepare('SELECT * FROM events WHERE ts > ? ORDER BY ts DESC,id DESC LIMIT 100').all(since)
        .map(event => ({ ...event, payload: jp(event.payload) }));
      return json(res, events);
    }

    return json(res, { error: 'not found' }, 404);
  } catch (error) {
    emit('seer.error', { path, method: req.method, message: error.message });
    return json(res, { error: error.message }, 400);
  }
});

server.on('upgrade', (req, socket) => {
  if (!auth(req) || req.url !== '/cortex/events/ws') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const ws = {
    send: data => {
      const buffer = Buffer.from(data);
      const header = buffer.length < 126
        ? Buffer.from([0x81, buffer.length])
        : buffer.length < 65536
          ? Buffer.from([0x81, 126, buffer.length >> 8, buffer.length & 0xff])
          : Buffer.concat([Buffer.from([0x81, 127]), (() => { const n = Buffer.alloc(8); n.writeBigUInt64BE(BigInt(buffer.length)); return n; })()]);
      socket.write(Buffer.concat([header, buffer]));
    },
  };
  subscribers.add(ws);
  socket.on('close', () => subscribers.delete(ws));
  socket.on('error', () => subscribers.delete(ws));
});

server.listen(PORT, '127.0.0.1', () => {
  const listeningPort = server.address().port;
  console.log(`JACO_SEER_LISTENING port=${listeningPort}`);
  console.log(`JACO SEER Strategic Governor :${listeningPort}  SQLite → ${join(DB_DIR, 'seer.db')}`);
  console.log('  /health                      — liveness + governor state');
  console.log('  /cortex/strategy/state       — purpose, beliefs, decisions, predictions, self-model, economy');
  console.log('  /cortex/strategy/decide      — compare multiple candidates; never grants financial authority');
  console.log('  /cortex/context/claude       — authenticated strategic context + Nova receipts');
  console.log('  /cortex/nova/*               — canonical durable Nova mission routing');
  console.log('  /cortex/self-development    — contract-bound autonomous code improvement');
  console.log('  /cortex/mission-graphs       — SEER-owned long-horizon DAG orchestration');
  console.log('  /cortex/memory               — persistent key-value compatibility memory');

  agentRegistry.ping({
    id: 'seer',
    name: 'JACO SEER Strategic Governor',
    capabilities: ['strategy', 'beliefs', 'prediction-ledger', 'economic-observation', 'mission-orchestration', 'self-development', 'active-memory', 'knowledge-retrieval', 'capability-routing', 'skill-selection', 'memory', 'missions', 'dispatch', 'observe'],
  });

  joinWorkplace({
    card: buildAgentCard({
      stableId: 'seer',
      name: 'SEER',
      agentType: 'strategic',
      role: 'strategic-governor',
      description: 'JACO strategic cognitive core. Maintains purpose, beliefs, alternatives, predictions and capability/economic evidence; routes execution through canonical Nova and ModelRelay rather than creating a second executor.',
      capabilities: {
        reasoning: true,
        strategy: true,
        database: true,
        memory: true,
        capability_routing: true,
        skill_selection: true,
        terminal: false,
        filesystem_write: false,
        browser_control: false,
        desktop_control: false,
        deployment: false,
      },
      tools: ['strategy', 'strategic-board', 'self-development', 'mission-graphs', 'missions', 'memory', 'active-memory', 'knowledge', 'capabilities', 'skills', 'observations', 'experiences', 'brain', 'dispatch'],
      constraints: [
        'Evidence before claim',
        'Paid model providers stay disabled unless JACO_ALLOW_PAID_MODELS=1',
        'Financial execution requires ModelRelay signed mandate; SEER cannot self-authorize spend',
        'Dispatch proposes candidates; it does not execute tasks',
        'Nova durable mission store remains authoritative for execution',
        'SEER owns Mission Graph dependencies, checkpoints and replanning; Aura is presentation only',
        'In-flight recovery fails closed and requires reconciliation before redispatch',
        'Self-development is coding-contract bound; no implicit push, deploy or root-authority mutation',
      ],
      preferredTasks: ['strategy', 'planning', 'hypothesis-comparison', 'dispatch', 'memory'],
    }),
    disabled: 'capability dispatch stays disabled',
    log: (level, message) => console.log(`${level.toUpperCase()} [workplace] ${message}`),
  }).then(session => { workplace = session; });

  emit('strategy.started', {
    purpose_id: strategy.state().purpose?.id || null,
    execution_authority: 'nova+modelrelay',
    orchestration_authority: 'seer-mission-graph',
    financial_authority: 'signed-modelrelay-mandate-only',
  });

  novaReconcileTimer = setInterval(() => {
    reconcileNovaMissionGraphs().catch(error => emit('mission_graph.reconcile_loop_error', { error: error.message }));
  }, NOVA_RECONCILE_INTERVAL_MS);
  novaReconcileTimer.unref?.();
  reconcileNovaMissionGraphs().catch(error => emit('mission_graph.reconcile_loop_error', { error: error.message }));

  if (AUTONOMY_INTERVAL_MS > 0) {
    autonomyTimer = setInterval(() => {
      autonomyLoop.turn().catch(error => emit('autonomy.loop_error', { error: error.message }));
    }, AUTONOMY_INTERVAL_MS);
    autonomyTimer.unref?.();
    setTimeout(() => {
      autonomyLoop.turn().catch(error => emit('autonomy.startup_error', { error: error.message }));
    }, Math.min(1_500, AUTONOMY_INTERVAL_MS)).unref?.();
  }
});

// ── Autonomous Governor Loop ───────────────────────────────────────────────────
// Periodically: observe system state → ask LLM what the highest-value next goal is
// → if novel and passes execution gate, create a Mission Graph automatically.
// Controlled by SEER_GOVERNOR_INTERVAL_MS (default 5 min). Disable: set to 0.
const GOVERNOR_INTERVAL_MS = parseInt(process.env.SEER_GOVERNOR_INTERVAL_MS ?? '300000');
let governorInFlight = false;
let governorTimer = null;

const GOVERNOR_SYSTEM = `You are JACO's Strategic Governor.
Purpose: ${SEER_PURPOSE.statement}
Invariants: operator_authority, evidence_before_claim, no_external_spend_without_signed_mandate, legal_and_policy_compliant_operation, reversible_by_default.
Respond ONLY with valid JSON — no markdown, no prose.`;

// Closes the loop: when a mission graph the governor created from a scored strategic decision
// reaches a terminal state, feed the real outcome back into the prediction (so belief/replan
// logic can react to being wrong) and into selfModel (so the next governor turn's
// capability_performance context reflects what actually happened, not the original guess).
function resolveStrategicPrediction(graphId) {
  try {
    const graph = missionGraph.get(graphId);
    if (!graph || !['VERIFIED', 'FAILED'].includes(graph.status)) return;
    const predictionId = graph.policy?.strategic_prediction_id;
    if (!predictionId) return;
    const prediction = strategy.predictions.get(predictionId);
    if (!prediction || prediction.status !== 'open') return;

    const verified = graph.status === 'VERIFIED';
    const resolved = strategy.predictions.resolve(predictionId, {
      metrics: { verified: verified ? 1 : 0, expected_revenue: 0 },
    });

    strategy.selfModel.record({
      capability: graph.policy?.strategic_capability || 'novel',
      success: verified,
      cost: 0,
      metadata: { graph_id: graphId, decision_id: graph.policy?.strategic_decision_id || null },
    });

    emit('governor.prediction_resolved', {
      graph_id: graphId,
      prediction_id: predictionId,
      decision_id: graph.policy?.strategic_decision_id || null,
      status: resolved.status,
      replan_required: resolved.replan?.replan ?? false,
    });
  } catch (error) {
    emit('governor.prediction_resolve_error', { graph_id: graphId, error: error.message });
  }
}

async function runGovernorTurn() {
  if (governorInFlight) return;
  governorInFlight = true;
  try {
    // Observe: collect system state
    const state = strategy.state();
    const activeMissions = missions.list ? missions.list('active') : db.prepare("SELECT id,title,goal,status FROM missions WHERE status='active' LIMIT 10").all();
    const activeGraphs = missionGraph.list().filter(g => ['ACTIVE','NEEDS_REPLAN'].includes(g.status));
    const activeStrategicGoals = strategy.goals.list('active').slice(0, 10);
    const operatorPrimaryGoal = memory.get('seer.operator_primary_goal');
    const admission = chooseGovernorFocus(missionGraph.list(), {
      primary: operatorPrimaryGoal,
      goals: strategy.goals.list('active'),
      waiting: new Set(graphsWaitingOnOperator.keys()),
      // Exhausted repairs and quarantined unknown outcomes do not hold an execution slot.
      // Unknown outcomes remain durably stopped; they must never be promoted to known failures.
      maxActive: process.env.SEER_GOVERNOR_MAX_ACTIVE_GRAPHS ?? 2,
    });
    if (!admission.allowed) {
      emit('governor.skipped', admission);
      return { ok: true, skipped: admission.reason };
    }
    // Self-invented goals (operator 2026-10-09: SEER's own research missions blocked the queue). Without
    // an operator goal the governor waits; SEER_GOVERNOR_SELF_GOALS=1 lets it pick goals itself again.
    if (!operatorPrimaryGoal && process.env.SEER_GOVERNOR_SELF_GOALS !== '1') {
      emit('governor.skipped', { allowed: false, reason: 'no_operator_goal' });
      return { ok: true, skipped: 'NO_OPERATOR_GOAL' };
    }
    // The goal this turn's work belongs to: the primary goal, or the next goal without active work
    // while the primary goal's own graph is still running.
    const onPrimary = admission.primary === true;
    const focusGoal = admission.focus || null;
    if (focusGoal && !onPrimary) emit('governor.focus_next_goal', { goal_id: focusGoal.id, primary_goal_id: operatorPrimaryGoal?.id || null, primary_graph_id: admission.primary_graph_id });
    // Project mode: the operator's instruction on their own repository is executed as given.
    if (onPrimary && operatorPrimaryGoal?.project_root) {
      if (projectGoalDone(missionGraph.list(), operatorPrimaryGoal.id)) {
        emit('governor.skipped', { allowed: false, reason: 'project_goal_verified', goal_id: operatorPrimaryGoal.id });
        return { ok: true, skipped: 'project_goal_verified' };
      }
      const graph = missionGraph.create(projectGoalGraph(operatorPrimaryGoal));
      emit('governor.graph_created', { graph_id: graph.id, title: graph.title, goal: graph.objective, node_count: 1, project_root: graph.policy.project_root, direct: true });
      return { ok: true, graph_id: graph.id, direct: true };
    }
    const promptGoals = compactGovernorGoals(activeStrategicGoals, { focusIds: [operatorPrimaryGoal?.id, focusGoal?.id] });
    const recentEvents = db.prepare("SELECT type,payload FROM events ORDER BY id DESC LIMIT 20").all()
      .map(e => ({ type: e.type, payload: jp(e.payload) }));

    // Real historical performance per capability (attempts, success rate, mean cost/duration).
    // This is what lets a new candidate's success_probability/expected_revenue be grounded in
    // what has actually happened before, instead of a fresh guess every turn.
    const capabilityPerformance = strategy.selfModel.summary().slice(0, 10);

    const context = {
      active_missions: activeMissions.length,
      active_graphs: activeGraphs.length,
      // Statements are listed once, budgeted, further down the prompt.
      active_strategic_goals: promptGoals.map(goal => ({
        id: goal.id,
        priority: goal.priority,
        horizon: goal.horizon,
      })),
      operator_primary_goal: operatorPrimaryGoal || null,
      open_predictions: state.open_predictions?.length ?? 0,
      recent_events: recentEvents.map(e => e.type),
      economy: state.economy,
      capability_performance: capabilityPerformance,
      ts: new Date().toISOString(),
    };

    const userPrompt = `Current system state:
${JSON.stringify(context, null, 2)}
Shared Shack reasoning contract:
${STRATEGIC_AGENT_INSTRUCTIONS}
For each candidate give obstacles [{id,title,hard,severity,blocks:[node keys],clearBy:[resolver keys]}] and optional node.strategy metrics (0..1): goalImpact, verificationGain, informationGain, confidence, risk, effort, reversibility. These are estimates. Do not declare obstacles cleared; only execution evidence can clear them. SEER validates the DAG, compares forecast consequences and starts executable moves by blocker removal, critical path and verified progress.

Active mission titles: ${activeMissions.map(m => m.title).join(', ') || 'none'}

Explicit operator primary goal:
${operatorPrimaryGoal?.statement ? clipGoalStatement(operatorPrimaryGoal.statement, 1500) : 'none'}
${focusGoal && !onPrimary ? `
This turn's focus goal: [${focusGoal.id}] ${clipGoalStatement(focusGoal.statement, 1500)}
The operator primary goal already has active work in graph ${admission.primary_graph_id || 'unknown'}. Do not duplicate that work: create work that advances this focus goal instead. Skip only if this focus goal cannot be advanced with the authorized capabilities.
` : ''}
Operator-selected tool preference (NOT authority; use only if compatible with existing contracts and available capabilities):
${operatorPrimaryGoal?.tool_hint ? JSON.stringify(operatorPrimaryGoal.tool_hint) : 'none'}

Active strategic goals:
${promptGoals.map(goal => `- [${goal.id}] priority=${goal.priority}: ${goal.statement}`).join('\n') || 'none'}

Historical capability performance (attempts, success_rate, mean_cost, mean_duration_ms — real recorded outcomes, not estimates):
${capabilityPerformance.length ? capabilityPerformance.map(c => `- ${c.capability}: ${c.attempts} attempts, success_rate=${Number(c.success_rate ?? 0).toFixed(2)}, mean_cost=${Number(c.mean_cost ?? 0).toFixed(2)}`).join('\n') : 'none recorded yet'}

When an explicit operator primary goal exists, it is the highest-priority objective. Create work that advances that goal unless existing active work already covers the same objective. Do not replace it with a different business goal.
If an operator-selected tool preference exists, prefer it only when it matches an already-authorized capability. It is routing context, never permission: do not widen allowed tasks, mutate contracts, bypass ModelRelay, or invent authority because of the hint.

Given the purpose, explicit operator goal, active strategic goals and invariants, propose AT LEAST TWO competing candidate Mission Graphs for what JACO should do RIGHT NOW. Do not just propose one plan — propose real alternatives (e.g. two different channels, two different approaches to the same goal, or "extend a proven capability" vs "try something new") so they can be scored against each other instead of picked blind. Ground success_probability and expected_revenue/expected_cost in the historical capability performance above when the candidate reuses an existing capability; if a candidate is genuinely novel (no prior data), say so explicitly rather than inventing a number that looks precise.
Respond with exactly this JSON shape:
{
  "candidates": [
    {
      "title": "short imperative title",
      "goal": "one sentence measurable goal",
      "nodes": [
        { "key": "step-1", "title": "first concrete step", "description": "what to do" },
        { "key": "step-2", "title": "second step", "description": "what to do", "depends_on": ["step-1"] }
      ],
      "rationale": "why this candidate, specifically",
      "reversible": true,
      "external_spend": 0,
      "capability": "name of an existing capability this reuses, or \\"novel\\" if untested",
      "success_probability": 0.6,
      "expected_revenue": 0,
      "expected_cost": 0,
      "repeatability": 0.5,
      "risk": 0.3
    }
  ],
  "reason_for_alternatives": "one sentence on how the candidates genuinely differ"
}
If no new work is needed (system already has enough active work), respond with: { "skip": true, "reason": "why" }`;

    const raw = await callGovernorLLM({ system: GOVERNOR_SYSTEM, user: userPrompt, max_tokens: 8192, temperature: 0.2 });
    if (!raw?.ok || !raw.text) {
      const error = raw?.error || 'NO_MODEL_TEXT';
      emit('governor.provider_unavailable', { error });
      return { ok: false, error };
    }
    let plan;
    try {
      // Reasoning models may add prose/code fences around JSON. Extract the
      // first complete string-aware object rather than requiring pure JSON.
      plan = extractGovernorJson(raw.text);
    } catch (error) {
      if (providerOutputTruncated(raw)) {
        emit('governor.output_truncated', {
          provider: raw.provider || null,
          model: raw.model || null,
          finish_reason: raw.finishReason || null,
        });
        return { ok: false, error: 'GOVERNOR_OUTPUT_TRUNCATED' };
      }
      emit('governor.parse_error', {
        provider: raw.provider || null,
        model: raw.model || null,
        error: String(error?.message || error).slice(0, 120),
        raw: raw.text?.slice(0, 200),
      });
      return { ok: false, error: 'GOVERNOR_PARSE_ERROR' };
    }

    if (plan.skip) {
      emit('governor.skipped', { reason: plan.reason });
      return;
    }

    const rawCandidates = Array.isArray(plan.candidates) ? plan.candidates : [];
    const validCandidates = rawCandidates.filter(c => c?.title && c?.goal && Array.isArray(c.nodes) && c.nodes.length > 0);
    if (!validCandidates.length) {
      emit('governor.invalid_plan', { plan });
      return { ok: false, error: 'GOVERNOR_INVALID_PLAN' };
    }

    // A do-nothing baseline is always in the running, so "decide" always has a real opportunity-cost
    // comparison to score against (decisions.decide requires >=2 candidates and this guarantees it
    // without ever inventing numbers for the model's own proposals).
    const baselineCandidate = governorBaseline({ hasFocusGoal: Boolean(focusGoal || operatorPrimaryGoal) });

    const scoredCandidates = validCandidates.map((c, index) => {
      const capabilityEntry = String(c.capability || '').trim() && c.capability !== 'novel'
        ? capabilityPerformance.find(p => p.capability === c.capability)
        : null;
      return {
        id: c.title ? `candidate-${index + 1}-${c.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}` : `candidate-${index + 1}`,
        title: c.title,
        goal: c.goal,
        nodes: c.nodes,
        obstacles: (Array.isArray(c.obstacles) ? c.obstacles : []).map(obstacle => ({ ...obstacle, state: 'ACTIVE', evidenceRefs: [] })),
        rationale: c.rationale || null,
        reversible: c.reversible !== false,
        external_spend: Number(c.external_spend ?? 0),
        success_probability: capabilityEntry ? Number(capabilityEntry.success_rate ?? 0.5) : Number(c.success_probability ?? 0.5),
        expected_revenue: Math.max(0, Number(c.expected_revenue ?? 0)),
        expected_cost: Math.max(0, Number(c.expected_cost ?? (capabilityEntry?.mean_cost ?? 0))),
        repeatability: Number(c.repeatability ?? 0.5),
        risk: Number(c.risk ?? 0.5),
        reversibility: c.reversible !== false ? 0.9 : 0.2,
        // Untested ("novel") approaches carry lower evidence_quality but higher information_gain:
        // the scoring formula can still pick them, it just has to be worth the uncertainty.
        evidence_quality: capabilityEntry ? Math.min(1, 0.4 + Number(capabilityEntry.success_rate ?? 0) * 0.5) : 0.3,
        information_gain: capabilityEntry ? 0.3 : 0.8,
        strategic_fit: 0.7,
        human_intervention: 0,
        consequence: Number(c.external_spend ?? 0) > 0 ? 'FINANCIAL' : 'REVERSIBLE',
        // What resolving this prediction later will be checked against — without this,
        // predictions.resolve() has nothing to compare the real outcome to.
        expected_outcome: {
          metrics: {
            verified: { target: 1, tolerance: 0 },
            expected_revenue: Number(c.expected_revenue ?? 0),
          },
        },
        falsifier: { verified: { equals: 0 } },
      };
    });

    const decideResult = strategy.decisions.decide({
      candidates: [...scoredCandidates, baselineCandidate],
      goal_id: focusGoal?.id || operatorPrimaryGoal?.id,
      context: { scoring_model: 'shack', cost_reference: Math.max(1, Number(state.economy?.revenue) || 100) },
    });
    const chosen = decideResult.decision.chosen;

    emit('governor.decision_scored', {
      decision_id: decideResult.decision.id,
      chosen_id: chosen.id,
      chosen_title: chosen.title,
      chosen_score: chosen.strategic_score,
      candidate_count: decideResult.ranked.length,
      ranked_ids: decideResult.ranked.map(r => ({ id: r.id, score: r.strategic_score.score })),
    });

    if (chosen.id === 'baseline-no-new-mission') {
      emit('governor.baseline_chosen', { decision_id: decideResult.decision.id, candidate_count: scoredCandidates.length });
      return { ok: true, skipped: 'BASELINE_SCORED_HIGHEST', decision_id: decideResult.decision.id };
    }

    // Gate: block if external spend > 0 (operator_authority invariant) — re-checked on the
    // actually-chosen candidate, independent of decisions.decide's own execution_gate bookkeeping.
    if (chosen.external_spend > 0) {
      emit('governor.blocked_spend', { title: chosen.title, external_spend: chosen.external_spend, decision_id: decideResult.decision.id });
      return;
    }

    // Dedup: skip if an active graph with same title already exists
    const duplicate = activeGraphs.find(g => g.title?.toLowerCase() === chosen.title.toLowerCase());
    if (duplicate) {
      emit('governor.duplicate_skipped', { title: chosen.title, existing_graph_id: duplicate.id, decision_id: decideResult.decision.id });
      return;
    }

    const projectRoot = onPrimary ? operatorPrimaryGoal?.project_root || null : null;
    const graph = missionGraph.create({
      title: chosen.title,
      objective: chosen.goal,
      obstacles: chosen.obstacles,
      policy: {
        ...projectGraphPolicy(projectRoot),
        source: onPrimary ? 'operator-start-prompt' : 'governor',
        autonomy: 'closed-loop',
        strategic_goal_id: focusGoal?.id || null,
        tool_hint: onPrimary ? operatorPrimaryGoal?.tool_hint || null : null,
        rationale: chosen.rationale || null,
        reversible: chosen.reversible !== false,
        external_spend: 0,
        strategic_decision_id: decideResult.decision.id,
        strategic_prediction_id: decideResult.prediction?.id || null,
        strategic_capability: validCandidates.find(c => c.title === chosen.title)?.capability || 'novel',
      },
      nodes: chosen.nodes.map(n => ({
        key: n.key,
        title: n.title,
        objective: n.description || n.title,
        dependencies: Array.isArray(n.depends_on) ? n.depends_on : [],
        strategy: { confidence: chosen.success_probability, ...(n.strategy || {}) },
        ...(projectRoot ? { contract: projectNodeContract({ title: n.title, objective: n.description, mainGoal: chosen.goal }) } : {}),
      })),
    });

    emit('governor.graph_created', {
      graph_id: graph.id,
      title: chosen.title,
      goal: chosen.goal,
      node_count: chosen.nodes.length,
      decision_id: decideResult.decision.id,
      strategic_score: chosen.strategic_score,
      rationale: chosen.rationale,
    });
    return { ok: true, graph_id: graph.id, decision_id: decideResult.decision.id };
  } catch (err) {
    emit('governor.error', { error: err.message });
    return { ok: false, error: err.message || 'GOVERNOR_TURN_FAILED' };
  } finally {
    governorInFlight = false;
  }
}

const developmentCycle = createDevelopmentCycle({
  memory,
  emit,
  runTurn: async ({ reason, eventKey }) => {
    emit('development_cycle.governor_turn', { reason, event_key: eventKey || null });
    const result = await runGovernorTurn();
    if (result?.ok === false) throw new Error(result.error || 'GOVERNOR_TURN_FAILED');
    return result;
  },
  cooldownMs: Math.max(1_000, Math.min(60_000, Number(process.env.SEER_DEVELOPMENT_COOLDOWN_MS || 5_000))),
  backoffMs: Math.max(5_000, Math.min(300_000, Number(process.env.SEER_DEVELOPMENT_BACKOFF_MS || 15_000))),
});

if (GOVERNOR_INTERVAL_MS > 0) {
  // The interval is a watchdog only. Mission terminal events drive normal progression.
  governorTimer = setInterval(() => {
    developmentCycle.watchdog({ staleAfterMs: GOVERNOR_INTERVAL_MS });
  }, GOVERNOR_INTERVAL_MS);
  governorTimer.unref?.();
  setTimeout(() => {
    developmentCycle.trigger('startup', { eventKey: `startup:${process.pid}:${Date.now()}` });
  }, 1500).unref?.();
}

// Inert until A2ACOLONY_API_KEY is set (createA2AColonyRevenueSync no-ops without it). When a key
// is present it polls real acquisitions on that marketplace into strategy.economy so the governor
// loop's capability_performance context actually reflects sales made there, not just Stripe.
const a2acolonySync = createA2AColonyRevenueSync({
  strategy,
  statePath: join(DB_DIR, 'a2acolony-synced.json'),
  emit,
});
const A2ACOLONY_SYNC_INTERVAL_MS = parseInt(process.env.A2ACOLONY_SYNC_INTERVAL_MS ?? '600000');
let a2acolonySyncTimer = null;
if (A2ACOLONY_SYNC_INTERVAL_MS > 0) {
  a2acolonySyncTimer = setInterval(() => {
    a2acolonySync.syncOnce().catch(error => emit('a2acolony.sync_loop_error', { error: error.message }));
  }, A2ACOLONY_SYNC_INTERVAL_MS);
  a2acolonySyncTimer.unref?.();
}

const shutdown = async () => {
  if (novaReconcileTimer) clearInterval(novaReconcileTimer);
  if (autonomyTimer) clearInterval(autonomyTimer);
  if (governorTimer) clearInterval(governorTimer);
  if (a2acolonySyncTimer) clearInterval(a2acolonySyncTimer);
  await workplace.end?.();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

