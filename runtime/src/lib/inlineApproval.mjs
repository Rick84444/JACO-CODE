// Presentation-only classification for Aura's existing operator approval center.
// Never infer permissions from these labels: the server remains the decision gate.
const POSITIVE = new Set(['approve', 'confirm', 'resume']);

export function inlineApprovalPresentation(approval) {
  const title = String(approval?.title || '').trim();
  const reason = String(approval?.reason || '').trim();
  const details = approval?.details && typeof approval.details === 'object' ? approval.details : {};
  const risk = String(approval?.risk || '').toUpperCase();
  const kind = String(approval?.kind || '').toUpperCase();
  const actions = Array.isArray(approval?.actions) ? approval.actions.filter(a => typeof a === 'string') : [];

  // Only structured runtime errors count: titles and reasons are untrusted
  // mission text and may discuss this very error during a legitimate repair task.
  const errorCodes = [details.error, details.code, details.errorCode,
    details.latestReceipt?.error, details.latestReceipt?.code];
  const missingMission = errorCodes.some(value => value === 'NOVA_MISSION_NOT_FOUND');
  const requiresReview = ['HIGH','CRITICAL'].includes(risk)
    || /PAYMENT|SPEND|PURCHASE|CREDENTIAL|DELETE|SECURITY|PERMISSION/.test(kind)
    || /(?:PAYMENT|SPEND|PURCHASE|CREDENTIAL|DELETE|SECURITY|PERMISSION)/i.test(String(approval?.source || ''))
    || details.outcomeUnknown === true || details.spending === true;
  const positive = actions.filter(a => POSITIVE.has(a));
  const negative = actions.filter(a => !POSITIVE.has(a));
  const mainAction = positive[0] || null;
  const question = mainAction === 'resume' ? 'Fortsätta uppdraget?'
    : mainAction === 'confirm' ? 'Bekräfta resultatet?'
    : mainAction === 'approve' ? 'Godkänna åtgärden?'
    : 'Vad vill du göra?';
  return {
    title, reason, risk, kind, source: String(approval?.source || ''),
    positive, negative, question,
    missingMission, requiresReview,
    summary: (title || reason || 'Ett beslut väntar').split('\n')[0].slice(0, 150),
    shortReason: reason.split('\n')[0].slice(0, 180),
  };
}
