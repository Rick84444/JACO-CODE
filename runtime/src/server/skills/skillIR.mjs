import crypto from 'node:crypto';

export const SKILL_IR_SCHEMA = 'jaco.skill.ir.v1';
export const SKILL_ISA = Object.freeze([
  'OBSERVE', 'LOCATE', 'READ', 'WRITE', 'ACTIVATE', 'TRANSFORM',
  'EXECUTE', 'WAIT', 'ASSERT', 'COMPARE', 'SELECT', 'CALL', 'RETURN', 'RECOVER',
]);

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export function normalizeSkillIR(input = {}) {
  const id = String(input.id || '').trim();
  if (!ID_RE.test(id)) throw new Error('SKILL_IR_INVALID_ID');
  const version = String(input.version || '1.0.0');
  const operations = Array.isArray(input.operations) ? input.operations : [];
  if (!operations.length) throw new Error('SKILL_IR_OPERATIONS_REQUIRED');

  const seen = new Set();
  const normalized = operations.map((operation, index) => {
    if (!operation || typeof operation !== 'object') throw new Error('SKILL_IR_INVALID_OPERATION');
    const op = String(operation.op || '').toUpperCase();
    if (!SKILL_ISA.includes(op)) throw new Error('SKILL_IR_UNSUPPORTED_OPCODE:' + op);
    const operationId = String(operation.id || ('op_' + (index + 1))).trim();
    if (!ID_RE.test(operationId)) throw new Error('SKILL_IR_INVALID_OPERATION_ID');
    if (seen.has(operationId)) throw new Error('SKILL_IR_DUPLICATE_OPERATION_ID:' + operationId);
    seen.add(operationId);
    return Object.freeze({
      id: operationId,
      op,
      target: operation.target ?? null,
      input: operation.input ?? {},
      output: operation.output ?? null,
      constraints: operation.constraints && typeof operation.constraints === 'object' ? operation.constraints : {},
      requires: uniqueStrings(operation.requires),
      prefers: uniqueStrings(operation.prefers),
      metadata: operation.metadata && typeof operation.metadata === 'object' ? operation.metadata : {},
    });
  });

  return Object.freeze({
    schema: SKILL_IR_SCHEMA,
    id,
    version,
    goal: String(input.goal || ''),
    operations: Object.freeze(normalized),
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
  });
}

export function fingerprintEnvironment(environment = {}) {
  return crypto.createHash('sha256').update(canonical(environment)).digest('hex');
}

export function fingerprintIR(ir) {
  const normalized = normalizeSkillIR(ir);
  return crypto.createHash('sha256').update(canonical(normalized)).digest('hex');
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(v => String(v).trim()).filter(Boolean))];
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}
