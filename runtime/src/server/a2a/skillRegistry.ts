import fs from 'node:fs';
import path from 'node:path';
import { A2AIdentityStore, canonicalJson } from './identity.js';
import { analyseSkillSource, runSkillInSandbox, sha256Hex, type SandboxOutcome } from './skillSandbox.js';

/**
 * A2A skill catalogue and package registry.
 *
 * Two things the archived prototype conflated are separated here:
 *
 *  1. A *listing* — what the A2A Workflow Dashboard publishes: an id, a name, a
 *     price and a protocol. A listing is an offer. It carries no code and can
 *     never execute anything.
 *  2. A *package* — executable skill code. A package arrives with a checksum,
 *     is stored disabled, and stays `UNVERIFIED` until an operator promotes it.
 *     Nothing a peer uploads becomes runnable on its own authority.
 *
 * The prototype installed peer code straight to `.jaco/skills/<id>/index.js` and
 * executed it on the next call. That is the path this registry closes.
 */

export type SkillTrust = 'BUILTIN' | 'OPERATOR_APPROVED' | 'UNVERIFIED' | 'QUARANTINED';

export interface SkillListing {
  id: string;
  name: string;
  description: string;
  priceUsdc: number;
  protocol: string;
  publisherNodeId: string;
  publishedAt: string;
  listingSignature: string;
  executable: boolean;
  trust: SkillTrust;
}

export interface SkillPackage {
  id: string;
  version: string;
  checksum: string;
  authorNodeId: string;
  trust: SkillTrust;
  staticFindings: string[];
  installedAt: string;
  promotedAt?: string;
  promotedBy?: string;
  quarantineReason?: string;
}

interface RegistryFile {
  listings: SkillListing[];
  packages: SkillPackage[];
}

const MAX_LISTINGS = 500;
const MAX_CODE_BYTES = 256_000;
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;

export interface BuiltinSkill {
  id: string;
  name: string;
  description: string;
  priceUsdc: number;
  run: (params: Record<string, unknown>) => unknown;
}

/**
 * Built-ins are first-party code compiled into the release, so they run in
 * process rather than in the guest sandbox. They are deliberately pure: no file
 * system, no network, no process access.
 */
const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    id: 'code-review-audit',
    name: 'Automated Code Audit',
    description: 'Static review of submitted source for unsafe execution, gate bypass and credential handling defects.',
    priceUsdc: 0,
    run: (params) => {
      const code = String((params as { code?: unknown }).code ?? '');
      if (!code) throw new Error('code parameter is required');
      const findings: string[] = [];
      if (/\beval\s*\(/.test(code)) findings.push('unsafe eval() call');
      if (/new\s+Function\s*\(/.test(code)) findings.push('dynamic Function constructor');
      if (/autoApprove\s*:\s*true/.test(code)) findings.push('autoApprove bypasses the approval gate');
      if (/process\.env/.test(code)) findings.push('reads process.env directly');
      if (/child_process/.test(code)) findings.push('spawns child processes');
      for (const finding of analyseSkillSource(code)) findings.push(`sandbox indicator: ${finding}`);
      const unique = [...new Set(findings)];
      return {
        issues: unique,
        score: unique.length === 0 ? 100 : Math.max(10, 100 - unique.length * 20),
        summary: unique.length === 0 ? 'No defect pattern matched in the submitted source.' : `${unique.length} defect pattern(s) matched.`,
        evidenceState: 'OBSERVED',
      };
    },
  },
  {
    id: 'adversarial-falsifier',
    name: 'Adversarial Decision Falsifier',
    description: 'Stress-tests a proposal by enumerating the assumptions that would have to hold for it to succeed.',
    priceUsdc: 0,
    run: (params) => {
      const proposal = String((params as { proposal?: unknown }).proposal ?? '').trim();
      if (!proposal) throw new Error('proposal parameter is required');
      const criticism: string[] = [];
      if (!/\b(because|since|given|based on)\b/i.test(proposal)) criticism.push('No stated justification: the proposal asserts an outcome without a mechanism.');
      if (!/\b\d/.test(proposal)) criticism.push('No quantity, threshold or deadline is present, so the claim cannot be falsified.');
      if (/\b(always|never|guaranteed|impossible)\b/i.test(proposal)) criticism.push('Absolute language: a single counterexample refutes the whole proposal.');
      if (proposal.length < 40) criticism.push('Too little detail to identify a failure mode.');
      return {
        survives: criticism.length === 0,
        criticism,
        testedAssumptions: criticism.length || 1,
        evidenceState: 'OBSERVED',
      };
    },
  },
];

export class SkillRegistry {
  private readonly registryFile: string;
  private readonly packagesDir: string;

  constructor(private readonly workspaceRoot: string, private readonly identity: A2AIdentityStore) {
    this.registryFile = path.join(workspaceRoot, '.jaco', 'a2a_skill_registry.json');
    this.packagesDir = path.join(workspaceRoot, '.jaco', 'skills');
  }

  private read(): RegistryFile {
    try {
      const raw = fs.readFileSync(this.registryFile, 'utf8');
      const parsed = JSON.parse(raw) as Partial<RegistryFile>;
      return {
        listings: Array.isArray(parsed.listings) ? parsed.listings : [],
        packages: Array.isArray(parsed.packages) ? parsed.packages : [],
      };
    } catch {
      return { listings: [], packages: [] };
    }
  }

  private write(data: RegistryFile): void {
    fs.mkdirSync(path.dirname(this.registryFile), { recursive: true });
    const temporary = `${this.registryFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, this.registryFile);
  }

  public listBuiltins(): BuiltinSkill[] {
    return BUILTIN_SKILLS;
  }

  public listListings(): SkillListing[] {
    const stored = this.read().listings;
    const builtinListings: SkillListing[] = BUILTIN_SKILLS.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      priceUsdc: skill.priceUsdc,
      protocol: 'A2A v1.0 / JSON-RPC',
      publisherNodeId: this.identity.get().nodeId,
      publishedAt: 'release',
      listingSignature: 'builtin',
      executable: true,
      trust: 'BUILTIN',
    }));
    return [...builtinListings, ...stored];
  }

  public listPackages(): SkillPackage[] {
    return this.read().packages;
  }

  /**
   * Publishes a marketplace listing. This is an offer, not code: nothing here
   * can be executed, which is why it needs no approval gate.
   */
  public publishListing(input: {
    id: unknown;
    name: unknown;
    description?: unknown;
    priceUsdc?: unknown;
    protocol?: unknown;
  }): SkillListing {
    const id = String(input.id ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    if (!ID_PATTERN.test(id)) throw new Error('skill id must be 2-64 characters of a-z, 0-9, underscore or hyphen');
    if (BUILTIN_SKILLS.some((skill) => skill.id === id)) throw new Error(`skill id '${id}' is reserved by a built-in capability`);

    const name = String(input.name ?? '').trim();
    if (name.length < 2 || name.length > 200) throw new Error('skill name must be 2-200 characters');

    const description = String(input.description ?? '').trim().slice(0, 2_000);

    const priceRaw = Number(input.priceUsdc ?? 0);
    if (!Number.isFinite(priceRaw) || priceRaw < 0 || priceRaw > 1_000_000) throw new Error('priceUsdc must be a finite value between 0 and 1000000');
    const priceUsdc = Math.round(priceRaw * 100) / 100;

    const protocol = String(input.protocol ?? 'A2A v1.0').trim().slice(0, 120);

    const data = this.read();
    if (data.listings.length >= MAX_LISTINGS && !data.listings.some((listing) => listing.id === id)) {
      throw new Error(`listing registry is full (${MAX_LISTINGS}); retire a listing before publishing another`);
    }

    const publisherNodeId = this.identity.get().nodeId;
    const publishedAt = new Date().toISOString();
    const core = { id, name, description, priceUsdc, protocol, publisherNodeId, publishedAt };
    const listing: SkillListing = {
      ...core,
      listingSignature: this.identity.signDetached(core).signature,
      // A listing is executable only when a promoted package or built-in backs it.
      executable: data.packages.some((pkg) => pkg.id === id && pkg.trust === 'OPERATOR_APPROVED'),
      trust: data.packages.find((pkg) => pkg.id === id)?.trust ?? 'UNVERIFIED',
    };

    data.listings = [listing, ...data.listings.filter((entry) => entry.id !== id)].slice(0, MAX_LISTINGS);
    this.write(data);
    return listing;
  }

  public retireListing(id: string): boolean {
    const data = this.read();
    const before = data.listings.length;
    data.listings = data.listings.filter((listing) => listing.id !== id);
    if (data.listings.length === before) return false;
    this.write(data);
    return true;
  }

  /**
   * Stores executable skill code. Always lands disabled and UNVERIFIED — the
   * package cannot run until promote() is called by an authenticated operator.
   */
  public stagePackage(input: { id: string; version?: string; code: string; authorNodeId: string }): SkillPackage {
    const id = String(input.id || '').trim().toLowerCase();
    if (!ID_PATTERN.test(id)) throw new Error('skill id must be 2-64 characters of a-z, 0-9, underscore or hyphen');
    if (BUILTIN_SKILLS.some((skill) => skill.id === id)) throw new Error(`skill id '${id}' is reserved by a built-in capability`);

    const code = String(input.code || '');
    if (!code.trim()) throw new Error('skill code is required');
    if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) throw new Error(`skill code exceeds ${MAX_CODE_BYTES} bytes`);
    if (code.includes('\0')) throw new Error('skill code contains a null byte');

    const folder = path.join(this.packagesDir, id);
    fs.mkdirSync(folder, { recursive: true });
    const codePath = path.join(folder, 'index.js');
    fs.writeFileSync(codePath, code, { encoding: 'utf8', mode: 0o600 });

    const record: SkillPackage = {
      id,
      version: String(input.version || '1.0.0').slice(0, 32),
      checksum: sha256Hex(code),
      authorNodeId: String(input.authorNodeId || 'unknown').slice(0, 128),
      trust: 'UNVERIFIED',
      staticFindings: analyseSkillSource(code),
      installedAt: new Date().toISOString(),
    };

    const data = this.read();
    data.packages = [record, ...data.packages.filter((pkg) => pkg.id !== id)];
    this.write(data);
    return record;
  }

  /** Operator promotion. The only transition that makes peer code executable. */
  public promotePackage(id: string, operator: string): SkillPackage {
    const data = this.read();
    const pkg = data.packages.find((entry) => entry.id === id);
    if (!pkg) throw new Error(`skill package '${id}' is not staged`);
    if (pkg.trust === 'QUARANTINED') throw new Error(`skill package '${id}' is quarantined and cannot be promoted`);

    const codePath = path.join(this.packagesDir, id, 'index.js');
    if (!fs.existsSync(codePath)) throw new Error(`skill package '${id}' has no stored code`);
    const actual = sha256Hex(fs.readFileSync(codePath, 'utf8'));
    if (actual !== pkg.checksum) throw new Error(`skill package '${id}' failed checksum verification; refusing to promote`);

    pkg.trust = 'OPERATOR_APPROVED';
    pkg.promotedAt = new Date().toISOString();
    pkg.promotedBy = String(operator || 'Operator').slice(0, 120);
    data.listings = data.listings.map((listing) => (listing.id === id ? { ...listing, executable: true, trust: 'OPERATOR_APPROVED' } : listing));
    this.write(data);
    return pkg;
  }

  public quarantinePackage(id: string, reason: string): SkillPackage {
    const data = this.read();
    const pkg = data.packages.find((entry) => entry.id === id);
    if (!pkg) throw new Error(`skill package '${id}' is not staged`);
    pkg.trust = 'QUARANTINED';
    pkg.quarantineReason = String(reason || 'quarantined by operator').slice(0, 500);
    data.listings = data.listings.map((listing) => (listing.id === id ? { ...listing, executable: false, trust: 'QUARANTINED' } : listing));
    this.write(data);
    return pkg;
  }

  /**
   * Executes a skill. Built-ins run in process; packages run in the worker
   * sandbox and only when an operator has promoted them.
   */
  public async execute(skillId: string, params: Record<string, unknown>): Promise<SandboxOutcome> {
    const started = Date.now();
    const builtin = BUILTIN_SKILLS.find((skill) => skill.id === skillId);
    if (builtin) {
      try {
        const result = builtin.run(params);
        const serialised = JSON.stringify(result ?? null);
        return {
          success: true,
          result,
          executionTimeMs: Date.now() - started,
          checksum: sha256Hex(serialised),
          limits: { timeoutMs: 0, maxHeapMb: 0, maxOutputBytes: 0 },
          terminatedByLimit: false,
          staticFindings: [],
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          executionTimeMs: Date.now() - started,
          checksum: '',
          limits: { timeoutMs: 0, maxHeapMb: 0, maxOutputBytes: 0 },
          terminatedByLimit: false,
          staticFindings: [],
        };
      }
    }

    const pkg = this.read().packages.find((entry) => entry.id === skillId);
    if (!pkg) {
      return failure(`no capability with id '${skillId}' is available on this node`, started);
    }
    if (pkg.trust !== 'OPERATOR_APPROVED') {
      return failure(
        `skill '${skillId}' is ${pkg.trust}; an operator must promote it before it can execute`,
        started,
        pkg.staticFindings,
      );
    }

    const codePath = path.join(this.packagesDir, skillId, 'index.js');
    if (!fs.existsSync(codePath)) return failure(`skill '${skillId}' has no stored code`, started);

    const code = fs.readFileSync(codePath, 'utf8');
    if (sha256Hex(code) !== pkg.checksum) {
      // The code changed after promotion: quarantine rather than run it.
      this.quarantinePackage(skillId, 'checksum drift detected at execution time');
      return failure(`skill '${skillId}' failed checksum verification and was quarantined`, started);
    }

    return runSkillInSandbox(code, params);
  }

  /** Canonical signed capability list for the agent card. */
  public capabilityDescriptor(): Array<Record<string, unknown>> {
    return this.listListings().map((listing) => ({
      id: listing.id,
      name: listing.name,
      description: listing.description,
      priceUsdc: listing.priceUsdc,
      executable: listing.executable,
      trust: listing.trust,
    }));
  }

  public capabilityDigest(): string {
    return sha256Hex(canonicalJson(this.capabilityDescriptor()));
  }
}

function failure(message: string, started: number, staticFindings: string[] = []): SandboxOutcome {
  return {
    success: false,
    error: message,
    executionTimeMs: Date.now() - started,
    checksum: '',
    limits: { timeoutMs: 0, maxHeapMb: 0, maxOutputBytes: 0 },
    terminatedByLimit: false,
    staticFindings,
  };
}
