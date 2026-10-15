import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizeSkillManifest, normalizeProcedure } from './contracts.mjs';

export class SkillCompiler {
  constructor({ skillsRoot }) {
    this.skillsRoot = path.resolve(skillsRoot);
    fs.mkdirSync(this.skillsRoot, { recursive: true });
  }

  compileFromTrajectories({ id, name, description, intents = [], tags = [], substrates = [], trajectories = [], version = '0.1.0' }) {
    const successful = trajectories.filter(t => t && t.success === true && Array.isArray(t.actions) && t.actions.length);
    if (successful.length < 2) throw new Error('SKILL_COMPILER_REQUIRES_TWO_SUCCESSFUL_TRAJECTORIES');

    const groups = new Map();
    for (const trajectory of successful) {
      const signature = trajectory.actions.map(actionIdentity).join('>');
      const list = groups.get(signature) || [];
      list.push(trajectory);
      groups.set(signature, list);
    }
    const stable = [...groups.values()].sort((a, b) => b.length - a.length)[0];
    if (!stable || stable.length < 2) throw new Error('SKILL_COMPILER_NO_STABLE_PROCEDURE');

    const inputSchema = { type: 'object', properties: {}, additionalProperties: true };
    const steps = stable[0].actions.map((action, index) => {
      const kind = String(action.kind || action.type || '');
      if (!['tool', 'script'].includes(kind)) throw new Error('SKILL_COMPILER_UNSUPPORTED_ACTION:' + kind);
      const variants = stable.map(t => t.actions[index]?.args ?? t.actions[index]?.input ?? {});
      const parameterized = parameterizeObject(variants, 'step_' + (index + 1), inputSchema.properties);
      return {
        id: 'step_' + (index + 1),
        kind,
        ...(kind === 'tool' ? { tool: String(action.tool || action.name || '') } : { script: String(action.script || action.name || '') }),
        args: parameterized,
      };
    });
    steps.push({ id: 'result', kind: 'return', value: '$steps.step_' + stable[0].actions.length });

    const evidenceRefs = [...new Set(stable.flatMap(t => Array.isArray(t.evidenceRefs) ? t.evidenceRefs.map(String) : []))];
    const manifest = normalizeSkillManifest({
      id,
      version,
      name,
      description,
      status: 'CANDIDATE',
      intents,
      tags,
      substrates,
      dependencies: [],
      entrypoints: { main: 'procedures/main.json' },
      inputSchema,
      outputSchema: { type: 'object', additionalProperties: true },
      provenance: {
        compiler: 'jaco-skill-compiler-v1',
        sourceTrajectoryCount: stable.length,
        evidenceRefs,
        signature: sha256(stable[0].actions.map(actionIdentity).join('>')),
      },
    });
    const procedure = normalizeProcedure({ schema: 'jaco.skill.procedure.v1', id: 'main', description, steps });
    this.writePackage(manifest, procedure, renderInstructions(manifest));
    return { manifest, procedure, sourceTrajectoryCount: stable.length };
  }

  writePackage(manifest, procedure, instructions) {
    const target = path.join(this.skillsRoot, manifest.id);
    const temporary = target + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
    fs.rmSync(temporary, { recursive: true, force: true });
    fs.mkdirSync(path.join(temporary, 'procedures'), { recursive: true });
    fs.writeFileSync(path.join(temporary, 'skill.json'), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(temporary, 'SKILL.md'), instructions);
    fs.writeFileSync(path.join(temporary, 'procedures', 'main.json'), JSON.stringify(procedure, null, 2));
    if (fs.existsSync(target)) {
      const backup = target + '.previous';
      fs.rmSync(backup, { recursive: true, force: true });
      fs.renameSync(target, backup);
      try {
        fs.renameSync(temporary, target);
        fs.rmSync(backup, { recursive: true, force: true });
      } catch (error) {
        if (!fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target);
        throw error;
      }
    } else {
      fs.renameSync(temporary, target);
    }
    return target;
  }
}

function actionIdentity(action) {
  const kind = String(action.kind || action.type || '');
  const target = String(action.tool || action.script || action.name || '');
  return kind + ':' + target;
}

function parameterizeObject(variants, prefix, properties) {
  const first = variants[0];
  if (Array.isArray(first)) {
    return first.map((_, i) => parameterizeObject(variants.map(v => Array.isArray(v) ? v[i] : undefined), prefix + '_' + i, properties));
  }
  if (first && typeof first === 'object') {
    const keys = [...new Set(variants.flatMap(v => v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v) : []))];
    return Object.fromEntries(keys.map(key => [key, parameterizeObject(variants.map(v => v && typeof v === 'object' ? v[key] : undefined), prefix + '_' + key, properties)]));
  }
  if (variants.every(v => JSON.stringify(v) === JSON.stringify(first))) return first;
  const key = prefix.replace(/[^a-zA-Z0-9_]/g, '_');
  properties[key] = inferSchema(variants);
  return '$input.' + key;
}

function inferSchema(values) {
  const nonNull = values.find(v => v !== null && v !== undefined);
  const type = Array.isArray(nonNull) ? 'array' : typeof nonNull;
  return { type: type === 'number' || type === 'boolean' || type === 'string' || type === 'array' || type === 'object' ? type : 'string' };
}

function renderInstructions(manifest) {
  return '# ' + manifest.name + '\n\n' + manifest.description + '\n\n## Intents\n\n' + manifest.intents.map(v => '- ' + v).join('\n') + '\n\n## Runtime\n\nThis package is executed by the JACO Skill Runtime. Load this document only after metadata retrieval selects the skill.\n';
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}
