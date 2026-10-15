import crypto from 'node:crypto';
import { fingerprintIR, normalizeSkillIR } from './skillIR.mjs';

export function specializeSkillIR(irInput, { inputBindings = {}, environmentBindings = {}, label = null } = {}) {
  const ir = normalizeSkillIR(irInput);
  const bindings = {
    input: structuredClone(inputBindings || {}),
    environment: structuredClone(environmentBindings || {}),
  };

  const operations = ir.operations.map(operation => ({
    ...operation,
    target: substitute(operation.target, bindings),
    input: substitute(operation.input, bindings),
    constraints: substitute(operation.constraints, bindings),
    metadata: {
      ...operation.metadata,
      partiallyEvaluated: true,
    },
  }));

  const bindingHash = crypto.createHash('sha256').update(JSON.stringify(bindings)).digest('hex').slice(0, 16);
  return normalizeSkillIR({
    ...ir,
    id: ir.id + '.specialized.' + bindingHash,
    operations,
    metadata: {
      ...ir.metadata,
      specialization: {
        sourceIrId: ir.id,
        sourceIrFingerprint: fingerprintIR(ir),
        bindingHash,
        label,
        frozenInputKeys: Object.keys(bindings.input).sort(),
        frozenEnvironmentKeys: Object.keys(bindings.environment).sort(),
      },
    },
  });
}

function substitute(value, bindings) {
  if (Array.isArray(value)) return value.map(item => substitute(item, bindings));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, bindings)]));
  if (typeof value !== 'string' || !value.startsWith('$')) return value;

  const parts = value.slice(1).split('.').filter(Boolean);
  const root = parts.shift();
  if (!['input', 'environment'].includes(root)) return value;
  let cursor = bindings[root];
  for (const part of parts) {
    if (cursor === null || cursor === undefined || !Object.prototype.hasOwnProperty.call(Object(cursor), part)) return value;
    cursor = cursor[part];
  }
  return structuredClone(cursor);
}
