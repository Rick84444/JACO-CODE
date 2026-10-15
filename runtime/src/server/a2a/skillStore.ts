import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { InstalledSkillPackage } from './a2aTypes.js';
import { A2AIdentityStore } from './identity.js';
import { SkillRegistry } from './skillRegistry.js';

/**
 * A2A skill store — hardened.
 *
 * This module keeps the exported surface the rest of the runtime already calls
 * (`calculateSha256`, `listInstalledSkills`, `installSkillPackage`,
 * `executeLocalSkill`) so `a2aExecutor.ts` and `server.ts` compile unchanged.
 * What changed is what happens underneath.
 *
 * ── What this replaces ───────────────────────────────────────────────────────
 * The previous implementation executed peer-supplied skill code with:
 *
 *     const wrappedFn = new Function('params', 'require', `${code} ...`);
 *
 * `new Function` compiles into the host realm. The accompanying `safeRequire`
 * allowlist was decoration: the guest already reached `process`, `globalThis`,
 * `fetch` and the real module loader directly. Combined with the unauthenticated
 * `POST /api/a2a/skills/install` route, any peer that could reach the runtime
 * could write code to disk and then execute it inside the server process, with
 * `process.env` — STRIPE_SECRET_KEY, GATEWAY_TOKEN, GEMINI_API_KEY — in scope.
 *
 * ── What happens now ─────────────────────────────────────────────────────────
 *  - install stages the package as UNVERIFIED and non-executable. Storing code
 *    is no longer the same act as authorising it.
 *  - execution runs on a worker thread inside a fresh `vm` context with no
 *    `require`, no `process`, no `fetch`, no timers, code generation disabled,
 *    and wall-clock, heap and output ceilings enforced from the parent.
 *  - a package only becomes executable when an operator promotes it, and code
 *    edited after promotion is quarantined at execution time on checksum drift.
 *
 * Callers see the same shapes. A skill that used to run on a peer's authority
 * now returns `success: false` with a message naming the promotion step — which
 * is the correct outcome, not a regression.
 */

// SKILLS_DIR must resolve against the same root SkillRegistry writes to.
// Using process.cwd() here made codePath and manifestPath report two different
// trees whenever JACO_WORKSPACE_ROOT was set — which is exactly the Termux case.
function skillsDir(): string {
  return path.join(workspaceRoot(), '.jaco', 'skills');
}

function workspaceRoot(): string {
  return process.env.JACO_WORKSPACE_ROOT || process.env.JACO_RELEASE_ROOT || process.cwd();
}

let cachedRegistry: SkillRegistry | null = null;
function registry(): SkillRegistry {
  if (!cachedRegistry) {
    const root = workspaceRoot();
    cachedRegistry = new SkillRegistry(root, new A2AIdentityStore(root));
  }
  return cachedRegistry;
}

export function calculateSha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export function listInstalledSkills(): InstalledSkillPackage[] {
  const packages = registry().listPackages();
  return packages.map((entry) => ({
    id: entry.id,
    name: entry.id,
    version: entry.version,
    description: entry.trust === 'OPERATOR_APPROVED'
      ? 'Operator-approved skill package.'
      : `Skill package is ${entry.trust} and will not execute until an operator promotes it.`,
    authorNodeId: entry.authorNodeId,
    codePath: path.join(skillsDir(), entry.id, 'index.js'),
    manifestPath: path.join(workspaceRoot(), '.jaco', 'a2a_skill_registry.json'),
    checksum: entry.checksum,
    installedAt: entry.installedAt,
    // `enabled` has always meant "will this run". Only a promoted package will.
    enabled: entry.trust === 'OPERATOR_APPROVED',
  }));
}

export function installSkillPackage(params: {
  id: string;
  name: string;
  version: string;
  description: string;
  code: string;
  authorNodeId: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  tags?: string[];
}): { success: boolean; skill?: InstalledSkillPackage; error?: string; trust?: string; note?: string } {
  try {
    const staged = registry().stagePackage({
      id: params.id,
      version: params.version,
      code: params.code,
      authorNodeId: params.authorNodeId,
    });

    // The listing is the marketplace-visible offer; it carries no execution right.
    try {
      registry().publishListing({
        id: staged.id,
        name: params.name,
        description: params.description,
        priceUsdc: 0,
        protocol: 'A2A v1.0',
      });
    } catch {
      /* a listing collision must not fail the staging itself */
    }

    return {
      success: true,
      trust: staged.trust,
      note: 'Stored disabled. The package cannot execute until an operator promotes it.',
      skill: {
        id: staged.id,
        name: params.name,
        version: staged.version,
        description: params.description,
        authorNodeId: staged.authorNodeId,
        codePath: path.join(skillsDir(), staged.id, 'index.js'),
        manifestPath: path.join(workspaceRoot(), '.jaco', 'a2a_skill_registry.json'),
        checksum: staged.checksum,
        installedAt: staged.installedAt,
        enabled: false,
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function executeLocalSkill(
  skillId: string,
  parameters: Record<string, unknown>,
): Promise<{ success: boolean; result?: unknown; error?: string; checksum: string; executionTimeMs: number }> {
  const outcome = await registry().execute(skillId, parameters ?? {});
  return {
    success: outcome.success,
    result: outcome.result,
    error: outcome.error,
    checksum: outcome.checksum,
    executionTimeMs: outcome.executionTimeMs,
  };
}

/** Operator promotion. The only transition that makes staged peer code runnable. */
export function promoteSkillPackage(skillId: string, operator: string) {
  return registry().promotePackage(skillId, operator);
}

/** Marks a package unrunnable without deleting the evidence of what it was. */
export function quarantineSkillPackage(skillId: string, reason: string) {
  return registry().quarantinePackage(skillId, reason);
}

export function skillsDirectory(): string {
  return skillsDir();
}

/** Kept for callers that probed the directory directly. */
export function ensureSkillsDir(): void {
  fs.mkdirSync(skillsDir(), { recursive: true });
}
