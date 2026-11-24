import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type ConsequenceClass = 'READ' | 'LOCAL_MUTATION' | 'EXTERNAL_MUTATION' | 'PUBLISH' | 'FINANCIAL' | 'AUTH' | 'SECURITY' | 'DESTRUCTIVE';
export type MandateDecision = 'ALLOW' | 'REVIEW' | 'DENY';

export interface AutonomyMandate {
  id: string;
  name: string;
  mission: string;
  enabled: boolean;
  browserScope: 'ORIGINS' | 'BROAD_WEB';
  allowedOrigins: string[];
  allowedDesktopProcesses: string[];
  allowedAndroidPackages: string[];
  decisions: Record<ConsequenceClass, MandateDecision>;
  requireSemanticVerificationFor: ConsequenceClass[];
  // Standing grants persist until an authenticated operator changes or revokes them.
  // Legacy records without validity retain their original timed expiration.
  validity?: 'STANDING' | 'TIMED';
  maxHours: number;
  maxWorkers: number;
  revision?: number;
  additionalRules?: string;
  singleWriter: boolean;
  signedByOperator: boolean;
  signedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Operator-approved Level-5 build profile: autonomous by default. The one
// mandatory human decision is an outgoing financial commitment. Verification,
// single-writer leases and secret redaction remain runtime invariants.
const DEFAULT_DECISIONS: Record<ConsequenceClass, MandateDecision> = {
  READ: 'ALLOW',
  LOCAL_MUTATION: 'ALLOW',
  EXTERNAL_MUTATION: 'ALLOW',
  PUBLISH: 'ALLOW',
  FINANCIAL: 'REVIEW',
  AUTH: 'ALLOW',
  SECURITY: 'ALLOW',
  DESTRUCTIVE: 'ALLOW',
};

// Surface leases are short-lived even when an operator mandate is standing.
// The relay refreshes them before each authorized action; no adapter needs an
// imaginary year-9999 deadline or becomes a second mandate authority.
export function actuatorGrantExpiry(mandate: Pick<AutonomyMandate, 'expiresAt'>, nowMs = Date.now()): string {
  return mandate.expiresAt ?? new Date(nowMs + 5 * 60_000).toISOString();
}

function atomicWrite(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

export class AutonomyMandateStore {
  private readonly file: string;

  constructor(workspaceRoot: string) {
    this.file = path.join(workspaceRoot, '.jaco', 'state', 'autonomy', 'mandates.json');
    const fresh = !fs.existsSync(this.file);
    if (fresh) atomicWrite(this.file, []);
    this.ensureLevel5OperatorMandate(fresh);
  }

  private ensureLevel5OperatorMandate(fresh: boolean): void {
    if (process.env.JACO_LEVEL5_AUTONOMY === '0') return;
    // Never regenerate authority from missing, corrupt, revoked or expired state.
    // Only an explicit first-install configuration may bootstrap a grant. Subsequent
    // signatures are operator actions; startup preserves all existing scope and expiry.
    let all: AutonomyMandate[];
    try { all = this.readStrict(); } catch { return; }
    const now = new Date();
    const marker = path.join(path.dirname(this.file), 'bootstrap-initialized');
    const configured = fresh && process.env.JACO_LEVEL5_AUTONOMY === '1' && !fs.existsSync(marker);
    if (!fs.existsSync(marker)) {
      try { fs.writeFileSync(marker, 'initialized\n', { flag: 'wx', mode: 0o600 }); }
      catch { return; }
    }
    if (all.some(item => item.id === 'operator-level5-default')) return;
    const mandate: AutonomyMandate = {
      id: 'operator-level5-default',
      name: 'Operator Level 5 Build Authority',
      mission: 'Build, test, debug, refactor, research, browse, operate tools, create skills/capabilities and ship JACO autonomously. Outgoing financial commitments require operator approval.',
      enabled: configured,
      browserScope: 'BROAD_WEB',
      allowedOrigins: [],
      allowedDesktopProcesses: [],
      allowedAndroidPackages: [],
      // Keep operator edits to the decisions, but outgoing money can never become ALLOW here.
      decisions: { ...DEFAULT_DECISIONS },
      requireSemanticVerificationFor: ['EXTERNAL_MUTATION', 'PUBLISH', 'DESTRUCTIVE'],
      validity: 'STANDING',
      maxHours: 8760,
      maxWorkers: 16,
      revision: 1,
      additionalRules: '',
      singleWriter: true,
      signedByOperator: configured,
      signedAt: configured ? now.toISOString() : null,
      expiresAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const next = [mandate, ...all.filter((item) => item.id !== mandate.id)].slice(0, 100);
    atomicWrite(this.file, next);
  }

  private readStrict(): AutonomyMandate[] {
    const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (!Array.isArray(parsed) || parsed.some(item => !item || typeof item.id !== 'string' || !item.decisions || !Array.isArray(item.requireSemanticVerificationFor)
      || (item.validity && !['STANDING', 'TIMED'].includes(item.validity))
      || (item.expiresAt === null && item.validity !== 'STANDING')
      || (item.expiresAt !== null && (typeof item.expiresAt !== 'string' || !Number.isFinite(Date.parse(item.expiresAt))))
      || (item.revision !== undefined && (!Number.isSafeInteger(item.revision) || item.revision < 1)))) throw new Error('MANDATE_STORE_INVALID');
    return parsed;
  }

  list(): AutonomyMandate[] {
    try { return this.readStrict(); } catch { return []; }
  }

  get(id: string | undefined): AutonomyMandate | null {
    if (!id) return null;
    return this.list().find((item) => item.id === id) || null;
  }

  create(input: Partial<AutonomyMandate> & { mission: string }): AutonomyMandate {
    const mission = String(input.mission || '').trim();
    if (mission.length < 5 || mission.length > 10_000) throw new Error('mission must be 5-10000 characters');
    // Level-5 operator authority is durable; individual missions remain bounded
    // by evidence, leases and target-specific execution contracts.
    if (input.validity !== undefined && !['STANDING', 'TIMED'].includes(input.validity)) throw new Error('MANDATE_VALIDITY_INVALID');
    // A new operator mandate is standing by default; an explicit duration remains timed.
    const validity = input.validity ?? (input.maxHours === undefined ? 'STANDING' : 'TIMED');
    const hours = Math.max(1, Math.min(8760, Number(input.maxHours ?? 8760)));
    const browserScope = input.browserScope === 'ORIGINS' ? 'ORIGINS' : 'BROAD_WEB';
    const allowedOrigins = Array.isArray(input.allowedOrigins) ? input.allowedOrigins.map(String).slice(0, 50) : [];
    if (browserScope === 'ORIGINS' && allowedOrigins.length === 0) throw new Error('ORIGINS browser scope requires at least one allowed origin');
    const now = new Date();
    const mandate: AutonomyMandate = {
      id: `mandate-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      name: String(input.name || 'Broad Build & Verify').trim().slice(0, 120),
      mission,
      enabled: false,
      browserScope,
      allowedOrigins,
      allowedDesktopProcesses: Array.isArray(input.allowedDesktopProcesses) ? input.allowedDesktopProcesses.map(String).slice(0, 10) : [],
      allowedAndroidPackages: Array.isArray(input.allowedAndroidPackages) ? input.allowedAndroidPackages.map(String).slice(0, 10) : [],
      decisions: { ...DEFAULT_DECISIONS, ...(input.decisions || {}), FINANCIAL: input.decisions?.FINANCIAL === 'DENY' ? 'DENY' : 'REVIEW' },
      requireSemanticVerificationFor: input.requireSemanticVerificationFor || ['EXTERNAL_MUTATION', 'PUBLISH', 'DESTRUCTIVE'],
      validity,
      maxHours: hours,
      revision: 1,
      additionalRules: String(input.additionalRules || '').slice(0, 4000),
      maxWorkers: Math.max(1, Math.min(16, Number(input.maxWorkers || 8))),
      // Single-writer is a runtime invariant, not a contract option.
      singleWriter: true,
      signedByOperator: false,
      signedAt: null,
      expiresAt: validity === 'STANDING' ? null : new Date(now.getTime() + hours * 3600_000).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    return this.save(mandate);
  }

  save(mandate: AutonomyMandate, expectedRevision?: number): AutonomyMandate {
    const all = this.readStrict();
    const index = all.findIndex((item) => item.id === mandate.id);
    const previous = index < 0 ? null : all[index];
    if (expectedRevision !== undefined && (previous?.revision ?? 1) !== expectedRevision) throw new Error('MANDATE_REVISION_CONFLICT');
    const next = { ...mandate, revision: previous ? (previous.revision ?? 1) + 1 : 1, updatedAt: new Date().toISOString() };
    if (index >= 0) all[index] = next; else all.unshift(next);
    atomicWrite(this.file, all.slice(0, 100));
    return next;
  }

  // This is the only writable operator-edit surface. Do not accept authority,
  // signature, revision, or expiry fields directly from an untrusted patch.
  updateOperator(id: string, patch: Record<string, unknown>, expectedRevision: number): AutonomyMandate {
    const current = this.get(id);
    if (!current) throw new Error('MANDATE_NOT_FOUND');
    if (!Number.isSafeInteger(expectedRevision) || (current.revision ?? 1) !== expectedRevision) throw new Error('MANDATE_REVISION_CONFLICT');
    const allowed = new Set(['name', 'browserScope', 'allowedOrigins', 'allowedDesktopProcesses', 'allowedAndroidPackages', 'decisions', 'validity', 'maxHours', 'maxWorkers', 'additionalRules']);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !allowed.has(key))) throw new Error('MANDATE_PATCH_FIELDS_INVALID');
    const next: AutonomyMandate = { ...current, decisions: { ...current.decisions } };
    if (patch.name !== undefined) {
      if (typeof patch.name !== 'string' || !patch.name.trim() || patch.name.length > 120) throw new Error('MANDATE_NAME_INVALID');
      next.name = patch.name.trim();
    }
    if (patch.browserScope !== undefined) {
      if (patch.browserScope !== 'ORIGINS' && patch.browserScope !== 'BROAD_WEB') throw new Error('MANDATE_BROWSER_SCOPE_INVALID');
      next.browserScope = patch.browserScope;
    }
    for (const field of ['allowedOrigins', 'allowedDesktopProcesses', 'allowedAndroidPackages'] as const) {
      const value = patch[field];
      if (value === undefined) continue;
      if (!Array.isArray(value) || value.length > 50 || value.some(v => typeof v !== 'string' || v.length > 500)) throw new Error('MANDATE_SCOPE_INVALID');
      next[field] = [...new Set(value.map(v => v.trim()).filter(Boolean))];
    }
    if (next.browserScope === 'ORIGINS' && !next.allowedOrigins.length) throw new Error('MANDATE_ORIGINS_REQUIRED');
    if (patch.decisions !== undefined) {
      const decisions = patch.decisions;
      if (!decisions || typeof decisions !== 'object' || Array.isArray(decisions)) throw new Error('MANDATE_DECISIONS_INVALID');
      for (const [key, value] of Object.entries(decisions)) {
        if (!Object.hasOwn(DEFAULT_DECISIONS, key) || !['ALLOW', 'REVIEW', 'DENY'].includes(String(value))) throw new Error('MANDATE_DECISIONS_INVALID');
        if (key === 'FINANCIAL' && value === 'ALLOW') throw new Error('MANDATE_FINANCIAL_REVIEW_REQUIRED');
        next.decisions[key as ConsequenceClass] = value as MandateDecision;
      }
    }
    if (patch.validity !== undefined) {
      if (patch.validity !== 'STANDING' && patch.validity !== 'TIMED') throw new Error('MANDATE_VALIDITY_INVALID');
      next.validity = patch.validity;
    }
    if (patch.maxHours !== undefined) {
      if (!Number.isSafeInteger(patch.maxHours) || (patch.maxHours as number) < 1 || (patch.maxHours as number) > 8760) throw new Error('MANDATE_HOURS_INVALID');
      next.maxHours = patch.maxHours as number;
    }
    if (patch.maxWorkers !== undefined) {
      if (!Number.isSafeInteger(patch.maxWorkers) || (patch.maxWorkers as number) < 1 || (patch.maxWorkers as number) > 16) throw new Error('MANDATE_WORKERS_INVALID');
      next.maxWorkers = patch.maxWorkers as number;
    }
    if (patch.additionalRules !== undefined) {
      if (typeof patch.additionalRules !== 'string' || patch.additionalRules.length > 4000) throw new Error('MANDATE_RULES_INVALID');
      next.additionalRules = patch.additionalRules;
    }
    // A standing grant never silently becomes timed, or the reverse, without an
    // operator patch explicitly selecting that validity mode.
    if (patch.validity !== undefined || patch.maxHours !== undefined) {
      next.expiresAt = next.validity === 'STANDING' ? null : new Date(Date.now() + next.maxHours * 3600_000).toISOString();
    }
    return this.save(next, expectedRevision);
  }

  sign(id: string): AutonomyMandate {
    const mandate = this.get(id);
    if (!mandate) throw new Error('autonomy mandate not found');
    mandate.enabled = true;
    mandate.signedByOperator = true;
    mandate.signedAt = new Date().toISOString();
    mandate.expiresAt = mandate.validity === 'STANDING' ? null : new Date(Date.now() + mandate.maxHours * 3600_000).toISOString();
    return this.save(mandate);
  }

  revoke(id: string): AutonomyMandate {
    const mandate = this.get(id);
    if (!mandate) throw new Error('autonomy mandate not found');
    mandate.enabled = false;
    return this.save(mandate);
  }

  isActive(id: string | undefined): boolean {
    const m = this.get(id);
    return Boolean(m?.enabled && m.signedByOperator && (
      (m.validity === 'STANDING' && m.expiresAt === null)
      || (typeof m.expiresAt === 'string' && Date.parse(m.expiresAt) > Date.now())
    ));
  }

  evaluate(id: string | undefined, consequence: ConsequenceClass, semanticPostconditionPresent: boolean): {
    allowed: boolean; decision: MandateDecision; requireReview: boolean; requireSemanticVerification: boolean; reason: string; mandate: AutonomyMandate | null;
  } {
    const mandate = this.get(id);
    if (!mandate || !this.isActive(id)) {
      return { allowed: false, decision: 'DENY', requireReview: false, requireSemanticVerification: false, reason: 'active signed autonomy mandate required', mandate };
    }
    const stored = mandate.decisions[consequence] || 'DENY';
    const decision = consequence === 'FINANCIAL' && stored !== 'DENY' ? 'REVIEW' : stored;
    const semanticRequired = mandate.requireSemanticVerificationFor.includes(consequence);
    if (decision === 'DENY') return { allowed: false, decision, requireReview: false, requireSemanticVerification: semanticRequired, reason: `${consequence} is denied by mandate`, mandate };
    if (decision === 'REVIEW') return { allowed: false, decision, requireReview: true, requireSemanticVerification: semanticRequired, reason: `${consequence} requires human review`, mandate };
    if (semanticRequired && !semanticPostconditionPresent) {
      return { allowed: false, decision, requireReview: false, requireSemanticVerification: true, reason: `${consequence} requires an explicit semantic postcondition`, mandate };
    }
    return { allowed: true, decision, requireReview: false, requireSemanticVerification: semanticRequired, reason: 'allowed by autonomy mandate', mandate };
  }
}
