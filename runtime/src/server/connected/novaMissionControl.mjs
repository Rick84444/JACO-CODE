import {actionLeaseMs} from '../../../../agents/lib/web-fetch-policy.mjs';
import crypto from 'node:crypto';
import path from 'node:path';
import { CODE_TASKS, assertCodingBudget, contractVerificationStatus, codingExecutionSummary, normalizeCodingContract, validateCodingTask } from '../../../../agents/lib/coding-contract.mjs';
import { BATCHABLE, hashTaskInput } from '../../../../agents/lib/mission-client.mjs';
import { novaTiming } from '../../../../agents/lib/nova-timing.mjs';
import { checkCitations } from '../../../../agents/lib/evidence.mjs';
import { stripEmoji } from '../../../../agents/lib/writing-policy.mjs';
import { outgoingSpendCheck } from './spendGuard.mjs';
import { findDuplicate } from './missionDedupe.mjs';
import { TASK_FIELDS } from '../../../../agents/lib/task-fields.mjs';
import { validateGithubRepoTask } from '../../../../agents/lib/github-repo.mjs';
import { validateRepoScanTask } from '../../../../agents/lib/repo-scan.mjs';
import { validateMcpCall } from '../../../../agents/lib/mcp-tools.mjs';
import { mayAutoReplayTask } from '../../../../agents/lib/replay-semantics.mjs';

// Marks a result whose state changes must commit even though the call itself fails.
class CommittedFailure { constructor(error) { this.error = error; } }
// Operator resume note that also approves one outgoing-spend action for the mission.
export const SPEND_APPROVAL_TAG = /\[approve-spend\]/i;

const iso = () => new Date().toISOString();
const decode = value => JSON.parse(value || 'null');
const TERMINAL = new Set(['DONE', 'CANCELLED']);
// Mission executors: the hub's 'nova' and 'desktop-agentos', or the same kinds on a joined device
// ('nova@laptop', 'desktop-agentos@pc2'). Each executor only claims missions routed to it.
const EXECUTOR = /^(nova|desktop-agentos)(@[a-z0-9][a-z0-9-]{1,39})?$/;
const executorKind = executor => String(executor).split('@')[0];
// Paid orders (sources 'skyfire-order', 'stripe-order', ...) go before other work, oldest first within each
// group (2026-10-04: a Skyfire order waited six hours behind research missions).
const QUEUE_ORDER = "CASE WHEN m.source LIKE '%-order' THEN 0 ELSE 1 END, m.created_at ASC, m.rowid ASC";
// The arguments of an action, kept on its receipt so the planner sees what it already ran. Long
// strings (file contents, typed text) are replaced by their length.
export function compactTaskInput(data) {
  if (!data || typeof data !== 'object') return undefined;
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = typeof value === 'string' && value.length > 300 ? `[${value.length} chars]` : value;
  }
  const json = JSON.stringify(out);
  return json.length > 800 ? { summary: json.slice(0, 800) } : out;
}
const DESKTOP_ACTION_TYPES = new Set(['focus', 'invoke', 'set_value', 'toggle', 'select', 'expand', 'collapse', 'scroll']);
const DESKTOP_SCROLL_AMOUNTS = new Set(['SmallIncrement', 'SmallDecrement', 'LargeIncrement', 'LargeDecrement']);
const DESKTOP_SELECTOR_FIELDS = new Set(['name', 'automationId', 'controlType', 'className', 'index']);
const WINDOWS_WMI_QUERIES = new Set(['system','computer','cpu','memory','disks','network','processes','services']);
const ANDROID_PACKAGE = /^[A-Za-z0-9_.]{3,200}$/;
const ANDROID_SELECTOR_FIELDS = new Set(['view_id','text','content_description','class_name','editable']);
const ANDROID_TARGET_SOURCES = new Set(['accessibility','dom','vision','fusion']);
const ANDROID_DIRECTIONS = new Set(['UP','DOWN','LEFT','RIGHT']);
const ANDROID_SECRET_TEXT = /(?:password|passcode|otp|one[- ]?time|verification code|2fa|mfa|cvv|cvc|pin\b|secret|api[_ -]?key|token)/i;

export { TASK_FIELDS };
const CODING_CONTEXT_TASKS = new Set(['detect-surfaces', 'health-check', 'web-fetch', 'mcp-call', 'skill-load']);
const DEFAULT_TASKS = [
  'detect-surfaces', 'health-check', 'check-revenue',
  'browser-survey-site', 'browser-click', 'browser-type', 'web-fetch',
  'desktop-windows', 'desktop-observe', 'desktop-action', 'desktop-invoke',
  'android-status', 'android-observe', 'android-begin', 'android-target',
  'android-open-app', 'android-tap', 'android-type', 'android-scroll', 'android-back', 'android-home',
  'windows-wmi-read', 'screenshot', 'get-cursor',
  'invoke-worker', 'shell', 'github-create-repo', 'repo-scan', 'mcp-call', 'mcp-write', 'skill-load',
  'vault-generate-secret', 'vault-get-secret', 'vault-list-secrets', 'secret-store', 'email-inbox',
  ...CODE_TASKS,
];

function validateDesktopSelector(selector) {
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) throw new Error('INVALID_DESKTOP_SELECTOR');
  const keys = Object.keys(selector);
  if (!keys.length || keys.some(key => !DESKTOP_SELECTOR_FIELDS.has(key))) throw new Error('INVALID_DESKTOP_SELECTOR');
  let identityFields = 0;
  for (const key of ['name', 'automationId', 'controlType', 'className']) {
    if (selector[key] !== undefined) {
      if (typeof selector[key] !== 'string' || !selector[key].trim() || selector[key].length > 512) throw new Error(`INVALID_DESKTOP_SELECTOR:${key}`);
      identityFields++;
    }
  }
  if (selector.index !== undefined && (!Number.isInteger(selector.index) || selector.index < 0 || selector.index > 10000)) {
    throw new Error('INVALID_DESKTOP_SELECTOR:index');
  }
  if (!identityFields && selector.index === undefined) throw new Error('INVALID_DESKTOP_SELECTOR');
}

function validateDesktopAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) throw new Error('INVALID_DESKTOP_ACTION');
  if (!DESKTOP_ACTION_TYPES.has(action.type)) throw new Error('INVALID_DESKTOP_ACTION_TYPE');
  if (action.hwnd !== undefined && (!Number.isSafeInteger(action.hwnd) || action.hwnd <= 0)) throw new Error('INVALID_DESKTOP_HWND');
  validateDesktopSelector(action.selector);
  if (action.type === 'set_value') {
    if (typeof action.text !== 'string' || !action.text.length || action.text.length > 2000) throw new Error('INVALID_DESKTOP_TEXT');
  } else if (action.text !== undefined) {
    throw new Error('DESKTOP_TEXT_NOT_ALLOWED');
  }
  if (action.type === 'scroll') {
    if (action.amount !== undefined && !DESKTOP_SCROLL_AMOUNTS.has(action.amount)) throw new Error('INVALID_DESKTOP_SCROLL_AMOUNT');
  } else if (action.amount !== undefined) {
    throw new Error('DESKTOP_SCROLL_AMOUNT_NOT_ALLOWED');
  }
  if (action.wait_after_ms !== undefined && (!Number.isFinite(action.wait_after_ms) || action.wait_after_ms < 0 || action.wait_after_ms > 5000)) {
    throw new Error('INVALID_DESKTOP_WAIT');
  }
  for (const key of Object.keys(action)) {
    if (!['type', 'hwnd', 'selector', 'text', 'amount', 'wait_after_ms'].includes(key)) throw new Error(`INVALID_DESKTOP_ACTION_FIELD:${key}`);
  }
  return {
    type: action.type,
    ...(action.hwnd !== undefined ? { hwnd: action.hwnd } : {}),
    selector: { ...action.selector },
    ...(action.text !== undefined ? { text: action.text } : {}),
    ...(action.amount !== undefined ? { amount: action.amount } : {}),
    ...(action.wait_after_ms !== undefined ? { wait_after_ms: action.wait_after_ms } : {}),
  };
}

function validateAndroidPackage(value, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error('INVALID_ANDROID_PACKAGE');
    return undefined;
  }
  if (typeof value !== 'string' || !ANDROID_PACKAGE.test(value.trim())) throw new Error('INVALID_ANDROID_PACKAGE');
  return value.trim();
}

function validateAndroidSelector(selector, { required = false } = {}) {
  if (selector === undefined || selector === null) {
    if (required) throw new Error('INVALID_ANDROID_SELECTOR');
    return undefined;
  }
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) throw new Error('INVALID_ANDROID_SELECTOR');
  const keys = Object.keys(selector);
  if (!keys.length || keys.some(key => !ANDROID_SELECTOR_FIELDS.has(key))) throw new Error('INVALID_ANDROID_SELECTOR');
  const out = {};
  for (const key of ['view_id','text','content_description','class_name']) {
    if (selector[key] !== undefined) {
      if (typeof selector[key] !== 'string' || !selector[key].trim() || selector[key].length > 500) throw new Error(`INVALID_ANDROID_SELECTOR:${key}`);
      out[key] = selector[key].trim();
    }
  }
  if (selector.editable !== undefined) out.editable = Boolean(selector.editable);
  if (!Object.keys(out).length) throw new Error('INVALID_ANDROID_SELECTOR');
  return out;
}

function sanitizeAndroidTask(task, data) {
  const common = {};
  const packageName = validateAndroidPackage(data.packageName, { required: task.type === 'android-open-app' });
  if (packageName) common.packageName = packageName;
  if (data.waitAfterMs !== undefined) {
    if (!Number.isFinite(data.waitAfterMs) || data.waitAfterMs < 250 || data.waitAfterMs > 5000) throw new Error('INVALID_ANDROID_WAIT');
    common.waitAfterMs = Math.round(data.waitAfterMs);
  }

  if (task.type === 'android-status') {
    if (Object.keys(data).length) throw new Error('INVALID_ANDROID_STATUS_FIELD');
    return {};
  }
  if (task.type === 'android-observe') {
    for (const key of Object.keys(data)) if (!['packageName'].includes(key)) throw new Error(`INVALID_ANDROID_OBSERVE_FIELD:${key}`);
    return common;
  }
  if (task.type === 'android-begin') {
    for (const key of Object.keys(data)) if (!['intent','expectedNextState'].includes(key)) throw new Error(`INVALID_ANDROID_BEGIN_FIELD:${key}`);
    if (typeof data.intent !== 'string' || !data.intent.trim() || data.intent.length > 1000) throw new Error('INVALID_ANDROID_INTENT');
    const out = { intent: data.intent.trim() };
    if (data.expectedNextState !== undefined) {
      if (typeof data.expectedNextState !== 'string' || !data.expectedNextState.trim() || data.expectedNextState.length > 500) throw new Error('INVALID_ANDROID_EXPECTED_STATE');
      out.expectedNextState = data.expectedNextState.trim();
    }
    return out;
  }
  if (task.type === 'android-target') {
    for (const key of Object.keys(data)) if (!['semanticPurpose','role','text','bbox','confidence','source'].includes(key)) throw new Error(`INVALID_ANDROID_TARGET_FIELD:${key}`);
    if (typeof data.semanticPurpose !== 'string' || !data.semanticPurpose.trim() || data.semanticPurpose.length > 500) throw new Error('INVALID_ANDROID_TARGET_PURPOSE');
    const out = { semanticPurpose: data.semanticPurpose.trim() };
    for (const key of ['role','text']) {
      if (data[key] !== undefined) {
        if (typeof data[key] !== 'string' || !data[key].trim() || data[key].length > 500) throw new Error(`INVALID_ANDROID_TARGET_${key.toUpperCase()}`);
        out[key] = data[key].trim();
      }
    }
    if (data.bbox !== undefined) {
      if (!Array.isArray(data.bbox) || data.bbox.length !== 4 || data.bbox.some(v => !Number.isFinite(v) || Math.abs(v) > 100000)) throw new Error('INVALID_ANDROID_TARGET_BBOX');
      out.bbox = [...data.bbox];
    }
    if (data.confidence !== undefined) {
      if (!Number.isFinite(data.confidence) || data.confidence < 0 || data.confidence > 1) throw new Error('INVALID_ANDROID_TARGET_CONFIDENCE');
      out.confidence = data.confidence;
    }
    if (data.source !== undefined) {
      if (!ANDROID_TARGET_SOURCES.has(data.source)) throw new Error('INVALID_ANDROID_TARGET_SOURCE');
      out.source = data.source;
    }
    return out;
  }

  const selector = validateAndroidSelector(data.selector);
  if (selector) common.selector = selector;
  if (task.type === 'android-open-app') {
    for (const key of Object.keys(data)) if (!['packageName','waitAfterMs'].includes(key)) throw new Error(`INVALID_ANDROID_OPEN_APP_FIELD:${key}`);
    return common;
  }
  if (task.type === 'android-tap') {
    for (const key of Object.keys(data)) if (!['packageName','selector','x','y','waitAfterMs'].includes(key)) throw new Error(`INVALID_ANDROID_TAP_FIELD:${key}`);
    const hasX = data.x !== undefined, hasY = data.y !== undefined;
    if ((hasX || hasY) && !(hasX && hasY && Number.isFinite(data.x) && Number.isFinite(data.y))) throw new Error('INVALID_ANDROID_TAP_COORDINATES');
    if (!selector && !(hasX && hasY)) throw new Error('ANDROID_TAP_TARGET_REQUIRED');
    if (hasX) { common.x = data.x; common.y = data.y; }
    return common;
  }
  if (task.type === 'android-type') {
    for (const key of Object.keys(data)) if (!['packageName','selector','text','waitAfterMs'].includes(key)) throw new Error(`INVALID_ANDROID_TYPE_FIELD:${key}`);
    if (typeof data.text !== 'string' || !data.text.length || data.text.length > 2000) throw new Error('INVALID_ANDROID_TEXT');
    if (ANDROID_SECRET_TEXT.test(data.text) || ANDROID_SECRET_TEXT.test(selector?.text || '') || ANDROID_SECRET_TEXT.test(selector?.content_description || '')) throw new Error('ANDROID_SENSITIVE_TEXT_REQUIRES_HUMAN_ENTRY');
    return { ...common, text: data.text };
  }
  if (task.type === 'android-scroll') {
    for (const key of Object.keys(data)) if (!['packageName','selector','direction','waitAfterMs'].includes(key)) throw new Error(`INVALID_ANDROID_SCROLL_FIELD:${key}`);
    const direction = String(data.direction || '').toUpperCase();
    if (!ANDROID_DIRECTIONS.has(direction)) throw new Error('INVALID_ANDROID_DIRECTION');
    return { ...common, direction };
  }
  if (task.type === 'android-back' || task.type === 'android-home') {
    for (const key of Object.keys(data)) if (!['packageName','waitAfterMs'].includes(key)) throw new Error(`INVALID_ANDROID_NAV_FIELD:${key}`);
    return common;
  }
  throw new Error('INVALID_ANDROID_TASK');
}

export function validateTask(task, allowed) {
  if (!task || !Object.hasOwn(TASK_FIELDS, task.type) || !allowed.includes(task.type)) {
    throw new Error(`TASK_NOT_ALLOWED:${String(task?.type).slice(0, 60)}`);
  }
  const data = task.data || {};
  for (const field of TASK_FIELDS[task.type]) {
    if (data[field] === undefined || data[field] === null || data[field] === '') throw new Error(`TASK_FIELD_REQUIRED:${field}`);
  }
  for (const key of ['x', 'y', 'delta']) {
    if (data[key] !== undefined && (!Number.isFinite(data[key]) || Math.abs(data[key]) > 100000)) throw new Error(`INVALID_COORDINATE:${key}`);
  }
  for (const key of ['name', 'text', 'keys', 'command', 'worker', 'prompt', 'url', 'ref']) {
    if (data[key] !== undefined && (typeof data[key] !== 'string' || data[key].length > 12000)) throw new Error(`INVALID_TASK_FIELD:${key}`);
  }
  if (['browser-survey-site', 'web-fetch'].includes(task.type) && !['http:', 'https:'].includes(new URL(data.url).protocol)) throw new Error('INVALID_URL');
  if (task.type === 'skill-load' && !/^[a-z][a-z0-9-]{1,60}$/.test(String(data.id))) throw new Error('INVALID_SKILL_ID');
  if (['vault-generate-secret', 'vault-get-secret', 'secret-store'].includes(task.type) && !/^NOVA_[A-Z0-9_]{2,77}$/.test(String(data.key))) throw new Error('INVALID_VAULT_KEY');
  if (task.type === 'secret-store' && !/^\[?secret:[0-9a-f]{12}\]?$/.test(String(data.handle))) throw new Error('INVALID_SECRET_HANDLE');
  if (data.button && !['left', 'right', 'middle'].includes(data.button)) throw new Error('INVALID_BUTTON');
  if (task.type === 'screenshot') {
    if (data.outFile) throw new Error('SCREENSHOT_PATH_IS_RUNTIME_OWNED');
    for (const key of Object.keys(data)) {
      if (!['hwnd', 'mode', 'maxWidth', 'maxHeight'].includes(key)) throw new Error(`INVALID_SCREENSHOT_FIELD:${key}`);
    }
    if (data.hwnd !== undefined && (!Number.isSafeInteger(data.hwnd) || data.hwnd <= 0)) throw new Error('INVALID_DESKTOP_HWND');
    if (data.mode !== undefined && !['adaptive', 'full'].includes(data.mode)) throw new Error('INVALID_SCREENSHOT_MODE');
    for (const [key, min, max] of [['maxWidth', 320, 1600], ['maxHeight', 180, 1200]]) {
      if (data[key] !== undefined && (!Number.isInteger(data[key]) || data[key] < min || data[key] > max)) {
        throw new Error(`INVALID_SCREENSHOT_${key.toUpperCase()}`);
      }
    }
    return {
      type: task.type,
      data: {
        ...(data.hwnd !== undefined ? { hwnd: data.hwnd } : {}),
        ...(data.mode !== undefined ? { mode: data.mode } : {}),
        ...(data.maxWidth !== undefined ? { maxWidth: data.maxWidth } : {}),
        ...(data.maxHeight !== undefined ? { maxHeight: data.maxHeight } : {}),
      },
      expectedOutcome: String(task.expectedOutcome || '').slice(0, 2000),
    };
  }
  if (task.type === 'desktop-observe' && data.hwnd !== undefined && (!Number.isSafeInteger(data.hwnd) || data.hwnd <= 0)) throw new Error('INVALID_DESKTOP_HWND');
  if (task.type === 'desktop-action') data.action = validateDesktopAction(data.action);
  if (task.type === 'desktop-invoke') {
    if (!Number.isSafeInteger(data.hwnd) || data.hwnd <= 0) throw new Error('INVALID_DESKTOP_HWND');
    validateDesktopSelector(data.selector);
  }
  if (task.type === 'windows-wmi-read') {
    if (typeof data.query !== 'string' || !WINDOWS_WMI_QUERIES.has(data.query)) throw new Error('INVALID_WINDOWS_WMI_QUERY');
    if (data.limit !== undefined && (!Number.isInteger(data.limit) || data.limit < 1 || data.limit > 200)) throw new Error('INVALID_WINDOWS_WMI_LIMIT');
    for (const key of Object.keys(data)) if (!['query','limit'].includes(key)) throw new Error(`INVALID_WINDOWS_WMI_FIELD:${key}`);
  }
  if (task.type.startsWith('android-')) {
    return {
      type: task.type,
      data: sanitizeAndroidTask(task, data),
      expectedOutcome: String(task.expectedOutcome || '').slice(0, 2000),
    };
  }
  // web-fetch is read-only research. Executors run the task returned here, so dropping any
  // method/body/headers a model (or an older executor) supplies keeps it a plain GET.
  if (task.type === 'web-fetch') {
    const expect = data.expect;
    if (expect !== undefined && (!expect || typeof expect !== 'object' || Array.isArray(expect) || Object.keys(expect).some(k => !['status', 'contains'].includes(k)) ||
      (expect.status !== undefined && (!Number.isInteger(expect.status) || expect.status < 100 || expect.status > 599)) ||
      (expect.contains !== undefined && (typeof expect.contains !== 'string' || expect.contains.length > 1000)))) throw new Error('INVALID_WEB_EXPECTATION');
    return { type: task.type, data: { url: data.url, ...(expect ? { expect: { ...expect } } : {}) }, expectedOutcome: String(task.expectedOutcome || '').slice(0, 2000) };
  }
  return { type: task.type, data, expectedOutcome: String(task.expectedOutcome || '').slice(0, 2000) };
}

// SEER owns missions in the existing mission-bus database. Nova leases one turn
// at a time. An interrupted execution is never automatically repeated.
export class NovaMissionControl {
  constructor(bus, { allowedTasks = DEFAULT_TASKS, now = () => Date.now(), knownExecutor = () => true } = {}) {
    this.bus = bus;
    this.knownExecutor = knownExecutor;
    this.db = bus.db;
    this.now = now;
    this.allowedTasks = [...new Set(allowedTasks)].filter(t => Object.hasOwn(TASK_FIELDS, t));
    this.db.exec(`CREATE TABLE IF NOT EXISTS nova_sessions (
      mission_id TEXT PRIMARY KEY REFERENCES missions(id), owner TEXT, token TEXT,
      lease_until INTEGER, phase TEXT NOT NULL, active_task_json TEXT,
      observation_json TEXT, receipts_json TEXT NOT NULL DEFAULT '[]',
      turn INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0
    )`);
    // One-time operator approvals for an outgoing-spend action (see spendGuard.mjs).
    this.db.exec(`CREATE TABLE IF NOT EXISTS nova_spend_approvals (
      mission_id TEXT PRIMARY KEY REFERENCES missions(id), approved_at TEXT NOT NULL, note TEXT NOT NULL
    )`);
    // Coding-budget window: a manual operator resume starts a fresh step/duration window, so resuming
    // a budget-exhausted mission does not re-block it on the next planning turn.
    const sessionColumns = new Set(this.db.prepare('PRAGMA table_info(nova_sessions)').all().map(c => c.name));
    if (!sessionColumns.has('budget_turn_base')) this.db.exec('ALTER TABLE nova_sessions ADD COLUMN budget_turn_base INTEGER NOT NULL DEFAULT 0');
    if (!sessionColumns.has('budget_started_at')) this.db.exec('ALTER TABLE nova_sessions ADD COLUMN budget_started_at INTEGER');
    this.transactionDepth = 0;
    for (const name of ['create','claim','preflight','begin','finish','release','resolve','requestCancel']) {
      const operation=this[name].bind(this);
      this[name]=(...args)=> {
        if (this.transactionDepth) return operation(...args);
        this.db.exec('BEGIN IMMEDIATE');
        this.transactionDepth++;
        let result;
        try { result=operation(...args);this.db.exec('COMMIT'); }
        catch(error){this.db.exec('ROLLBACK');throw error;}
        finally { this.transactionDepth--; }
        // An operation may persist a state change (e.g. BLOCKED) and still fail the call.
        if (result instanceof CommittedFailure) throw result.error;
        return result;
      };
    }
  }

  create({ goal, idempotencyKey, source = 'operator', mandateId = null, contract = null, allowedTasks = null, executor = 'nova',parent=null, projectRoot = null }) {
    if (typeof goal !== 'string' || !goal.trim() || goal.length > 12000) throw new Error('GOAL_REQUIRED');
    // Project mode: the operator's own repository. Nova runs such a mission in a per-mission worktree.
    if (projectRoot != null && (typeof projectRoot !== 'string' || projectRoot.includes('\0') || projectRoot.length > 500 || !path.isAbsolute(projectRoot))) throw new Error('PROJECT_ROOT_INVALID');
    if (projectRoot != null && contract == null) throw new Error('PROJECT_MISSION_REQUIRES_CONTRACT');
    if (typeof idempotencyKey !== 'string' || !idempotencyKey || idempotencyKey.length > 200) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
    if (mandateId !== null && (typeof mandateId !== 'string' || !mandateId.trim() || mandateId.length > 200)) throw new Error('INVALID_MANDATE_ID');
    const normalizedExecutor = String(executor || 'nova');
    if (!EXECUTOR.test(normalizedExecutor)) throw new Error('INVALID_MISSION_EXECUTOR');
    if (!this.knownExecutor(normalizedExecutor)) throw new Error(`UNKNOWN_DEVICE_EXECUTOR:${normalizedExecutor}`);
    if(parent && (!parent.graphId || !parent.nodeKey || typeof parent.mainGoal!=='string' || parent.mainGoal.length>12000))throw new Error('MISSION_PARENT_INVALID');
    if (parent?.strategicBoard && (parent.strategicBoard.schema !== 'jaco.aura-strategic-board/v1'
      || parent.strategicBoard.missionId !== parent.graphId || JSON.stringify(parent.strategicBoard).length > 64000)) throw new Error('MISSION_STRATEGIC_BOARD_INVALID');
    const desktopKind = executorKind(normalizedExecutor) === 'desktop-agentos';
    const codingContract = contract == null ? null : normalizeCodingContract(contract, goal);
    const requested = allowedTasks == null
      ? this.allowedTasks.filter(task =>
          (desktopKind || task !== 'windows-wmi-read') &&
          // Raw shell is enabled as an available capability but never injected
          // into every mission implicitly. A mission must request it explicitly.
          task !== 'shell' &&
          // A paid repo scan runs only in an order mission that requests it explicitly.
          task !== 'repo-scan' &&
          // A coding mission gets code tools plus read-only context by default. Browser, desktop
          // and Android actuation stayed on the list before, and the planner acted on whatever
          // page happened to be open (observed: a file-write mission clicked GitHub's "Add file").
          (!codingContract || CODE_TASKS.has(task) || CODING_CONTEXT_TASKS.has(task)))
      : [...new Set(Array.isArray(allowedTasks) ? allowedTasks.map(String) : [])];
    if (allowedTasks != null && !codingContract && requested.some(task => CODE_TASKS.has(task))) throw new Error('CODING_CONTRACT_REQUIRED');
    const requestedTasks = codingContract ? requested : requested.filter(task => !CODE_TASKS.has(task));
    if (!requestedTasks.length || requestedTasks.some(task => !this.allowedTasks.includes(task))) throw new Error('INVALID_MISSION_ALLOWED_TASKS');
    if (requestedTasks.includes('windows-wmi-read') && !desktopKind) throw new Error('WINDOWS_WMI_REQUIRES_DESKTOP_AGENTOS');
    // A re-phrased goal that is already open for the same executor joins that mission.
    const open = this.bus.listMissions(500)
      // BLOCKED missions are excluded: re-submitting a stuck goal is a legitimate retry.
      .filter(item => ['ACTIVE', 'AWAITING_VERIFICATION'].includes(String(item.status || '').toUpperCase()))
      .map(item => ({ id: item.id, goal: item.goal, executor: item.metadata?.executor || 'nova' }));
    const duplicate = codingContract ? null : findDuplicate(goal, normalizedExecutor, open);
    if (duplicate) {
      this.bus.event('MISSION_DEDUPED', { missionId: duplicate.id, payload: { source, similarity: Number(duplicate.score.toFixed(3)), goal: goal.slice(0, 300) } });
      return { ...this.get(duplicate.id), deduplicated: true };
    }
    const mission = this.bus.createMission({
      goal,
      source,
      idempotencyKey: `nova:${idempotencyKey}`,
      metadata: { executor: normalizedExecutor, authority: 'SEER', allowedTasks: requestedTasks, mandateId: mandateId?.trim() || null, codingContract,
        ...(projectRoot ? { projectRoot: path.resolve(projectRoot) } : {}),
        ...(parent ? {parent:{graphId:String(parent.graphId).slice(0,200),nodeKey:String(parent.nodeKey).slice(0,120),mainGoal:parent.mainGoal,dependencies:Array.isArray(parent.dependencies)?parent.dependencies.map(String).slice(0,100):[],
          ...(parent.agent ? {agent:{id:'task:'+JSON.stringify([String(parent.graphId).slice(0,200),String(parent.nodeKey).slice(0,120)]),name:String(parent.agent.name || goal).slice(0,300),parentKey:typeof parent.agent.parentKey === 'string' ? parent.agent.parentKey.slice(0,120) : null,kind:'task-agent'}} : {}),
          ...(parent.strategicBoard ? { strategicBoard: parent.strategicBoard, selectedMove: parent.selectedMove || null } : {}) }} : {}) },
    });
    this.db.prepare("INSERT OR IGNORE INTO nova_sessions(mission_id,phase) VALUES(?,'READY')").run(mission.id);
    return this.get(mission.id);
  }

  get(id) {
    const row = this.db.prepare('SELECT * FROM nova_sessions WHERE mission_id=?').get(id);
    if (!row) throw new Error('NOVA_MISSION_NOT_FOUND');
    const base = this.bus.getMission(id);
    const receipts = decode(row.receipts_json);
    const contract = base.metadata?.codingContract || null;
    return { ...base, phase: row.phase, turn: row.turn,
      allowedTasks: base.metadata.allowedTasks.filter(t => this.allowedTasks.includes(t)),
      observation: decode(row.observation_json), receipts,
      activeTask: decode(row.active_task_json), failures: row.failures,
      contract, contractStatus: contract ? contractVerificationStatus(contract, receipts) : null,
      execution: contract ? codingExecutionSummary(contract, receipts, row.phase) : null,
      preflight: this.bus.lastMissionEvent(id,'NOVA_PREFLIGHT')?.payload || null,
      replanRequest: this.bus.lastMissionEvent(id,'NOVA_REPLAN_REQUEST')?.payload || null,
      cancelRequested: !TERMINAL.has(base.status) && Boolean(this.bus.lastMissionEvent(id,'NOVA_CANCEL_REQUEST')),
      ...this.answerReview(id, base.status) };
  }

  // After a claim check rejected the last answer and the mission was resumed, the planner gets the
  // rejected claims and why, so it corrects them instead of repeating the answer.
  answerReview(id, status) {
    if (status !== 'ACTIVE') return {};
    const check = this.bus.lastMissionEvent?.(id, 'NOVA_CLAIM_CHECK')?.payload;
    if (!check || check.ok !== false) return {};
    return { answerReview: {
      rejected: [
        ...(check.contradicted || []).map(c => ({ claim: String(c.text || '').slice(0, 300), problem: `contradicted: ${String(c.why || '').slice(0, 200)}` })),
        ...(check.unsupportedFacts || []).map(u => ({ claim: String(u.text || '').slice(0, 300), problem: `not in any cited receipt: ${String(u.fact || '').slice(0, 120)}` })),
      ].slice(0, 10),
      partialSteps: check.partial || [],
    } };
  }

  // executor (optional): only missions routed to that executor ('nova' or 'desktop-agentos'), so one
  // executor's mission at the queue head never starves the other executor's work.
  current(executor = null) {
    this.recoverExpired();
    for (const row of this.db.prepare("SELECT s.mission_id FROM nova_sessions s JOIN missions m ON m.id=s.mission_id WHERE m.status='ACTIVE' AND s.token IS NULL").all()) this.finishRequestedCancel(row.mission_id);
    if (executor) {
      const ids = this.db.prepare("SELECT s.mission_id FROM nova_sessions s JOIN missions m ON m.id=s.mission_id WHERE m.status='ACTIVE' ORDER BY " + QUEUE_ORDER).all();
      for (const { mission_id } of ids) {
        const mission = this.get(mission_id);
        if ((mission.metadata?.executor || 'nova') === executor) return mission;
      }
      return null;
    }
    // Only executable ACTIVE missions belong at the queue head. BLOCKED and
    // AWAITING_VERIFICATION missions remain durable and visible by id, but must
    // not silently starve unrelated later work.
    const row = this.db.prepare("SELECT s.mission_id FROM nova_sessions s JOIN missions m ON m.id=s.mission_id WHERE m.status='ACTIVE' ORDER BY " + QUEUE_ORDER + " LIMIT 1").get();
    return row ? this.get(row.mission_id) : null;
  }

  // A lease that expires while a step runs leaves its outcome unknown, which needs the operator - unless
  // the step changes nothing and can simply run again (reads, observations, tests). Those return to READY
  // and the step is planned again (2026-10-08: a restart during a repo-test held a whole graph for hours).
  recoverExpired() {
    const rows = this.db.prepare('SELECT * FROM nova_sessions WHERE token IS NOT NULL AND lease_until<=?').all(this.now());
    for (const row of rows) {
      const executing = row.phase === 'EXECUTING';
      const active = decode(row.active_task_json);
      const steps = Array.isArray(active?.tasks) ? active.tasks : active ? [active] : [];
      const repeatable = executing && steps.length > 0 && steps.every(step => mayAutoReplayTask(String(step?.type || '')));
      const uncertain = executing && !repeatable;
      this.db.prepare('UPDATE nova_sessions SET phase=?,owner=NULL,token=NULL,lease_until=NULL' + (repeatable ? ',active_task_json=NULL' : '') + ' WHERE mission_id=?')
        .run(uncertain ? 'INTERRUPTED' : 'READY', row.mission_id);
      if (uncertain) this.setStatus(row.mission_id, 'BLOCKED');
      this.bus.event('NOVA_LEASE_EXPIRED', { missionId: row.mission_id, payload: { uncertain, ...(repeatable ? { retried: steps.map(step => step.type) } : {}) } });
    }
  }

  // executor (optional): the claimant's queue, e.g. 'nova@laptop' for a Nova on another device. Without
  // it the owner prefix decides ('desktop-agentos-...' or the hub's own 'nova'), as before.
  claim(id, owner, executor = null) {
    this.recoverExpired();
    if (typeof owner !== 'string' || !owner || owner.length > 200) throw new Error('MISSION_NOT_CURRENT');
    if (executor != null && !EXECUTOR.test(String(executor))) throw new Error('INVALID_MISSION_EXECUTOR');
    const mission = this.get(id);
    const claimant = executor ? String(executor) : owner.startsWith('desktop-agentos-') ? 'desktop-agentos' : 'nova';
    const desktopOwner = executorKind(claimant) === 'desktop-agentos';
    const missionExecutor = mission.metadata?.executor || 'nova';
    // A device's mission is only run on that device; the hub's executors never take it, and a device
    // never takes the hub's work (2026-10-04: a second PC and the phone competed with the hub Nova).
    if (missionExecutor !== claimant && !(desktopOwner && claimant === 'desktop-agentos' && missionExecutor === 'nova')) throw new Error('MISSION_EXECUTOR_MISMATCH');
    // Head of the claimant's own queue; the hub's Desktop AgentOS may also take the global head (sole-executor mode).
    const ownHead = this.current(claimant)?.id;
    if (id !== ownHead && !(claimant === 'desktop-agentos' && id === this.current()?.id)) throw new Error('MISSION_NOT_CURRENT');
    if (mission.status !== 'ACTIVE') throw new Error(`MISSION_${mission.status}`);
    if (mission.contract) {
      const row = this.db.prepare('SELECT * FROM nova_sessions WHERE mission_id=?').get(id);
      if (row.token) throw new Error('NOVA_LEASE_BUSY');
      try {
        const used = row.turn - (row.budget_turn_base || 0);
        assertCodingBudget(mission.contract, { toolCallsUsed: used, stepsUsed: used, failures: row.failures, startedAt: row.budget_started_at, now: this.now() });
      } catch (error) {
        this.db.prepare("UPDATE nova_sessions SET phase='BLOCKED',owner=NULL,token=NULL,lease_until=NULL WHERE mission_id=?").run(id);
        this.setStatus(id, 'BLOCKED');
        this.bus.event('NOVA_PREFLIGHT_BLOCKED', { missionId: id, payload: { error: error.message, beforePlanning: true } });
        return new CommittedFailure(error);
      }
    }
    const token = crypto.randomUUID();
    const changed = this.db.prepare("UPDATE nova_sessions SET owner=?,token=?,lease_until=?,phase='PLANNING' WHERE mission_id=? AND token IS NULL AND phase='READY'")
      .run(owner, token, this.now() + novaTiming().planningLeaseMs, id);
    if (changed.changes !== 1) throw new Error('NOVA_LEASE_BUSY');
    // The duration budget counts from the first claim: time spent queued behind other missions is not work.
    this.db.prepare('UPDATE nova_sessions SET budget_started_at=COALESCE(budget_started_at,?) WHERE mission_id=?').run(this.now(), id);
    return { mission: { ...this.get(id), planningDeadlineAt: this.now() + novaTiming().planningLeaseMs }, token };
  }

  assertLease(id, owner, token) {
    const row = this.db.prepare('SELECT * FROM nova_sessions WHERE mission_id=?').get(id);
    if (!row || row.owner !== owner || row.token !== token || row.lease_until <= this.now()) throw new Error('NOVA_LEASE_INVALID');
    return row;
  }

  preflight(id, {owner,token,report}) {
    const row=this.assertLease(id,owner,token);
    if(row.phase!=='PLANNING')throw new Error('NOVA_PREFLIGHT_PHASE_INVALID');
    if(!report || report.schema!=='jaco.nova-preflight/v1' || !['READY','BLOCKED'].includes(report.status))throw new Error('NOVA_PREFLIGHT_INVALID');
    // Selected fields only: never persist arbitrary environment or credential objects.
    const payload={schema:report.schema,status:report.status,at:iso(),repository:report.repository ? {revision:String(report.repository.revision||'').slice(0,160),entries:Number(report.repository.entries)||0} : null,
      runtime:report.runtime ? {product:String(report.runtime.product||'').slice(0,100),version:String(report.runtime.version||'').slice(0,100)} : null,
      tools:Array.isArray(report.tools)?report.tools.filter(t=>this.allowedTasks.includes(t)).slice(0,100):[],
      blockers:Array.isArray(report.blockers)?report.blockers.map(v=>String(v).slice(0,200)).slice(0,10):[],
      knowledgeRecords:Number(report.knowledgeRecords)||0};
    this.bus.event('NOVA_PREFLIGHT',{missionId:id,workerId:owner,payload});return {report:payload};
  }

  begin(id, { owner, token, task }) {
    const row = this.assertLease(id, owner, token);
    const mission = this.get(id);
    if (row.phase !== 'PLANNING' || mission.status !== 'ACTIVE') throw new Error('NOVA_NOT_PLANNING');
    if (mission.cancelRequested) throw new Error('MISSION_CANCEL_REQUESTED');
    if (mission.contract) {
      const used = row.turn - (row.budget_turn_base || 0);
      const startedAt = row.budget_started_at ?? Date.parse(mission.createdAt || mission.created_at || '');
      assertCodingBudget(mission.contract, { toolCallsUsed: used, stepsUsed: used, failures: row.failures, startedAt, now: this.now() });
    }
    let checked = validateTask(task, mission.allowedTasks);
    if (CODE_TASKS.has(checked.type)) checked = validateCodingTask(checked, mission.contract, mission.receipts);
    if (checked.type === 'github-create-repo') checked = validateGithubRepoTask(checked, mission.goal);
    if (checked.type === 'repo-scan') checked = validateRepoScanTask(checked, mission.goal);
    if (checked.type === 'mcp-call' || checked.type === 'mcp-write') checked = validateMcpCall(checked);
    const spend = outgoingSpendCheck(checked, { observation: mission.observation });
    if (spend) {
      const approval = this.db.prepare('SELECT * FROM nova_spend_approvals WHERE mission_id=?').get(id);
      if (!approval) {
        this.db.prepare("UPDATE nova_sessions SET phase='BLOCKED',owner=NULL,token=NULL,lease_until=NULL WHERE mission_id=?").run(id);
        this.setStatus(id, 'BLOCKED');
        this.bus.event('NOVA_SPEND_BLOCKED', { missionId: id, payload: { error: 'OUTGOING_SPEND_REQUIRES_OPERATOR', reason: spend.reason, task: { type: checked.type, data: checked.data } } });
        return new CommittedFailure(new Error(`OUTGOING_SPEND_REQUIRES_OPERATOR: ${spend.reason}`));
      }
      // Approval is single-use: it covers this one action only.
      this.db.prepare('DELETE FROM nova_spend_approvals WHERE mission_id=?').run(id);
      this.bus.event('NOVA_SPEND_APPROVED_ACTION', { missionId: id, payload: { reason: spend.reason, note: approval.note } });
    }
    const action = { ...checked, id: `${id}:turn:${row.turn + 1}`, missionId: id };
    this.db.prepare("UPDATE nova_sessions SET phase='EXECUTING',active_task_json=?,turn=turn+1,lease_until=? WHERE mission_id=?")
      .run(JSON.stringify(action), this.now() + actionLeaseMs(checked.type), id);
    this.bus.event('NOVA_ACTION_STARTED', { missionId: id, payload: { action } });
    return action;
  }

  finish(id, { owner, token, actionId, receipt }) {
    const existing = this.get(id).receipts.find(r => r.actionId === actionId);
    if (existing) return this.get(id);
    const row = this.assertLease(id, owner, token);
    const action = decode(row.active_task_json);
    if (row.phase !== 'EXECUTING' || action?.id !== actionId) throw new Error('ACTION_MISMATCH');
    if (!receipt || typeof receipt.ok !== 'boolean' || typeof receipt.verified !== 'boolean') throw new Error('RECEIPT_REQUIRED');
    if (JSON.stringify(receipt).length > 50000) throw new Error('RECEIPT_TOO_LARGE');
    const record = { ...receipt, actionId, type: action.type, input: compactTaskInput(action.data), inputHash: hashTaskInput(action.data), expectedOutcome: action.expectedOutcome, at: iso(), verified: receipt.ok && receipt.verified };
    const receipts = [...decode(row.receipts_json), record].slice(-40);
    const failures = record.ok ? 0 : row.failures + 1;
    const uncertain = record.outcomeUnknown === true || (record.ok && !record.verified);
    // A failed read changes nothing and its error tells the planner what to fix (e.g. a wrong tool
    // argument), so reading steps get five consecutive failures before the mission stops; actions three.
    // Interleaved successful searches must not reset repeated failures of the same action.
    // Count only since its last verified success, and never reinterpret an unknown outcome.
    // Compared by the canonical input hash: the planner reorders keys ({command,args} vs {args,command}), and
    // JSON.stringify counted those as different actions, so a rejected shell read was retried 8 times (2026-10-31).
    const sameAction = r => r.type === record.type && (r.inputHash && record.inputHash
      ? r.inputHash === record.inputHash : JSON.stringify(r.input) === JSON.stringify(record.input));
    const previousSuccess = receipts.findLastIndex(r => sameAction(r) && r.ok && r.verified);
    const repeatedFailures = receipts.slice(previousSuccess + 1).filter(r => sameAction(r) && r.ok === false && !r.outcomeUnknown).length;
    const stalled = !uncertain && !record.ok && repeatedFailures >= (BATCHABLE.has(action.type) ? 5 : 3);
    const blocked = uncertain || stalled || failures >= (BATCHABLE.has(action.type) ? 5 : 3);
    this.db.prepare('UPDATE nova_sessions SET phase=?,owner=NULL,token=NULL,lease_until=NULL,active_task_json=NULL,observation_json=?,receipts_json=?,failures=? WHERE mission_id=?')
      .run(blocked ? 'BLOCKED' : 'READY', JSON.stringify(record.after || record.observation || decode(row.observation_json)), JSON.stringify(receipts), failures, id);
    this.setStatus(id, blocked ? 'BLOCKED' : 'ACTIVE');
    this.bus.event('NOVA_ACTION_RESULT', { missionId: id, payload: record });
    if (this.finishRequestedCancel(id)) return this.get(id);
    if (stalled && this.get(id).source === 'seer-mission-graph') this.bus.event('NOVA_REPLAN_REQUEST', { missionId: id, payload: {
      reason: `Repeated action failed ${repeatedFailures} times without a verified success: ${record.type}: ${record.error || 'known failure'}`,
      evidence_refs: receipts.filter(r => sameAction(r) && !r.ok).slice(-3).map(r => `nova:${id}:receipt:${r.actionId}`),
    } });
    return this.get(id);
  }

  release(id, { owner, token, error = null, completionProposed = false, completionReason = null, replanRequest = null }) {
    const row = this.assertLease(id, owner, token);
    if (row.phase !== 'PLANNING') throw new Error('EXECUTION_REQUIRES_RECEIPT');
    if (this.bus.lastMissionEvent(id,'NOVA_CANCEL_REQUEST')) {
      this.db.prepare("UPDATE nova_sessions SET owner=NULL,token=NULL,lease_until=NULL WHERE mission_id=?").run(id);
      this.finishRequestedCancel(id);
      return this.get(id);
    }
    if (replanRequest) {
      const mission = this.get(id);
      if (mission.source !== 'seer-mission-graph' || !mission.metadata?.parent?.graphId) throw new Error('REPLAN_REQUIRES_GRAPH_MISSION');
      if (completionProposed || error) throw new Error('REPLAN_RESULT_CONFLICT');
      if (Object.keys(replanRequest).some(key => !['reason','subgoals'].includes(key))) throw new Error('REPLAN_REQUEST_INVALID');
      if (typeof replanRequest.reason !== 'string' || !replanRequest.reason.trim() || replanRequest.reason.length > 1000 || !Array.isArray(replanRequest.subgoals) || replanRequest.subgoals.length < 2 || replanRequest.subgoals.length > 8) throw new Error('REPLAN_REQUEST_INVALID');
      for (const subgoal of replanRequest.subgoals) {
        if (!subgoal || Object.keys(subgoal).some(key => !['title','objective'].includes(key)) || typeof subgoal.title !== 'string' || !subgoal.title.trim() || subgoal.title.length > 300 || typeof subgoal.objective !== 'string' || !subgoal.objective.trim() || subgoal.objective.length > 2000) throw new Error('REPLAN_SUBGOAL_INVALID');
      }
      const remainingBudget = mission.contract ? {
        max_steps: Math.max(0, mission.contract.budget.max_steps - (row.turn - (row.budget_turn_base || 0))),
        max_tool_calls: Math.max(0, mission.contract.budget.max_tool_calls - (row.turn - (row.budget_turn_base || 0))),
        max_duration_ms: Math.max(0, mission.contract.budget.max_duration_ms - Math.max(0, this.now() - (row.budget_started_at ?? this.now()))),
      } : null;
      this.bus.event('NOVA_REPLAN_REQUEST', { missionId: id, payload: { ...replanRequest, ...(remainingBudget ? { remaining_budget: remainingBudget } : {}) } });
    }
    if (completionProposed) {
      const mission = this.get(id);
      if (mission.contract) {
        const status = contractVerificationStatus(mission.contract, mission.receipts);
        if (!status.machineVerified) throw new Error(`CONTRACT_VERIFICATION_INCOMPLETE:${status.missing.join(',')}`);
      }
    }
    const failures=error ? row.failures+1 : row.failures;
    // Budget exhaustion and missing-capability errors do not recover by retrying.
    const terminalError=/CODING_CONTRACT_\w*(BUDGET|DURATION)_EXCEEDED|UNKNOWN_TASK_TYPE|WORKER_KEY_MISSING|PLANNER_BLOCKED/.test(String(error || ''));
    const blocked=Boolean(replanRequest) || failures>=3 || terminalError;
    this.db.prepare("UPDATE nova_sessions SET phase=?,owner=NULL,token=NULL,lease_until=NULL,failures=? WHERE mission_id=?")
      .run(completionProposed ? 'AWAITING_VERIFICATION' : blocked ? 'BLOCKED' : 'READY', failures, id);
    if(blocked)this.setStatus(id,'BLOCKED');
    if (completionProposed) this.setStatus(id, 'AWAITING_VERIFICATION');
    // The completion reason is kept: for a read-only mission it is the answer the operator asked for.
    const reason = completionProposed && typeof completionReason === 'string' && completionReason.trim() ? stripEmoji(completionReason).trim().slice(0, 4000) : undefined;
    // Each [#n] the answer cites is checked against the receipts (agents/lib/evidence.mjs).
    const evidence = reason ? checkCitations(reason, this.get(id).receipts) : undefined;
    this.bus.event('NOVA_PLANNING_RESULT', { missionId: id, payload: { error, completionProposed, ...(reason ? { reason, evidence } : {}) } });
    return this.get(id);
  }

  // The planner's last completion reason: for a read-only mission, the answer the operator asked for.
  answer(id) {
    const payload = this.bus.lastMissionEvent(id, 'NOVA_PLANNING_RESULT')?.payload;
    return typeof payload?.reason === 'string' ? payload.reason : null;
  }

  requestCancel(id, note = 'Operatören avslutar uppdraget från Aura.') {
    const mission = this.get(id);
    if (TERMINAL.has(mission.status)) return mission;
    this.bus.event('NOVA_CANCEL_REQUEST', {missionId:id,payload:{note:String(note).slice(0,1000)}});
    this.finishRequestedCancel(id);
    return this.get(id);
  }

  finishRequestedCancel(id) {
    const row=this.db.prepare('SELECT token FROM nova_sessions WHERE mission_id=?').get(id);
    const request=this.bus.lastMissionEvent(id,'NOVA_CANCEL_REQUEST');
    if (!request || row?.token || TERMINAL.has(this.bus.getMission(id).status)) return false;
    this.resolve(id,{decision:'cancel',note:request.payload.note,authority:'operator'});
    return true;
  }

  resolve(id, { decision, note, authority = 'operator' }) {
    const mission = this.get(id);
    if (TERMINAL.has(mission.status)) throw new Error('MISSION_TERMINAL');

    const normalizedAuthority = String(authority || 'operator').toLowerCase();
    if (!['operator', 'seer'].includes(normalizedAuthority)) throw new Error('INVALID_RESOLUTION_AUTHORITY');
    if (!['resume', 'cancel', 'confirm'].includes(decision) || typeof note !== 'string' || !note.trim()) throw new Error('OPERATOR_DECISION_REQUIRED');

    if (normalizedAuthority === 'seer') {
      if (decision !== 'confirm') throw new Error('SEER_RESOLUTION_CONFIRM_ONLY');
      if (mission.source !== 'seer-mission-graph') throw new Error('SEER_RESOLUTION_SOURCE_REQUIRED');
      if (mission.status !== 'AWAITING_VERIFICATION') throw new Error('SEER_RESOLUTION_AWAITING_VERIFICATION_REQUIRED');
      if (mission.receipts.some(r => r?.outcomeUnknown === true || (r?.ok === true && r?.verified !== true))) {
        throw new Error('SEER_RESOLUTION_UNCERTAIN_OUTCOME');
      }
    }

    if (decision === 'confirm' && mission.contract) {
      const status = contractVerificationStatus(mission.contract, mission.receipts);
      if (!status.machineVerified) throw new Error(`CONTRACT_VERIFICATION_INCOMPLETE:${status.missing.join(',')}`);
    }
    if (decision === 'confirm' && !mission.receipts.some(r => r.ok && r.verified)) throw new Error('VERIFIED_RECEIPT_REQUIRED');

    this.recoverExpired();
    const row = this.db.prepare('SELECT token FROM nova_sessions WHERE mission_id=?').get(id);
    if (row.token) throw new Error('MISSION_BUSY');
    // Only an explicit operator note can approve one outgoing-spend action; automated
    // resolutions (SEER, the auto-approval policy) never carry the tag.
    if (decision === 'resume' && normalizedAuthority === 'operator' && SPEND_APPROVAL_TAG.test(note) && !/^auto-/i.test(note.trim())) {
      this.db.prepare('INSERT OR REPLACE INTO nova_spend_approvals(mission_id,approved_at,note) VALUES(?,?,?)').run(id, iso(), note.slice(0, 500));
    }
    this.setStatus(id, decision === 'confirm' ? 'DONE' : decision === 'cancel' ? 'CANCELLED' : 'ACTIVE');
    this.db.prepare('UPDATE nova_sessions SET phase=?,failures=0 WHERE mission_id=?').run(decision === 'resume' ? 'READY' : 'CLOSED', id);
    // Automated resumes (auto-approval policy) never extend the budget; only the operator's own decision does.
    if (decision === 'resume' && normalizedAuthority === 'operator' && !/^auto-/i.test(note.trim())) {
      this.db.prepare('UPDATE nova_sessions SET budget_turn_base=turn,budget_started_at=? WHERE mission_id=?').run(this.now(), id);
    }
    this.bus.event(normalizedAuthority === 'seer' ? 'NOVA_SEER_RESOLUTION' : 'NOVA_OPERATOR_RESOLUTION', {
      missionId: id,
      payload: { decision, note, authority: normalizedAuthority },
    });
    return this.get(id);
  }

  setStatus(id, status) { this.db.prepare('UPDATE missions SET status=?,updated_at=? WHERE id=?').run(status, iso(), id); }
}

export function mountNovaMissionRoutes(app, requireAuth, control, onUpdate = () => {}) {
  const route = fn => (req, res) => {
    try { const data = fn(req); onUpdate(); res.json({ success: true, ...data }); }
    catch (e) { res.status(409).json({ success: false, error: e.message }); }
  };
  const root = '/api/connected/nova';
  app.get(`${root}/current`, requireAuth, route(req => ({ mission: control.current(req.query?.executor ? String(req.query.executor) : null) })));
  app.post(`${root}/missions`, requireAuth, route(req => ({ mission: control.create(req.body || {}) })));
  app.get(`${root}/missions/:id`, requireAuth, route(req => ({ mission: control.get(req.params.id) })));
  app.post(`${root}/missions/:id/cancel`, requireAuth, route(req => ({ mission: control.requestCancel(req.params.id, req.body?.note || 'Parent mission cancellation propagated by SEER.') })));
  app.post(`${root}/missions/:id/claim`, requireAuth, route(req => control.claim(req.params.id, req.body?.owner, req.body?.executor ?? null)));
  app.post(`${root}/missions/:id/preflight`, requireAuth, route(req => control.preflight(req.params.id, req.body || {})));
  app.post(`${root}/missions/:id/begin`, requireAuth, route(req => ({ task: control.begin(req.params.id, req.body || {}) })));
  app.post(`${root}/missions/:id/finish`, requireAuth, route(req => ({ mission: control.finish(req.params.id, req.body || {}) })));
  app.post(`${root}/missions/:id/release`, requireAuth, route(req => ({ mission: control.release(req.params.id, req.body || {}) })));
  app.post(`${root}/missions/:id/resolve`, requireAuth, route(req => ({ mission: control.resolve(req.params.id, req.body || {}) })));
}

