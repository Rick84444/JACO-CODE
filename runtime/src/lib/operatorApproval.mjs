const POSITIVE_DECISIONS = new Set(['approve', 'confirm', 'resume']);

export function requiresOperatorConfirmation(decision) {
  return POSITIVE_DECISIONS.has(String(decision || '').toLowerCase());
}

export function buildOperatorConfirmation(approvalId, decision, acknowledged, statement = '') {
  if (!requiresOperatorConfirmation(decision)) return null;
  return {
    schema: 'jaco.operator-confirmation/v1',
    approvalId: String(approvalId || ''),
    decision: String(decision || '').toLowerCase(),
    acknowledged: acknowledged === true,
    statement: String(statement || '').trim().slice(0, 500),
  };
}

export function validateOperatorConfirmation(value, approvalId, decision) {
  if (!requiresOperatorConfirmation(decision)) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('OPERATOR_CONFIRMATION_REQUIRED');
  if (value.schema !== 'jaco.operator-confirmation/v1' || value.approvalId !== approvalId || value.decision !== decision || value.acknowledged !== true) {
    throw new Error('OPERATOR_CONFIRMATION_INVALID');
  }
  const statement = String(value.statement || '').trim();
  if (statement.length < 10) throw new Error('OPERATOR_CONFIRMATION_STATEMENT_REQUIRED');
  return { schema: value.schema, approvalId, decision, acknowledged: true, statement: statement.slice(0, 500) };
}
