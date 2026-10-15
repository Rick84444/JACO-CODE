import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { requestNativeEngine } from '../nativeEngine/nativeEngineClient.js';

export type HandsOffActionType = 'observe_screen' | 'open_app' | 'run_intent' | 'tap' | 'type_text' | 'scroll' | 'back' | 'home';

export interface HandsOffSelector {
  view_id?: string;
  text?: string;
  content_description?: string;
  class_name?: string;
  editable?: boolean;
}

export interface HandsOffAction {
  action_id?: string;
  type: HandsOffActionType;
  package_name?: string;
  selector?: HandsOffSelector;
  x?: number;
  y?: number;
  text?: string;
  direction?: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
  intent_action?: string;
  intent_uri?: string;
  wait_after_ms?: number;
}

export interface HandsOffGrant {
  enabled: boolean;
  allowed_packages: string[];
  allow_typing: boolean;
  allow_gestures: boolean;
  allow_navigation: boolean;
  expires_at: string;
}

export interface HandsOffReceipt {
  action_id: string;
  action_type: HandsOffActionType;
  started_at: string;
  finished_at: string;
  success: boolean;
  verified: boolean;
  before_hash: string | null;
  after_hash: string | null;
  package_name: string | null;
  result: unknown;
  error?: string;
}

function hashSnapshot(snapshot: unknown): string {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') {
      const output: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))) {
        if (['captured_at', 'completed_at', 'started_at', 'finished_at', 'timestamp'].includes(key)) continue;
        output[key] = normalize(item);
      }
      return output;
    }
    return value;
  };
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(normalize(snapshot))).digest('hex')}`;
}

export class HandsOffClient {
  private ledgerPath: string;

  constructor(workspaceRoot: string) {
    const root = path.join(workspaceRoot, '.jaco', 'state', 'hands-off');
    fs.mkdirSync(root, { recursive: true });
    this.ledgerPath = path.join(root, 'action-ledger.jsonl');
  }

  async status(): Promise<Record<string, unknown>> {
    return requestNativeEngine('hands_off.status');
  }

  async configureGrant(grant: HandsOffGrant): Promise<Record<string, unknown>> {
    if (!grant.enabled) return requestNativeEngine('hands_off.configure', { grant: { ...grant, enabled: false } });
    if (!Array.isArray(grant.allowed_packages) || grant.allowed_packages.length === 0 || grant.allowed_packages.length > 10) throw new Error('allowed_packages must contain 1-10 Android package names');
    if (grant.allowed_packages.some((packageName) => !/^[A-Za-z0-9_.]{3,200}$/.test(packageName))) throw new Error('allowed_packages contains an invalid Android package name');
    const expiry = Date.parse(grant.expires_at);
    if (expiry <= Date.now()) throw new Error('hands-off grant has already expired');
    if (expiry > Date.now() + 24 * 60 * 60_000) throw new Error('hands-off grant cannot exceed 24 hours');
    return requestNativeEngine('hands_off.configure', { grant });
  }

  async observe(): Promise<Record<string, unknown>> {
    const envelope = await requestNativeEngine<Record<string, unknown>>('hands_off.action', {
      action: { action_id: crypto.randomUUID(), type: 'observe_screen' },
    });
    const result = envelope.result;
    return result && typeof result === 'object' && !Array.isArray(result)
      ? result as Record<string, unknown>
      : envelope;
  }

  async executeVerified(action: HandsOffAction): Promise<HandsOffReceipt> {
    const actionId = action.action_id || crypto.randomUUID();
    const startedAt = new Date().toISOString();
    let before: Record<string, unknown> | null = null;
    let after: Record<string, unknown> | null = null;
    try {
      const navigationLaunch = action.type === 'open_app' || action.type === 'run_intent';
      if (!navigationLaunch) before = await this.observe();
      const result = await requestNativeEngine<Record<string, unknown>>('hands_off.action', {
        action: { ...action, action_id: actionId },
      });
      const waitMs = Math.max(250, Math.min(5_000, Number(action.wait_after_ms || 750)));
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      try { after = await this.observe(); } catch { after = null; }
      const beforeHash = before ? hashSnapshot(before) : null;
      const afterHash = after ? hashSnapshot(after) : null;
      const observedPackage = after && typeof after.package_name === 'string' ? after.package_name : null;
      const verified = action.type === 'observe_screen'
        || (navigationLaunch ? !!afterHash && (!action.package_name || observedPackage === action.package_name) : !!beforeHash && !!afterHash && beforeHash !== afterHash);
      const receipt: HandsOffReceipt = {
        action_id: actionId,
        action_type: action.type,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        success: result.success !== false,
        verified,
        before_hash: beforeHash,
        after_hash: afterHash,
        package_name: observedPackage,
        result,
      };
      this.appendReceipt(receipt);
      return receipt;
    } catch (error: any) {
      const receipt: HandsOffReceipt = {
        action_id: actionId,
        action_type: action.type,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        success: false,
        verified: false,
        before_hash: before ? hashSnapshot(before) : null,
        after_hash: after ? hashSnapshot(after) : null,
        package_name: null,
        result: null,
        error: String(error?.message || error),
      };
      this.appendReceipt(receipt);
      return receipt;
    }
  }

  listReceipts(limit = 50): HandsOffReceipt[] {
    try {
      if (!fs.existsSync(this.ledgerPath)) return [];
      return fs.readFileSync(this.ledgerPath, 'utf8').split('\n').filter(Boolean).slice(-Math.max(1, Math.min(limit, 200))).reverse().map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }

  private appendReceipt(receipt: HandsOffReceipt): void {
    fs.appendFileSync(this.ledgerPath, `${JSON.stringify(receipt)}\n`, { encoding: 'utf8', mode: 0o600 });
  }
}
