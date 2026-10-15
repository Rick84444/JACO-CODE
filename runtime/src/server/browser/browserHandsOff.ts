import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SurveyLibrary, type ActionableElement } from '../handsOff/surveyLibrary.js';

/**
 * Browser hands-off client.
 *
 * The web counterpart of DesktopHandsOffClient, and deliberately the same
 * contract: an expiring grant with an allowlist, survey-then-execute against a
 * stored route memory, and an append-only receipt ledger where `verified` means
 * the observed state actually changed — not that a command returned without
 * throwing.
 *
 * Why this file exists. The desktop client actuates Windows UI Automation
 * through a PowerShell bridge, so `isSupported()` is false anywhere but Windows,
 * and even on Windows UIA is the wrong instrument for a web application: it sees
 * Chrome's accessibility projection rather than the DOM the page is built from.
 * A WordPress admin is a DOM. So the surface changes and the discipline does not.
 *
 * Actuation goes through the Chrome DevTools Protocol against a browser the
 * operator already launched. Nothing here synthesises OS-level input and nothing
 * acts on a coordinate — every action resolves a selector first, exactly as the
 * desktop client resolves an AutomationId.
 *
 * What it will not do: authenticate. Secrets are refused at the client boundary
 * (see SECRET_TEXT and PASSWORD_TARGET below) for the same reason the desktop
 * client refuses them. The operator signs in once by hand; the agent inherits
 * the authenticated session and runs everything after it unattended. That is
 * where "hands-off" actually lives — not in typing the password, but in not
 * needing a human for any of the hundred steps that follow.
 */

export type BrowserActionType =
  | 'observe' | 'survey' | 'navigate' | 'click' | 'set_value' | 'select' | 'check' | 'scroll' | 'wordpress_apply_css';

export interface BrowserSelector {
  /** CSS selector. Resolved in page context; must match exactly one element. */
  css?: string;
  /** Visible text to disambiguate when several elements match `css`. */
  text?: string;
  /** Zero-based index when a match set is legitimately plural. */
  index?: number;
}

export type BrowserPostcondition =
  | { type: 'url_includes'; value: string }
  | { type: 'title_includes'; value: string }
  | { type: 'selector_exists'; selector: string; text?: string }
  | { type: 'selector_absent'; selector: string }
  | { type: 'value_equals'; selector: string; value: string }
  | { type: 'checked_equals'; selector: string; checked: boolean }
  | { type: 'text_includes'; selector: string; value: string };

export interface BrowserAction {
  action_id?: string;
  type: BrowserActionType;
  selector?: BrowserSelector;
  text?: string;
  url?: string;
  checked?: boolean;
  deltaY?: number;
  wait_after_ms?: number;
  /** Optional semantic proof. Raw page scripts are intentionally not accepted. */
  postcondition?: BrowserPostcondition;
}

export interface BrowserGrant {
  enabled: boolean;
  /** `broad_web` permits normal HTTPS navigation while hard-denying auth/payment/security surfaces. */
  scope_mode: 'origins' | 'broad_web';
  /** Origins the agent may act on when scope_mode=origins. Loopback HTTP is permitted for local JACO. */
  allowed_origins: string[];
  contract_id?: string;
  allow_click: boolean;
  allow_value_set: boolean;
  allow_navigate: boolean;
  allow_select: boolean;
  allow_scroll: boolean;
  expires_at: string;
}

export interface BrowserReceipt {
  action_id: string;
  action_type: BrowserActionType;
  started_at: string;
  finished_at: string;
  success: boolean;
  verified: boolean;
  before_hash: string | null;
  after_hash: string | null;
  page: { url: string; title: string } | null;
  result: unknown;
  verification: {
    state_changed: boolean;
    semantic_required: boolean;
    semantic_satisfied: boolean | null;
    level: 'OBSERVED' | 'STATE_CHANGE' | 'SEMANTIC' | 'UNVERIFIED';
    postcondition?: BrowserPostcondition;
    details?: unknown;
  };
  refusal?: string;
  error?: string;
}

/**
 * Origins that can never be granted. Authentication and payment surfaces, plus
 * the WordPress login endpoint itself: the agent operates on an already
 * authenticated session and has no business on the page that establishes one.
 */
export const BLOCKED_ORIGIN_PATTERN =
  /(accounts\.google|login\.microsoftonline|appleid\.apple|okta\.com|auth0\.com|onelogin|duosecurity|bankid|swish|paypal\.com|checkout\.stripe)/i;

export const BLOCKED_PATH_PATTERN = /(wp-login\.php|\/login|\/signin|\/oauth|\/authorize|\/checkout|\/payment)/i;

/** Text that must be typed by a human, never driven into a field by an agent. */
const SECRET_TEXT =
  /(password|lösenord|passcode|one.?time|otp|verification code|api.?key|secret|private.?key|seed phrase)/i;

/** Selectors that address a credential field, whatever the value being set. */
const PASSWORD_TARGET = /(type=["']?password|#user_pass|\[name=["']?pwd|autocomplete=["']?current-password)/i;

const MUTATING: BrowserActionType[] = ['navigate', 'click', 'set_value', 'select', 'check', 'scroll', 'wordpress_apply_css'];

/** Snapshot hash ignoring volatile fields, so `verified` reflects real change. */
function hashSnapshot(snapshot: unknown): string {
  const normalise = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalise);
    if (value && typeof value === 'object') {
      const output: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) {
        if (['observedAt', 'walkMs', 'nodesWalked', 'scrollY'].includes(key)) continue;
        output[key] = normalise(item);
      }
      return output;
    }
    return value;
  };
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(normalise(snapshot))).digest('hex')}`;
}

/**
 * Actuation transport. Kept behind an interface so the client is testable
 * without a browser, and so an operator can drive it from a CDP socket, a
 * Playwright page, or an MCP tool loop without the policy above changing.
 */
export interface BrowserBridge {
  evaluate<T = unknown>(expression: string): Promise<T>;
  navigate(url: string): Promise<void>;
  close?(): Promise<void>;
}

/** Chrome DevTools Protocol transport over the browser's own debugging socket. */
export class CdpBridge implements BrowserBridge {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  private constructor(private readonly wsUrl: string) {}

  /**
   * Attaches to a tab in a Chrome started with --remote-debugging-port. Matching
   * on URL rather than taking the first tab: the operator's browser has other
   * tabs open and acting in the wrong one is the failure this avoids.
   */
  public static async listTargets(port = 9222): Promise<Array<{ id?: string; type: string; url: string; title?: string; webSocketDebuggerUrl?: string }>> {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`no CDP endpoint on port ${port}`);
    const targets = await response.json() as Array<{ id?: string; type: string; url: string; title?: string; webSocketDebuggerUrl?: string }>;
    return targets.filter((target) => target.type === 'page' && Boolean(target.webSocketDebuggerUrl));
  }

  public static async attach(port: number, urlIncludes: string): Promise<CdpBridge> {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) throw new Error(`no CDP endpoint on port ${port} — start Chrome with --remote-debugging-port=${port}`);
    const targets = (await response.json()) as Array<{ type: string; url: string; webSocketDebuggerUrl?: string }>;
    const target = targets.find((t) => t.type === 'page' && t.url.includes(urlIncludes) && t.webSocketDebuggerUrl);
    if (!target?.webSocketDebuggerUrl) throw new Error(`no open tab matching '${urlIncludes}'`);
    const bridge = new CdpBridge(target.webSocketDebuggerUrl);
    await bridge.connect();
    return bridge;
  }

  private async connect(): Promise<void> {
    const WS = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!WS) throw new Error('global WebSocket unavailable — Node 22+ required');
    await new Promise<void>((resolve, reject) => {
      const socket = new WS(this.wsUrl);
      socket.addEventListener('open', () => { this.socket = socket; resolve(); });
      socket.addEventListener('error', () => reject(new Error('CDP socket failed to open')));
      socket.addEventListener('message', (event: MessageEvent) => {
        let frame: { id?: number; result?: unknown; error?: { message?: string } };
        try { frame = JSON.parse(String(event.data)); } catch { return; }
        if (typeof frame.id !== 'number') return;
        const waiter = this.pending.get(frame.id);
        if (!waiter) return;
        this.pending.delete(frame.id);
        if (frame.error) waiter.reject(new Error(frame.error.message || 'CDP error'));
        else waiter.resolve(frame.result);
      });
    });
  }

  private send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.socket) throw new Error('CDP socket is not connected');
    const id = this.nextId++;
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP ${method} timed out`));
      }, 30_000);
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  public async evaluate<T = unknown>(expression: string): Promise<T> {
    const response = await this.send<{
      result?: { value?: T };
      exceptionDetails?: { exception?: { description?: string } };
    }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description?.slice(0, 300) || 'page threw');
    }
    return response.result?.value as T;
  }

  public async navigate(url: string): Promise<void> {
    try {
      await this.send('Page.navigate', { url });
    } catch (err) {
      // Navigation timeouts are non-fatal — the page may still have loaded
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('timed out')) throw err;
    }
  }

  public async close(): Promise<void> {
    this.socket?.close();
    this.socket = null;
  }
}

/**
 * In-page reconnaissance. Returns the actionable elements and a *structural*
 * fingerprint — tags, roles and ids only. Text and values are excluded on
 * purpose: they are the parts that differ between two instances of the same
 * screen, and a fingerprint that includes them recognises nothing twice.
 */
const SURVEY_SCRIPT = `(() => {
  const started = performance.now();
  const SEL = 'a[href],button,input,select,textarea,[role="button"],[role="tab"],[role="menuitem"],[contenteditable="true"]';
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  const route = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break; }
      const parent = node.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };
  const caps = (el) => {
    const out = [];
    const tag = el.tagName.toLowerCase();
    if (tag === 'a' || tag === 'button' || el.getAttribute('role') === 'button') out.push('click');
    if (tag === 'input' || tag === 'textarea' || el.isContentEditable) out.push('setValue');
    if (tag === 'select') out.push('select');
    if (el.type === 'checkbox' || el.type === 'radio') out.push('check');
    return out;
  };
  const nodes = [...document.querySelectorAll(SEL)].filter(visible).slice(0, 400);
  const actionable = nodes.map((el, depth) => ({
    route: route(el),
    name: (el.getAttribute('aria-label') || el.textContent || el.value || el.name || '').trim().slice(0, 120),
    controlType: el.tagName.toLowerCase() + (el.type ? ':' + el.type : ''),
    automationId: el.id || '',
    patterns: caps(el),
    depth,
    stableKey: el.getAttribute('name') || el.id || null,
  }));
  // Structural candidate key — no names or values.
  const skeleton = actionable.map((a) => a.controlType + '|' + a.automationId).sort().join(',');
  // Semantic guard: bounded labels/roles/ids. Conservative drift is preferable
  // to executing a remembered route against a screen whose meaning changed.
  const semanticAnchors = actionable.slice(0, 80).map((a) =>
    [a.controlType, a.automationId, a.stableKey || '', (a.name || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 80)].join('|')
  ).sort();
  const semanticText = semanticAnchors.join('\n');
  return {
    fingerprint: 'web:' + location.host + location.pathname + ':' + skeleton.length + ':' +
      [...skeleton].reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0).toString(16),
    semanticSignature: 'sem:' + semanticText.length + ':' +
      [...semanticText].reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0).toString(16),
    semanticAnchors,
    page: { url: location.href, title: document.title },
    actionable,
    nodesWalked: nodes.length,
    walkMs: Math.round(performance.now() - started),
    budgetExhausted: nodes.length >= 400,
  };
})()`;

/** Cheap state snapshot used to prove an action changed something. */
const OBSERVE_SCRIPT = `(() => ({
  page: { url: location.href, title: document.title },
  controls: [...document.querySelectorAll('a[href],button,input,select,textarea')].slice(0, 300)
    .map((el) => el.tagName + ':' + (el.id || '') + ':' + (el.value ?? '') + ':' +
      (el.textContent || '').trim().slice(0, 40) + ':' + (el.checked ?? '')),
  bodyLength: document.body ? document.body.innerHTML.length : 0,
}))()`;

export class BrowserHandsOffClient {
  private readonly stateRoot: string;
  private lastSemanticSignature: string | null = null;
  private readonly ledgerPath: string;
  private readonly grantPath: string;
  private readonly library: SurveyLibrary;

  constructor(private readonly workspaceRoot: string, private readonly bridge: BrowserBridge) {
    this.stateRoot = path.join(workspaceRoot, '.jaco', 'state', 'browser-hands-off');
    fs.mkdirSync(this.stateRoot, { recursive: true });
    this.ledgerPath = path.join(this.stateRoot, 'action-ledger.jsonl');
    this.grantPath = path.join(this.stateRoot, 'grant.json');
    this.library = new SurveyLibrary(workspaceRoot, 'browser-hands-off');
  }

  // ── Grant ──────────────────────────────────────────────────────────────────
  public getGrant(): BrowserGrant | null {
    try {
      const grant = JSON.parse(fs.readFileSync(this.grantPath, 'utf8')) as BrowserGrant;
      if (Date.parse(grant.expires_at) <= Date.now()) return { ...grant, enabled: false };
      return grant;
    } catch {
      return null;
    }
  }

  public configureGrant(input: Partial<BrowserGrant>): BrowserGrant {
    if (input.enabled === false) {
      const disabled: BrowserGrant = {
        enabled: false, scope_mode: 'origins', allowed_origins: [],
        allow_click: false, allow_value_set: false, allow_navigate: false,
        allow_select: false, allow_scroll: false,
        expires_at: new Date().toISOString(),
      };
      this.writeGrant(disabled);
      return disabled;
    }

    const scopeMode: BrowserGrant['scope_mode'] = input.scope_mode === 'broad_web' ? 'broad_web' : 'origins';
    const origins = Array.isArray(input.allowed_origins) ? input.allowed_origins : [];
    if (scopeMode === 'origins' && (origins.length === 0 || origins.length > 50)) {
      throw new Error('allowed_origins must contain 1-50 origins when scope_mode=origins');
    }
    const normalised = origins.map((value) => {
      let parsed: URL;
      try { parsed = new URL(String(value)); } catch { throw new Error(`'${value}' is not a valid origin`); }
      const loopback = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
      if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
        throw new Error(`'${value}' must be HTTPS (HTTP is accepted only on loopback)`);
      }
      if (BLOCKED_ORIGIN_PATTERN.test(parsed.host)) {
        throw new Error(`'${parsed.host}' is an authentication or payment surface and can never be granted`);
      }
      return parsed.origin;
    });

    const expiry = Date.parse(String(input.expires_at || ''));
    if (!Number.isFinite(expiry)) throw new Error('expires_at must be an ISO timestamp');
    if (expiry <= Date.now()) throw new Error('grant has already expired');
    if (expiry > Date.now() + 8 * 60 * 60_000) throw new Error('browser grant cannot exceed 8 hours');

    const grant: BrowserGrant = {
      enabled: true,
      scope_mode: scopeMode,
      allowed_origins: normalised,
      ...(input.contract_id ? { contract_id: String(input.contract_id) } : {}),
      allow_click: input.allow_click !== false,
      allow_value_set: input.allow_value_set === true,
      allow_navigate: input.allow_navigate !== false,
      allow_select: input.allow_select !== false,
      allow_scroll: input.allow_scroll !== false,
      expires_at: new Date(expiry).toISOString(),
    };
    this.writeGrant(grant);
    return grant;
  }

  private writeGrant(grant: BrowserGrant): void {
    const temporary = `${this.grantPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(grant, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, this.grantPath);
  }

  // ── Observation ────────────────────────────────────────────────────────────
  public async observe(): Promise<Record<string, unknown> | null> {
    try {
      return await this.bridge.evaluate<Record<string, unknown>>(OBSERVE_SCRIPT);
    } catch {
      return null;
    }
  }

  /**
   * Reconnaissance pass. Walks the page once, stores what it found, and reports
   * whether this state was already known. Survey first, then execute against the
   * stored routes — the second visit to a WordPress screen should not rediscover
   * it from scratch.
   */
  public async survey(label?: string): Promise<Record<string, unknown> | null> {
    const data = await this.bridge.evaluate<{
      fingerprint: string;
      semanticSignature: string;
      semanticAnchors: string[];
      page: { url: string; title: string };
      actionable: ActionableElement[];
      nodesWalked: number;
      walkMs: number;
      budgetExhausted: boolean;
    }>(SURVEY_SCRIPT);
    if (!data?.fingerprint) return null;

    const { record, recognised, semanticMatched } = this.library.record({
      fingerprint: data.fingerprint,
      semanticSignature: data.semanticSignature,
      semanticAnchors: data.semanticAnchors,
      windowName: data.page.title,
      processName: new URL(data.page.url).host,
      actionable: data.actionable,
      nodesWalked: data.nodesWalked,
      walkMs: data.walkMs,
      budgetExhausted: data.budgetExhausted,
      label,
    });

    this.lastSemanticSignature = data.semanticSignature;
    return {
      ...data,
      recognised,
      semanticMatched,
      timesSeen: record.timesSeen,
      routesConfirmed: record.routesConfirmed,
      routesLost: record.routesLost,
      reuseAvailable: recognised && semanticMatched && record.routesLost === 0 && record.actionableCount > 0,
    };
  }

  public recallRoute(query: { processName?: string; name?: string; automationId?: string }) {
    // Route reuse is survey-gated. No current semantic signature means there is
    // no evidence that an old route belongs to the current page state.
    if (!this.lastSemanticSignature) return [];
    return this.library.findRoute({ ...query, semanticSignature: this.lastSemanticSignature });
  }

  public libraryStats(): Record<string, unknown> {
    return this.library.stats();
  }

  // ── Verified execution ─────────────────────────────────────────────────────
  private targetAllowed(rawUrl: string, grant: BrowserGrant): { allowed: boolean; reason?: string } {
    let target: URL;
    try { target = new URL(rawUrl); } catch { return { allowed: false, reason: 'invalid URL' }; }
    if (!['http:', 'https:'].includes(target.protocol)) return { allowed: false, reason: `protocol '${target.protocol}' is not permitted` };
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(target.hostname);
    if (target.protocol === 'http:' && !loopback) return { allowed: false, reason: 'plain HTTP is permitted only on loopback' };
    if (BLOCKED_ORIGIN_PATTERN.test(target.host) || BLOCKED_PATH_PATTERN.test(target.pathname)) {
      return { allowed: false, reason: 'authentication/payment surface requires direct human operation' };
    }
    if (grant.scope_mode === 'broad_web') return { allowed: true };
    return grant.allowed_origins.includes(target.origin)
      ? { allowed: true }
      : { allowed: false, reason: `'${target.origin}' is outside the granted origins` };
  }

  private inferPostcondition(action: BrowserAction): BrowserPostcondition | undefined {
    if (action.postcondition) return action.postcondition;
    if (action.type === 'navigate' && action.url) return { type: 'url_includes', value: String(action.url) };
    if (action.type === 'set_value' && action.selector?.css) return { type: 'value_equals', selector: action.selector.css, value: String(action.text ?? '') };
    if (action.type === 'select' && action.selector?.css) return { type: 'value_equals', selector: action.selector.css, value: String(action.text ?? '') };
    if (action.type === 'check' && action.selector?.css) return { type: 'checked_equals', selector: action.selector.css, checked: action.checked === true };
    return undefined;
  }

  private async verifyPostcondition(postcondition: BrowserPostcondition): Promise<{ satisfied: boolean; details: unknown }> {
    const pc = JSON.stringify(postcondition);
    return this.bridge.evaluate<{ satisfied: boolean; details: unknown }>(`(() => {
      const p = ${pc};
      const safeQuery = (selector) => { try { return document.querySelector(selector); } catch { return null; } };
      let satisfied = false; let details = null;
      if (p.type === 'url_includes') { satisfied = location.href.includes(p.value); details = location.href; }
      else if (p.type === 'title_includes') { satisfied = document.title.includes(p.value); details = document.title; }
      else if (p.type === 'selector_exists') { const el = safeQuery(p.selector); const text = el ? ((el.getAttribute('aria-label') || el.textContent || '')).trim() : ''; satisfied = !!el && (!p.text || text.includes(p.text)); details = { exists: !!el, text: text.slice(0, 160) }; }
      else if (p.type === 'selector_absent') { const el = safeQuery(p.selector); satisfied = !el; details = { exists: !!el }; }
      else if (p.type === 'value_equals') { const el = safeQuery(p.selector); const value = el && 'value' in el ? el.value : null; satisfied = value === p.value; details = { value }; }
      else if (p.type === 'checked_equals') { const el = safeQuery(p.selector); const checked = el && 'checked' in el ? !!el.checked : null; satisfied = checked === p.checked; details = { checked }; }
      else if (p.type === 'text_includes') { const el = safeQuery(p.selector); const text = el ? (el.textContent || '').trim() : ''; satisfied = !!el && text.includes(p.value); details = { text: text.slice(0, 240) }; }
      return { satisfied, details };
    })()`);
  }

  public async executeVerified(action: BrowserAction): Promise<BrowserReceipt> {
    const actionId = action.action_id || crypto.randomUUID();
    const startedAt = new Date().toISOString();
    let before: Record<string, unknown> | null = null;

    const fail = (reason: string, refusal = false): BrowserReceipt => {
      const receipt: BrowserReceipt = {
        action_id: actionId,
        action_type: action.type,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        success: false,
        verified: false,
        before_hash: before ? hashSnapshot(before) : null,
        after_hash: null,
        page: (before?.page as { url: string; title: string }) ?? null,
        result: null,
        verification: { state_changed: false, semantic_required: Boolean(action.postcondition), semantic_satisfied: null, level: 'UNVERIFIED', ...(action.postcondition ? { postcondition: action.postcondition } : {}) },
        ...(refusal ? { refusal: reason } : { error: reason }),
      };
      this.appendReceipt(receipt);
      return receipt;
    };

    if (MUTATING.includes(action.type)) {
      const grant = this.getGrant();
      if (!grant?.enabled) return fail('no active browser hands-off grant', true);
      if (Date.parse(grant.expires_at) <= Date.now()) return fail('browser hands-off grant has expired', true);

      const denied =
        (action.type === 'click' && !grant.allow_click) ||
        (action.type === 'set_value' && !grant.allow_value_set) ||
        (action.type === 'navigate' && !grant.allow_navigate) ||
        (action.type === 'select' && !grant.allow_select) ||
        (action.type === 'scroll' && !grant.allow_scroll) ||
        (action.type === 'wordpress_apply_css' && (!grant.allow_value_set || !grant.allow_click));
      if (denied) return fail(`the active grant does not permit '${action.type}'`, true);

      // Origin is re-checked per action, not just at grant time: a page can
      // navigate itself between two actions.
      const current = await this.bridge.evaluate<string>('location.href');
      const currentGate = this.targetAllowed(current, grant);
      if (!currentGate.allowed) return fail(currentGate.reason || 'current page is outside grant', true);

      if (action.type === 'navigate') {
        const target = String(action.url || '');
        if (!target) return fail('navigate requires a valid url');
        const targetGate = this.targetAllowed(target, grant);
        if (!targetGate.allowed) return fail(targetGate.reason || 'navigation target is outside grant', true);
      }

      if (action.type === 'set_value') {
        const text = String(action.text ?? '');
        if (!text) return fail('set_value requires text');
        if (text.length > 200_000) return fail('text exceeds the 200000 character limit');
        const target = `${action.selector?.css ?? ''} ${action.selector?.text ?? ''}`;
        if (PASSWORD_TARGET.test(target) || SECRET_TEXT.test(target) || SECRET_TEXT.test(text.slice(0, 200))) {
          return fail('secrets and authentication codes require direct human entry', true);
        }
      }

      if (action.type === 'wordpress_apply_css') {
        const css = String(action.text ?? '');
        if (!css.trim()) return fail('wordpress_apply_css requires CSS in action.text');
        if (css.length > 200_000) return fail('CSS exceeds the 200000 character limit');
        const url = new URL(current);
        if (!/\/wp-admin\/(customize\.php|customize\.php)/i.test(url.pathname)) return fail('wordpress_apply_css requires an already-authenticated WordPress Customizer tab', true);
      }
    }

    try {
      before = await this.observe();

      let result: unknown;
      if (action.type === 'navigate') {
        await this.bridge.navigate(String(action.url));
        result = { navigatedTo: action.url };
      } else if (action.type === 'observe') {
        result = before;
      } else if (action.type === 'survey') {
        result = await this.survey();
      } else if (action.type === 'wordpress_apply_css') {
        const css = String(action.text ?? '');
        const marker = `jaco-css-${crypto.createHash('sha256').update(css).digest('hex').slice(0, 12)}`;
        const script = `(() => {
          if (!window.wp || !wp.customize) return { error: 'wp.customize unavailable' };
          const setting = wp.customize('custom_css');
          if (!setting) return { error: 'custom_css setting unavailable; open Additional CSS in Customizer' };
          const css = ${JSON.stringify('PLACEHOLDER')};
          setting.set(css);
          const publish = document.querySelector('#save, button.publish, .save');
          if (!publish) return { error: 'Customizer publish button not found' };
          publish.click();
          return { applied: setting.get() === css, marker: ${JSON.stringify('MARKER_PLACEHOLDER')}, length: css.length };
        })()`
          .replace(JSON.stringify('PLACEHOLDER'), JSON.stringify(css + `\n/* ${marker} */`))
          .replace(JSON.stringify('MARKER_PLACEHOLDER'), JSON.stringify(marker));
        result = await this.bridge.evaluate(script);
        if ((result as { error?: string })?.error) return fail(String((result as { error: string }).error));
        await new Promise((resolve) => setTimeout(resolve, Math.max(1200, Number(action.wait_after_ms || 1800))));
        const verify = await this.bridge.evaluate<any>(`(() => {
          if (!window.wp || !wp.customize) return { present:false, saved:null };
          const setting = wp.customize('custom_css');
          const value = setting ? String(setting.get() || '') : '';
          const saved = wp.customize.state && wp.customize.state('saved') ? wp.customize.state('saved').get() : null;
          return { present: value.includes(${JSON.stringify('MARKER_PLACEHOLDER')}), saved };
        })()`.replace(JSON.stringify('MARKER_PLACEHOLDER'), JSON.stringify(marker)));
        if (!verify?.present) return fail('WordPress Customizer CSS readback failed');
        result = { ...(result as any), verify };
      } else {
        result = await this.bridge.evaluate(this.buildActionScript(action));
        if ((result as { error?: string })?.error) return fail(String((result as { error: string }).error));
      }

      const settle = Math.max(200, Math.min(10_000, Number(action.wait_after_ms || 700)));
      await new Promise((resolve) => setTimeout(resolve, settle));
      const after = await this.observe();

      const beforeHash = before ? hashSnapshot(before) : null;
      const afterHash = after ? hashSnapshot(after) : null;

      const passive = action.type === 'observe' || action.type === 'survey';
      const stateChanged = Boolean(beforeHash && afterHash && beforeHash !== afterHash);
      const postcondition = this.inferPostcondition(action);
      const semantic = postcondition ? await this.verifyPostcondition(postcondition) : null;
      const semanticSatisfied = semantic?.satisfied ?? null;
      // L1 proves the page changed; L2 proves the expected semantic condition.
      // Passive observations are evidence without mutation. Click/scroll can be
      // L1 verified when no postcondition is supplied; high-consequence callers
      // must require a postcondition at the contract/relay boundary.
      const wordpressCssVerified = action.type === 'wordpress_apply_css' && Boolean((result as any)?.verify?.present);
      const verified = passive ? Boolean(afterHash) : wordpressCssVerified ? true : stateChanged && (postcondition ? semanticSatisfied === true : true);
      const level: BrowserReceipt['verification']['level'] = passive
        ? 'OBSERVED'
        : wordpressCssVerified ? 'SEMANTIC'
        : verified && postcondition ? 'SEMANTIC'
        : verified ? 'STATE_CHANGE'
        : 'UNVERIFIED';

      const receipt: BrowserReceipt = {
        action_id: actionId,
        action_type: action.type,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        success: true,
        verified,
        before_hash: beforeHash,
        after_hash: afterHash,
        page: (after?.page as { url: string; title: string }) ?? null,
        result,
        verification: { state_changed: stateChanged, semantic_required: Boolean(postcondition), semantic_satisfied: semanticSatisfied, level, ...(postcondition ? { postcondition } : {}), ...(semantic ? { details: semantic.details } : {}) },
      };
      this.appendReceipt(receipt);
      return receipt;
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Builds the in-page actuation. Values cross into the page as JSON literals
   * rather than by interpolation, so page content can never be parsed as script.
   */
  private buildActionScript(action: BrowserAction): string {
    const selector = JSON.stringify(action.selector?.css ?? '');
    const wantedText = JSON.stringify(action.selector?.text ?? '');
    const index = Number(action.selector?.index ?? 0);
    const value = JSON.stringify(action.text ?? '');
    const checked = action.checked === true;
    const deltaY = Number(action.deltaY ?? 400);

    const resolve = `
      const matches = [...document.querySelectorAll(${selector})];
      const wanted = ${wantedText};
      const filtered = wanted
        ? matches.filter((el) => ((el.getAttribute('aria-label') || el.textContent || '').trim().includes(wanted)))
        : matches;
      if (filtered.length === 0) return { error: 'selector matched no element: ' + ${selector} };
      const el = filtered[${index}];
      if (!el) return { error: 'index ' + ${index} + ' out of range (' + filtered.length + ' matches)' };`;

    switch (action.type) {
      case 'click':
        return `(() => {${resolve}
          if (el.tagName === 'INPUT' && el.type === 'password') return { error: 'refusing to act on a password field' };
          el.scrollIntoView({ block: 'center' });
          el.click();
          return { clicked: el.tagName + (el.id ? '#' + el.id : ''), matches: filtered.length };
        })()`;
      case 'set_value':
        return `(() => {${resolve}
          if (el.tagName === 'INPUT' && el.type === 'password') return { error: 'refusing to write to a password field' };
          el.focus();
          if (el.isContentEditable) { el.textContent = ${value}; }
          else {
            const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
            setter.call(el, ${value});
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { set: true, length: ${value}.length };
        })()`;
      case 'select':
        return `(() => {${resolve}
          el.value = ${value};
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { selected: el.value };
        })()`;
      case 'check':
        return `(() => {${resolve}
          el.checked = ${checked};
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { checked: el.checked };
        })()`;
      case 'scroll':
        return `(() => { window.scrollBy(0, ${deltaY}); return { scrollY: window.scrollY }; })()`;
      default:
        return `(() => ({ error: 'unsupported action' }))()`;
    }
  }

  public listReceipts(limit = 50): BrowserReceipt[] {
    try {
      if (!fs.existsSync(this.ledgerPath)) return [];
      return fs.readFileSync(this.ledgerPath, 'utf8')
        .split('\n').filter(Boolean)
        .slice(-Math.max(1, Math.min(limit, 200)))
        .reverse()
        .map((line) => JSON.parse(line) as BrowserReceipt);
    } catch {
      return [];
    }
  }

  private appendReceipt(receipt: BrowserReceipt): void {
    fs.appendFileSync(this.ledgerPath, `${JSON.stringify(receipt)}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  public async status(): Promise<Record<string, unknown>> {
    const grant = this.getGrant();
    let page: unknown = null;
    let reachable = true;
    try { page = await this.bridge.evaluate('({ url: location.href, title: document.title })'); }
    catch { reachable = false; }

    const receipts = this.listReceipts(200);
    const mutating = receipts.filter((r) => r.action_type !== 'observe' && r.action_type !== 'survey');
    return {
      surface: 'browser',
      actuation: 'dom',
      syntheticInput: false,
      reachable,
      page,
      grant: grant ?? { enabled: false },
      grantActive: Boolean(grant?.enabled && Date.parse(grant.expires_at) > Date.now()),
      receiptCount: receipts.length,
      // The number that matters: of everything that tried to change the page,
      // how much provably did.
      verificationRate: mutating.length
        ? Math.round((mutating.filter((r) => r.verified).length / mutating.length) * 100)
        : null,
      surveyLibrary: this.library.stats(),
      evidenceState: !reachable ? 'UNAVAILABLE' : grant?.enabled ? 'OBSERVED' : 'DEGRADED',
    };
  }
}
