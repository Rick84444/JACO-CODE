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
  maxHours: number;
  maxWorkers: number;
  singleWriter: boolean;
  signedByOperator: boolean;
  signedAt: string | null;
  expiresAt: string;
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
    if (!fs.existsSync(this.file)) atomicWrite(this.file, []);
    this.ensureLevel5OperatorMandate();
  }

  private ensureLevel5OperatorMandate(): void {
    if (process.env.JACO_LEVEL5_AUTONOMY === '0') return;
    const all = this.list();
    const now = new Date();
    const existing = all.find((item) => item.id === 'operator-level5-default');
    // An operator revocation is final until the operator signs again: startup must not re-sign it.
    if (existing && existing.enabled === false) return;
    const mandate: AutonomyMandate = {
      id: 'operator-level5-default',
      name: 'Operator Level 5 Build Authority',
      mission: 'Build, test, debug, refactor, research, browse, operate tools, create skills/capabilities and ship JACO autonomously. Outgoing financial commitments require operator approval.',
      enabled: true,
      browserScope: 'BROAD_WEB',
      allowedOrigins: [],
      allowedDesktopProcesses: [],
      allowedAndroidPackages: [],
      // Keep operator edits to the decisions, but outgoing money can never become ALLOW here.
      decisions: { ...DEFAULT_DECISIONS, ...(existing?.decisions || {}), FINANCIAL: existing?.decisions?.FINANCIAL === 'DENY' ? 'DENY' : 'REVIEW' },
      requireSemanticVerificationFor: ['EXTERNAL_MUTATION', 'PUBLISH', 'DESTRUCTIVE'],
      maxHours: 8760,
      maxWorkers: 16,
      singleWriter: true,
      signedByOperator: true,
      signedAt: existing?.signedAt || now.toISOString(),
      // Keep the signed expiry; only a missing or lapsed mandate gets a fresh year.
      expiresAt: existing && Date.parse(existing.expiresAt) > now.getTime() ? existing.expiresAt : new Date(now.getTime() + 8760 * 3600_000).toISOString(),
      createdAt: existing?.createdAt || now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const next = [mandate, ...all.filter((item) => item.id !== mandate.id)].slice(0, 100);
    atomicWrite(this.file, next);
  }

  list(): AutonomyMandate[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
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
    const hours = Math.max(1, Math.min(8760, Number(input.maxHours || 8760)));
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
      decisions: { ...DEFAULT_DECISIONS, ...(input.decisions || {}) },
      requireSemanticVerificationFor: input.requireSemanticVerificationFor || ['EXTERNAL_MUTATION', 'PUBLISH', 'DESTRUCTIVE'],
      maxHours: hours,
      maxWorkers: Math.max(1, Math.min(16, Number(input.maxWorkers || 8))),
      // Single-writer is a runtime invariant, not a contract option.
      singleWriter: true,
      signedByOperator: false,
      signedAt: null,
      expiresAt: new Date(now.getTime() + hours * 3600_000).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    return this.save(mandate);
  }

  save(mandate: AutonomyMandate): AutonomyMandate {
    const all = this.list();
    const index = all.findIndex((item) => item.id === mandate.id);
    const next = { ...mandate, updatedAt: new Date().toISOString() };
    if (index >= 0) all[index] = next; else all.unshift(next);
    atomicWrite(this.file, all.slice(0, 100));
    return next;
  }

  sign(id: string): AutonomyMandate {
    const mandate = this.get(id);
    if (!mandate) throw new Error('autonomy mandate not found');
    mandate.enabled = true;
    mandate.signedByOperator = true;
    mandate.signedAt = new Date().toISOString();
    mandate.expiresAt = new Date(Date.now() + mandate.maxHours * 3600_000).toISOString();
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
    return Boolean(m?.enabled && m.signedByOperator && Date.parse(m.expiresAt) > Date.now());
  }

  evaluate(id: string | undefined, consequence: ConsequenceClass, semanticPostconditionPresent: boolean): {
    allowed: boolean; decision: MandateDecision; requireReview: boolean; requireSemanticVerification: boolean; reason: string; mandate: AutonomyMandate | null;
  } {
    const mandate = this.get(id);
    if (!mandate || !this.isActive(id)) {
      return { allowed: false, decision: 'DENY', requireReview: false, requireSemanticVerification: false, reason: 'active signed autonomy mandate required', mandate };
    }
    const decision = mandate.decisions[consequence] || 'DENY';
    const semanticRequired = mandate.requireSemanticVerificationFor.includes(consequence);
    if (decision === 'DENY') return { allowed: false, decision, requireReview: false, requireSemanticVerification: semanticRequired, reason: `${consequence} is denied by mandate`, mandate };
    if (decision === 'REVIEW') return { allowed: false, decision, requireReview: true, requireSemanticVerification: semanticRequired, reason: `${consequence} requires human review`, mandate };
    if (semanticRequired && !semanticPostconditionPresent) {
      return { allowed: false, decision, requireReview: false, requireSemanticVerification: true, reason: `${consequence} requires an explicit semantic postcondition`, mandate };
    }
    return { allowed: true, decision, requireReview: false, requireSemanticVerification: semanticRequired, reason: 'allowed by autonomy mandate', mandate };
  }
}
