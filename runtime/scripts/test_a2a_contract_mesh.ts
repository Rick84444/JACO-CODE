import {
  routeA2APayloadWithContract,
  getCircuitBreakerState,
  resetCircuitBreaker,
  validateA2AContract
} from '../src/server/a2a/a2aExecutor.js';
import fs from 'fs';

async function runContractMeshTests() {
  console.log('===============================================================');
  console.log('[REAL TEST] A2A DETERMINISTIC CONTRACT MESH & CIRCUIT BREAKER');
  console.log('===============================================================\n');

  const contractId = 'neo_to_nova_refactor_v1';
  const agentPair = 'neo->nova';

  // 0. Reset Circuit Breaker to clean state
  resetCircuitBreaker(agentPair);
  console.log('[TEST 0] Initial Circuit Breaker state:', getCircuitBreakerState(agentPair));

  // 1. TEST 1: Valid payload with extra forbidden context (Testing Schema + Context Pruning)
  console.log('\n--- [TEST 1] VALID PAYLOAD WITH FORBIDDEN CONTEXT BLOAT ---');
  const validPayloadWithBloat = {
    contractVersion: '1.0.0',
    transactionId: 'tx_stage_alpha_99',
    targetFilePath: 'src/server/a2a/skillStore.ts',
    targetFunctionOrBlock: 'executeLocalSkill',
    sourceChecksumSha256: '0734c81e7976202f9c24bf4469809ae65da8eac0cbca622e23344bfbf40e14dc',
    rulesToApply: [
      { ruleId: 'REMOVE_DEAD_CODE', severity: 'CRITICAL', targetLines: [10, 25] },
      { ruleId: 'TYPE_HARDENING', severity: 'OPTIMIZATION' }
    ],
    // Forbidden bloat keys that must be pruned:
    chatHistory: [{ role: 'user', content: 'hello agent' }],
    thoughts: 'I am reasoning about this step...',
    reasoningLogs: ['step 1', 'step 2'],
    scratchpad: 'temporary buffer'
  };

  const res1 = routeA2APayloadWithContract({
    sourceAgent: 'Neo',
    targetAgent: 'Nova',
    contractId,
    rawPayload: validPayloadWithBloat,
    taskId: 'task_valid_001'
  });

  console.log('Result 1 (Should be DELIVERED):', res1.status);
  console.log('Has pruned forbidden keys?:', !res1.validatedPayload?.chatHistory && !res1.validatedPayload?.thoughts);
  console.log('Delivered clean payload keys:', Object.keys(res1.validatedPayload || {}));

  if (res1.status !== 'DELIVERED') {
    throw new Error('Test 1 failed: Expected DELIVERED status');
  }

  // 2. TEST 2: Invalid Payload Attempt #1 (Missing sourceChecksumSha256 & invalid rule)
  console.log('\n--- [TEST 2] INVALID PAYLOAD ATTEMPT #1 (Local retry expected) ---');
  const invalidPayload1 = {
    contractVersion: '1.0.0',
    transactionId: 'tx_fail_1',
    targetFilePath: 'src/server/a2a/skillStore.ts',
    targetFunctionOrBlock: 'testFunc',
    sourceChecksumSha256: 'INVALID_NOT_HEX_HASH', // Invalid sha256
    rulesToApply: [] // Invalid: min 1 rule required
  };

  const res2 = routeA2APayloadWithContract({
    sourceAgent: 'Neo',
    targetAgent: 'Nova',
    contractId,
    rawPayload: invalidPayload1,
    taskId: 'task_invalid_001'
  });

  console.log('Result 2 Status:', res2.status);
  console.log('Consecutive Failures:', res2.circuitBreaker.consecutiveFailures);
  console.log('Violations detected:', res2.violations);

  if (res2.status !== 'REJECTED_LOCAL_RETRY' || res2.circuitBreaker.consecutiveFailures !== 1) {
    throw new Error('Test 2 failed: Expected REJECTED_LOCAL_RETRY with failures=1');
  }

  // 3. TEST 3: Invalid Payload Attempt #2 (Local retry expected)
  console.log('\n--- [TEST 3] INVALID PAYLOAD ATTEMPT #2 (Local retry expected) ---');
  const invalidPayload2 = {
    contractVersion: '9.9.9', // Invalid version
    transactionId: 'tx_fail_2',
    targetFilePath: '', // Missing path
    targetFunctionOrBlock: 'testFunc',
    sourceChecksumSha256: '12345',
    rulesToApply: [{ ruleId: 'UNKNOWN_RULE', severity: 'HIGH' }]
  };

  const res3 = routeA2APayloadWithContract({
    sourceAgent: 'Neo',
    targetAgent: 'Nova',
    contractId,
    rawPayload: invalidPayload2,
    taskId: 'task_invalid_002'
  });

  console.log('Result 3 Status:', res3.status);
  console.log('Consecutive Failures:', res3.circuitBreaker.consecutiveFailures);

  if (res3.status !== 'REJECTED_LOCAL_RETRY' || res3.circuitBreaker.consecutiveFailures !== 2) {
    throw new Error('Test 3 failed: Expected REJECTED_LOCAL_RETRY with failures=2');
  }

  // 4. TEST 4: Invalid Payload Attempt #3 (CIRCUIT BREAKER SHOULD TRIP & QUARANTINE)
  console.log('\n--- [TEST 4] INVALID PAYLOAD ATTEMPT #3 (CIRCUIT BREAKER TRIP & QUARANTINE) ---');
  const invalidPayload3 = {
    contractVersion: '1.0.0',
    // Missing transactionId, missing targetFilePath
    rulesToApply: []
  };

  const res4 = routeA2APayloadWithContract({
    sourceAgent: 'Neo',
    targetAgent: 'Nova',
    contractId,
    rawPayload: invalidPayload3,
    taskId: 'task_invalid_003_tripped'
  });

  console.log('Result 4 Status:', res4.status);
  console.log('Circuit Breaker Status:', res4.circuitBreaker.status);
  console.log('Quarantine File:', res4.quarantineFilePath);

  if (res4.status !== 'TRIPPED_CIRCUIT_BREAKER_QUARANTINED' || res4.circuitBreaker.status !== 'OPEN') {
    throw new Error('Test 4 failed: Circuit breaker did not trip OPEN');
  }

  if (res4.quarantineFilePath && fs.existsSync(res4.quarantineFilePath)) {
    const quarantinedData = JSON.parse(fs.readFileSync(res4.quarantineFilePath, 'utf8'));
    console.log('[VERIFIED] Quarantine file exists on disk with content:', {
      taskId: quarantinedData.taskId,
      agentPair: quarantinedData.agentPair,
      violationsCount: quarantinedData.violations.length,
      status: quarantinedData.status
    });
  } else {
    throw new Error('Test 4 failed: Quarantine file was not written to disk');
  }

  // 5. TEST 5: Subsequent call while OPEN is immediately blocked
  console.log('\n--- [TEST 5] CALL WHILE CIRCUIT BREAKER IS OPEN ---');
  const res5 = routeA2APayloadWithContract({
    sourceAgent: 'Neo',
    targetAgent: 'Nova',
    contractId,
    rawPayload: validPayloadWithBloat
  });
  console.log('Result 5 Status (Should be blocked):', res5.status);
  console.log('Rejection Message:', res5.rejectionMessage);

  if (res5.status !== 'TRIPPED_CIRCUIT_BREAKER_QUARANTINED') {
    throw new Error('Test 5 failed: Call should be rejected while OPEN');
  }

  // 6. TEST 6: Operator Reset
  console.log('\n--- [TEST 6] OPERATOR RESET VIA APPROVAL GATE ---');
  const resetResult = resetCircuitBreaker(agentPair);
  console.log('Circuit Breaker reset state:', resetResult);

  const res6 = routeA2APayloadWithContract({
    sourceAgent: 'Neo',
    targetAgent: 'Nova',
    contractId,
    rawPayload: validPayloadWithBloat
  });
  console.log('Result 6 Status after reset (Should be DELIVERED):', res6.status);

  if (res6.status !== 'DELIVERED') {
    throw new Error('Test 6 failed: Expected DELIVERED after reset');
  }

  console.log('\n===============================================================');
  console.log('[REAL SUCCESS] ALL A2A CONTRACT MESH & CIRCUIT BREAKER TESTS PASSED!');
  console.log('===============================================================');
}

runContractMeshTests().catch((err) => {
  console.error('[TEST ERROR]', err);
  process.exit(1);
});
