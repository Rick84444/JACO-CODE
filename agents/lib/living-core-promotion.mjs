import { receiptPromotionEligibility } from './effect-evidence.mjs';

function compactNativeReceipt(native) {
  if (!native || typeof native !== 'object') return null;
  return {
    action_id: native.action_id ?? native.actionId ?? null,
    action_type: native.action_type ?? native.actionType ?? null,
    success: native.success ?? null,
    verified: native.verified ?? null,
    before_hash: native.before_hash ?? native.beforeHash ?? native.screen_before_hash ?? null,
    after_hash: native.after_hash ?? native.afterHash ?? native.screen_after_hash ?? null,
    package_name: native.package_name ?? native.packageName ?? null,
    observed_at: native.observed_at ?? native.observedAt ?? null,
  };
}

export function compactPromotionReceipt(receipt, taskType = '') {
  // Do not trust a caller-provided effectEvidence field. Reclassify from task type.
  const assessment = receiptPromotionEligibility(taskType, receipt);
  return {
    effectEvidence: assessment.evidence,
    ok: receipt?.ok === true,
    verified: receipt?.verified === true,
    outcomeUnknown: Boolean(receipt?.outcomeUnknown),
    before: receipt?.before ?? null,
    after: receipt?.after ?? null,
    result: {
      httpStatus: receipt?.result?.httpStatus ?? null,
      transportError: Boolean(receipt?.result?.transportError),
      receipt: compactNativeReceipt(receipt?.result?.receipt),
    },
  };
}

export function ensureLivingCorePromotionState(state) {
  state.livingCore ||= {};
  state.livingCore.promotionOutbox ||= [];
  state.livingCore.promotionStats ||= {
    queued: 0,
    promoted: 0,
    failures: 0,
    lastPromotedAt: null,
    lastKnowledgeId: null,
    lastError: null,
    rejected: 0,
  };
  return state.livingCore;
}

export function enqueueVerifiedReceiptPromotion(state, { receipt, task, mission } = {}) {
  if (!state || typeof state !== 'object') throw new Error('PROMOTION_STATE_REQUIRED');
  const assessment = receiptPromotionEligibility(task?.type, receipt);
  if (!assessment.allowed) return { queued: false, reason: assessment.reason, evidence: assessment.evidence };
  const missionId = String(mission?.id || '').trim();
  const actionId = String(task?.id || '').trim();
  const taskType = String(task?.type || '').trim();
  if (!missionId || !actionId || !taskType) throw new Error('PROMOTION_RECEIPT_IDENTITY_REQUIRED');

  const living = ensureLivingCorePromotionState(state);
  const id = `${missionId}:${actionId}`;
  if (living.promotionOutbox.some(item => item.id === id)) return { queued: false, reason: 'DUPLICATE', id };
  if (living.promotionOutbox.length >= 1000) throw new Error('PROMOTION_OUTBOX_FULL');

  const item = {
    id,
    missionId,
    actionId,
    taskType,
    receipt: compactPromotionReceipt(receipt, taskType),
    attempts: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
  };
  living.promotionOutbox.push(item);
  living.promotionStats.queued += 1;
  return { queued: true, id, item };
}

export async function flushLivingCorePromotions(state, promote, { limit = 20 } = {}) {
  if (typeof promote !== 'function') throw new Error('PROMOTION_SINK_REQUIRED');
  const living = ensureLivingCorePromotionState(state);
  const selected = living.promotionOutbox.slice(0, Math.max(1, Math.min(100, Number(limit) || 20)));
  const completed = new Set();
  const rejected = new Set();
  const results = [];

  for (const item of selected) {
    // Historical outboxes predating the new provenance gate may still contain
    // mutating tasks. Refuse them at delivery too; the durable mission keeps
    // its receipt, while the untrusted promotion is retired without retry.
    const assessment = receiptPromotionEligibility(item.taskType, item.receipt);
    if (!assessment.allowed) {
      rejected.add(item.id);
      living.promotionStats.rejected = (living.promotionStats.rejected || 0) + 1;
      results.push({ id: item.id, ok: false, skipped: true, reason: assessment.reason });
      continue;
    }
    try {
      const result = await promote({
        missionId: item.missionId,
        actionId: item.actionId,
        taskType: item.taskType,
        receipt: item.receipt,
      });
      completed.add(item.id);
      living.promotionStats.promoted += 1;
      living.promotionStats.lastPromotedAt = new Date().toISOString();
      living.promotionStats.lastKnowledgeId = result?.knowledge?.id || null;
      living.promotionStats.lastError = null;
      results.push({ id: item.id, ok: true, knowledgeId: result?.knowledge?.id || null, idempotent: Boolean(result?.idempotent) });
    } catch (error) {
      item.attempts += 1;
      item.lastError = String(error?.message || error).slice(0, 500);
      living.promotionStats.failures += 1;
      living.promotionStats.lastError = item.lastError;
      results.push({ id: item.id, ok: false, error: item.lastError, attempts: item.attempts });
    }
  }

  if (completed.size || rejected.size) {
    living.promotionOutbox = living.promotionOutbox.filter(item => !completed.has(item.id) && !rejected.has(item.id));
  }
  return {
    processed: selected.length,
    promoted: completed.size,
    rejected: rejected.size,
    pending: living.promotionOutbox.length,
    results,
  };
}
