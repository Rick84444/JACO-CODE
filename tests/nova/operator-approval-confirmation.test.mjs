import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOperatorConfirmation,
  requiresOperatorConfirmation,
  validateOperatorConfirmation,
} from '../../runtime/src/lib/operatorApproval.mjs';

test('positive approval decisions require one explicit scoped confirmation', () => {
  for (const decision of ['approve', 'confirm', 'resume']) assert.equal(requiresOperatorConfirmation(decision), true);
  for (const decision of ['reject', 'cancel']) assert.equal(requiresOperatorConfirmation(decision), false);

  const receipt = buildOperatorConfirmation('mission:m1', 'resume', true, 'I understand the risk and approve this one continuation.');
  assert.deepEqual(validateOperatorConfirmation(receipt, 'mission:m1', 'resume'), receipt);
  assert.throws(() => validateOperatorConfirmation(null, 'mission:m1', 'resume'), /OPERATOR_CONFIRMATION_REQUIRED/);
  assert.throws(() => validateOperatorConfirmation({ ...receipt, approvalId: 'mission:other' }, 'mission:m1', 'resume'), /OPERATOR_CONFIRMATION_INVALID/);
});

test('declining or ending work never needs a positive-risk checkbox', () => {
  assert.equal(buildOperatorConfirmation('mission:m1', 'cancel', false, ''), null);
  assert.equal(validateOperatorConfirmation(null, 'mission:m1', 'cancel'), null);
});
