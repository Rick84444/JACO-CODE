import path from 'node:path';

export const SKILL_MANIFEST_SCHEMA = 'jaco.skill.v1';
export const SKILL_PROCEDURE_SCHEMA = 'jaco.skill.procedure.v1';
export const SKILL_STATES = Object.freeze(['CANDIDATE', 'ACTIVE', 'DEGRADED', 'RETIRED']);

const ID_RE = /^[a-z0-9][a-z0-9._-]{1,95}$/;
const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.-]+)?$/;

function asStrings(value, limit = 128) {
  return [...new Set((Array.isArray(value) ? value : []).map(v => String(v).trim()).filter(Boolean))].slice(0, limit);
}

export function normalizeSkillManifest(input = {}, source = 'memory') {
  const id = String(input.id || '').trim().toLowerCase();
  if (!ID_RE.test(id)) throw new Error('SKILL_INVALID_ID');
  const version = String(input.version || '0.1.0').trim();
  if (!VERSION_RE.test(version)) throw new Error('SKILL_INVALID_VERSION');
  const name = String(input.name || '').trim();
  if (name.length < 2 || name.length > 160) throw new Error('SKILL_INVALID_NAME');
  const description = String(input.description || '').trim();
  if (description.length < 8 || description.length > 4000) throw new Error('SKILL_INVALID_DESCRIPTION');

  const status = String(input.status || 'CANDIDATE').toUpperCase();
  if (!SKILL_STATES.includes(status)) throw new Error('SKILL_INVALID_STATUS');

  const entrypoints = input.entrypoints && typeof input.entrypoints === 'object' ? { ...input.entrypoints } : {};
  if (!entrypoints.main) throw new Error('SKILL_MAIN_ENTRYPOINT_REQUIRED');
  for (const [key, value] of Object.entries(entrypoints)) {
    if (!key || typeof value !== 'string' || path.isAbsolute(value) || value.includes('..')) throw new Error('SKILL_INVALID_ENTRYPOINT');
  }

  const dependencies = asStrings(input.dependencies, 64);
  if (dependencies.includes(id)) throw new Error('SKILL_SELF_DEPENDENCY');

  return Object.freeze({
    schema: SKILL_MANIFEST_SCHEMA,
    id,
    version,
    name,
    description,
    status,
    intents: asStrings(input.intents, 64),
    tags: asStrings(input.tags, 64),
    substrates: asStrings(input.substrates, 32),
    dependencies,
    entrypoints: Object.freeze(entrypoints),
    inputSchema: input.inputSchema && typeof input.inputSchema === 'object' ? input.inputSchema : { type: 'object', additionalProperties: true },
    outputSchema: input.outputSchema && typeof input.outputSchema === 'object' ? input.outputSchema : { type: 'object', additionalProperties: true },
    provenance: input.provenance && typeof input.provenance === 'object' ? input.provenance : {},
    metrics: input.metrics && typeof input.metrics === 'object' ? input.metrics : {},
    source,
  });
}

export function normalizeProcedure(input = {}, source = 'memory') {
  if (String(input.schema || SKILL_PROCEDURE_SCHEMA) !== SKILL_PROCEDURE_SCHEMA) throw new Error('SKILL_PROCEDURE_SCHEMA_UNSUPPORTED');
  const steps = Array.isArray(input.steps) ? input.steps : [];
  if (!steps.length) throw new Error('SKILL_PROCEDURE_STEPS_REQUIRED');
  const ids = new Set();
  const normalized = steps.map((step, index) => {
    if (!step || typeof step !== 'object') throw new Error('SKILL_INVALID_STEP');
    const id = String(step.id || ('step_' + (index + 1))).trim();
    if (!ID_RE.test(id.replaceAll(':', '_'))) throw new Error('SKILL_INVALID_STEP_ID');
    if (ids.has(id)) throw new Error('SKILL_DUPLICATE_STEP_ID');
    ids.add(id);
    const kind = String(step.kind || '').trim();
    if (!['tool', 'script', 'model', 'skill', 'assert', 'return'].includes(kind)) throw new Error('SKILL_UNSUPPORTED_STEP_KIND');
    return Object.freeze({ ...step, id, kind });
  });
  return Object.freeze({
    schema: SKILL_PROCEDURE_SCHEMA,
    id: String(input.id || 'main'),
    description: String(input.description || ''),
    steps: Object.freeze(normalized),
    source,
  });
}

export function tokeniseSkillText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}._-]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function assertInside(base, candidate) {
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(candidate);
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) throw new Error('SKILL_PATH_ESCAPE');
  return resolved;
}
