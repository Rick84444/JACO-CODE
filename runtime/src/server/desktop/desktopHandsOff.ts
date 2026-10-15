import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Desktop hands-off client (Windows, UI Automation).
 *
 * The desktop counterpart of HandsOffClient. Same contract deliberately: an
 * expiring grant with an allowlist, an observe/act loop, and an append-only
 * receipt ledger where `verified` means the observed state actually changed —
 * not that a command returned without throwing.
 *
 * Actuation goes through scripts/windows/jaco-uia-bridge.ps1, which drives the
 * application's own UI Automation patterns. Nothing here synthesises mouse or
 * keyboard input, and nothing acts on a coordinate.
 */

export type DesktopActionType = 'observe' | 'focus' | 'invoke' | 'set_value' | 'toggle' | 'select' | 'expand' | 'collapse' | 'scroll';

export interface DesktopSelector {
  name?: string;
  automationId?: string;
  controlType?: string;
  className?: string;
  index?: number;
}

export interface DesktopAction {
  action_id?: string;
  type: DesktopActionType;
  hwnd?: number;
  selector?: DesktopSelector;
  text?: string;
  amount?: 'SmallIncrement' | 'SmallDecrement' | 'LargeIncrement' | 'LargeDecrement';
  wait_after_ms?: number;
}

export interface DesktopGrant {
  enabled: boolean;
  allowed_processes: string[];
  allow_invoke: boolean;
  allow_value_set: boolean;
  allow_toggle: boolean;
  allow_select: boolean;
  allow_scroll: boolean;
  expires_at: string;
}

export interface DesktopReceipt {
  action_id: string;
  action_type: DesktopActionType;
  started_at: string;
  finished_at: string;
  success: boolean;
  verified: boolean;
  before_hash: string | null;
  after_hash: string | null;
  window: Record<string, unknown> | null;
  result: unknown;
  refusal?: string;
  error?: string;
}

/**
 * Refusal policy. Lives here rather than in the bridge so it is versioned and
 * testable next to the grant — and because an actuation script carrying these
 * literals is indistinguishable from credential-theft tooling to AMSI, which
 * blocked an earlier build of the bridge outright.
 */
export const BLOCKED_PROCESSES = [
  'consent', 'lsass', 'winlogon', 'logonui', 'credentialuibroker',
  'securityhealthhost', 'securityhealthsystray', 'systemsettingsadminflows',
  'keepass', 'keepassxc', '1password', 'bitwarden', 'dashlane', 'lastpass',
  'keeper', 'protonpass', 'enpass',
];

export const BLOCKED_TITLE_PATTERN =
  '(?i)(user account control|windows security|kontokontroll|sign in to|enter your (pin|password)|administrator: )';

export const SECRET_FIELD_PATTERN =
  '(?i)(password|l\\u00f6senord|passcode|pin\\b|otp|one.?time|verification code|api.?key|secret|token|seed phrase)';

/** Text that must be typed by a human, never driven into a field by an agent. */
const SECRET_TEXT = /(password|lösenord|passcode|one.?time|otp|verification code|api.?key|secret|private.?key|seed phrase)/i;

const MUTATING: DesktopActionType[] = ['invoke', 'set_value', 'toggle', 'select', 'expand', 'collapse', 'scroll'];

/** Snapshot hash ignoring volatile fields, so `verified` reflects real change. */
function hashSnapshot(snapshot: unknown): string {
  const normalise = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalise);
    if (value && typeof value === 'object') {
      const output: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) {
        if (['observedAt', 'nodeBudgetRemaining', 'rect', 'walkError'].includes(key)) continue;
        output[key] = normalise(item);
      }
      return output;
    }
    return value;
  };
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(normalise(snapshot))).digest('hex')}`;
}

interface BridgeResponse {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  refusal?: string;
}

export class DesktopHandsOffClient {
  private readonly stateRoot: string;
  private readonly ledgerPath: string;
  private readonly grantPath: string;
  private readonly bridgePath: string;

  constructor(private readonly workspaceRoot: string, private readonly releaseRoot: string = workspaceRoot) {
    this.stateRoot = path.join(workspaceRoot, '.jaco', 'state', 'desktop-hands-off');
    fs.mkdirSync(this.stateRoot, { recursive: true });
    this.ledgerPath = path.join(this.stateRoot, 'action-ledger.jsonl');
    this.grantPath = path.join(this.stateRoot, 'grant.json');
    this.bridgePath = path.join(releaseRoot, 'scripts', 'windows', 'jaco-uia-bridge.ps1');
  }

  public isSupported(): boolean {
    return process.platform === 'win32' && fs.existsSync(this.bridgePath);
  }

  // ── Grant ──────────────────────────────────────────────────────────────────
  public getGrant(): DesktopGrant | null {
    try {
      const grant = JSON.parse(fs.readFileSync(this.grantPath, 'utf8')) as DesktopGrant;
      if (Date.parse(grant.expires_at) <= Date.now()) return { ...grant, enabled: false };
      return grant;
    } catch {
      return null;
    }
  }

  public configureGrant(input: Partial<DesktopGrant>): DesktopGrant {
    if (input.enabled === false) {
      const disabled: DesktopGrant = {
        enabled: false,
        allowed_processes: [],
        allow_invoke: false,
        allow_value_set: false,
        allow_toggle: false,
        allow_select: false,
        allow_scroll: false,
        expires_at: new Date().toISOString(),
      };
      this.writeGrant(disabled);
      return disabled;
    }

    const processes = Array.isArray(input.allowed_processes) ? input.allowed_processes : [];
    if (processes.length === 0 || processes.length > 10) throw new Error('allowed_processes must contain 1-10 process names');
    const normalised = processes.map((name) => String(name).trim().toLowerCase().replace(/\.exe$/, ''));
    if (normalised.some((name) => !/^[a-z0-9_.-]{2,64}$/.test(name))) throw new Error('allowed_processes contains an invalid process name');
    const blocked = normalised.find((name) => BLOCKED_PROCESSES.includes(name));
    if (blocked) throw new Error(`'${blocked}' is a credential or system-security surface and can never be granted`);

    const expiry = Date.parse(String(input.expires_at || ''));
    if (!Number.isFinite(expiry)) throw new Error('expires_at must be an ISO timestamp');
    if (expiry <= Date.now()) throw new Error('grant has already expired');
    if (expiry > Date.now() + 8 * 60 * 60_000) throw new Error('desktop grant cannot exceed 8 hours');

    const grant: DesktopGrant = {
      enabled: true,
      allowed_processes: normalised,
      allow_invoke: input.allow_invoke !== false,
      allow_value_set: input.allow_value_set === true,
      allow_toggle: input.allow_toggle !== false,
      allow_select: input.allow_select !== false,
      allow_scroll: input.allow_scroll !== false,
      expires_at: new Date(expiry).toISOString(),
    };
    this.writeGrant(grant);
    return grant;
  }

  private writeGrant(grant: DesktopGrant): void {
    const temporary = `${this.grantPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(grant, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, this.grantPath);
  }

  // ── Bridge ─────────────────────────────────────────────────────────────────
  private async runBridge(request: Record<string, unknown>, timeoutMs = 20_000): Promise<BridgeResponse> {
    if (!this.isSupported()) {
      return { ok: false, error: process.platform === 'win32' ? `bridge script not found at ${this.bridgePath}` : 'desktop hands-off requires Windows' };
    }

    const requestFile = path.join(os.tmpdir(), `jaco-uia-${crypto.randomUUID()}.json`);
    fs.writeFileSync(requestFile, JSON.stringify({
      ...request,
      blockedProcesses: BLOCKED_PROCESSES,
      blockedTitlePattern: BLOCKED_TITLE_PATTERN,
      secretFieldPattern: SECRET_FIELD_PATTERN,
    }), { encoding: 'utf8', mode: 0o600 });

    try {
      return await new Promise<BridgeResponse>((resolve) => {
        // Argument vector only. No -Command, no interpolation: the request never
        // reaches a PowerShell parser.
        const child = spawn('powershell.exe', [
          '-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
          '-File', this.bridgePath, '-RequestFile', requestFile,
        ], { windowsHide: true });

        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (response: BridgeResponse) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(response);
        };
        const timer = setTimeout(() => {
          child.kill();
          finish({ ok: false, error: `bridge did not answer within ${timeoutMs} ms` });
        }, timeoutMs);

        child.stdout.on('data', (chunk) => { stdout += String(chunk); });
        child.stderr.on('data', (chunk) => { stderr += String(chunk); });
        child.on('error', (error) => finish({ ok: false, error: error.message }));
        child.on('close', () => {
          const line = stdout.trim().split('\n').filter(Boolean).pop();
          if (!line) {
            finish({ ok: false, error: stderr.trim().slice(0, 500) || 'bridge produced no output' });
            return;
          }
          try {
            finish(JSON.parse(line) as BridgeResponse);
          } catch {
            finish({ ok: false, error: `bridge output was not JSON: ${line.slice(0, 300)}` });
          }
        });
      });
    } catch (error: any) {
      // spawn() can throw synchronously (e.g. "spawn UNKNOWN" when Windows is short of
      // resources). That rejection used to escape the route and crash the whole runtime.
      return { ok: false, error: `bridge could not start: ${error?.message || String(error)}` };
    } finally {
      try { fs.unlinkSync(requestFile); } catch { /* best effort */ }
    }
  }

  public async capabilities(): Promise<BridgeResponse> {
    return this.runBridge({ command: 'capabilities' });
  }

  // Several callers poll the window list (GUI snapshot, Nova, remote bridge). One bridge
  // process at a time serves them all, and a result is reused for a short moment.
  private windowsInFlight: Promise<BridgeResponse> | null = null;
  private windowsCache: { at: number; response: BridgeResponse } | null = null;
  public async listWindows(maxAgeMs = 1500): Promise<BridgeResponse> {
    if (this.windowsCache && Date.now() - this.windowsCache.at <= maxAgeMs) return this.windowsCache.response;
    if (!this.windowsInFlight) {
      this.windowsInFlight = this.runBridge({ command: 'windows' })
        .then(response => { if (response.ok) this.windowsCache = { at: Date.now(), response }; return response; })
        .finally(() => { this.windowsInFlight = null; });
    }
    return this.windowsInFlight;
  }

  public async observe(hwnd?: number): Promise<Record<string, unknown> | null> {
    const response = await this.runBridge({ command: 'observe', hwnd: hwnd ?? null, maxDepth: 7, maxNodes: 500 });
    return response.ok && response.data ? response.data : null;
  }

  // ── Verified execution ─────────────────────────────────────────────────────
  public async executeVerified(action: DesktopAction): Promise<DesktopReceipt> {
    const actionId = action.action_id || crypto.randomUUID();
    const startedAt = new Date().toISOString();
    let before: Record<string, unknown> | null = null;
    let after: Record<string, unknown> | null = null;

    const fail = (reason: string, refusal = false): DesktopReceipt => {
      const receipt: DesktopReceipt = {
        action_id: actionId,
        action_type: action.type,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        success: false,
        verified: false,
        before_hash: before ? hashSnapshot(before) : null,
        after_hash: null,
        window: (before?.window as Record<string, unknown>) ?? null,
        result: null,
        ...(refusal ? { refusal: reason } : { error: reason }),
      };
      this.appendReceipt(receipt);
      return receipt;
    };

    // Grant checks happen here as well as in the bridge. The bridge enforces the
    // process allowlist; the per-capability flags are the operator's contract and
    // belong on this side.
    if (MUTATING.includes(action.type)) {
      const grant = this.getGrant();
      if (!grant?.enabled) return fail('no active desktop hands-off grant', true);
      if (Date.parse(grant.expires_at) <= Date.now()) return fail('desktop hands-off grant has expired', true);
      const capabilityDenied =
        (action.type === 'invoke' && !grant.allow_invoke) ||
        (action.type === 'set_value' && !grant.allow_value_set) ||
        (action.type === 'toggle' && !grant.allow_toggle) ||
        (action.type === 'select' && !grant.allow_select) ||
        (action.type === 'scroll' && !grant.allow_scroll);
      if (capabilityDenied) return fail(`the active grant does not permit '${action.type}'`, true);

      if (action.type === 'set_value') {
        const text = String(action.text ?? '');
        if (!text) return fail('set_value requires text');
        if (text.length > 2000) return fail('text exceeds the 2000 character limit');
        if (SECRET_TEXT.test(text) || SECRET_TEXT.test(action.selector?.name || '')) {
          return fail('secrets and authentication codes require direct human entry', true);
        }
      }
    }

    try {
      before = await this.observe(action.hwnd);

      const grant = this.getGrant();
      const response = await this.runBridge({
        command: action.type === 'observe' ? 'observe' : action.type,
        hwnd: action.hwnd ?? null,
        selector: action.selector ?? null,
        text: action.text ?? null,
        amount: action.amount ?? null,
        allowedProcesses: grant?.allowed_processes ?? [],
      });

      if (response.refusal) return fail(response.refusal, true);
      if (!response.ok) return fail(response.error || 'bridge reported failure');

      const settle = Math.max(200, Math.min(5_000, Number(action.wait_after_ms || 600)));
      await new Promise((resolve) => setTimeout(resolve, settle));
      after = await this.observe(action.hwnd);

      const beforeHash = before ? hashSnapshot(before) : null;
      const afterHash = after ? hashSnapshot(after) : null;

      // Observation is verified by definition. Every other action must show a
      // changed snapshot; a command that returned cleanly while the UI stayed
      // identical is reported as unverified rather than as success.
      const verified = action.type === 'observe'
        ? Boolean(afterHash)
        : Boolean(beforeHash && afterHash && beforeHash !== afterHash);

      const receipt: DesktopReceipt = {
        action_id: actionId,
        action_type: action.type,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        success: true,
        verified,
        before_hash: beforeHash,
        after_hash: afterHash,
        window: (after?.window as Record<string, unknown>) ?? (before?.window as Record<string, unknown>) ?? null,
        result: response.data ?? null,
      };
      this.appendReceipt(receipt);
      return receipt;
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }

  public listReceipts(limit = 50): DesktopReceipt[] {
    try {
      if (!fs.existsSync(this.ledgerPath)) return [];
      return fs.readFileSync(this.ledgerPath, 'utf8')
        .split('\n').filter(Boolean)
        .slice(-Math.max(1, Math.min(limit, 200)))
        .reverse()
        .map((line) => JSON.parse(line) as DesktopReceipt);
    } catch {
      return [];
    }
  }

  private appendReceipt(receipt: DesktopReceipt): void {
    fs.appendFileSync(this.ledgerPath, `${JSON.stringify(receipt)}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  public async status(): Promise<Record<string, unknown>> {
    const grant = this.getGrant();
    const capabilities = this.isSupported() ? await this.capabilities() : null;
    return {
      supported: this.isSupported(),
      platform: process.platform,
      bridgePath: this.bridgePath,
      actuation: 'ui-automation',
      syntheticInput: false,
      grant: grant ?? { enabled: false },
      grantActive: Boolean(grant?.enabled && Date.parse(grant.expires_at) > Date.now()),
      bridge: capabilities?.ok ? capabilities.data : { error: capabilities?.error ?? 'not probed' },
      receiptCount: this.listReceipts(200).length,
      evidenceState: !this.isSupported() ? 'UNAVAILABLE' : capabilities?.ok ? 'OBSERVED' : 'DEGRADED',
    };
  }
}
