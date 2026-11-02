// Read-only preflight for an Aura user request. Knowledge and Skill Runtime remain the single source of truth.
// Finding a relevant skill never grants permission to use its scripts, tools or network access.
export function cognitiveActivationPreview(goal, { knowledge, skills } = {}) {
  const query = String(goal || '').trim().slice(0, 360);
  const empty = { schema: 'jaco.aura.cognitive-activation/v1', knowledge: [], skills: [],
    permission: 'NO_GRANT_PER_STEP_POLICY_REQUIRED' };
  if (!query) return empty;
  let foundKnowledge = [];
  let foundSkills = [];
  try { foundKnowledge = Array.isArray(knowledge?.search?.(query, { limit: 12 })) ? knowledge.search(query, {limit: 12}) : []; }
  catch { /* unavailable memory is not knowledge */ }
  try { foundSkills = Array.isArray(skills?.search?.(query, { limit: 10 })) ? skills.search(query, {limit: 10}) : []; }
  catch { /* no catalog, no invented skills */ }
  const verified = foundKnowledge.filter(item =>
    item?.verificationStatus === 'VERIFIED' && Array.isArray(item.evidenceRefs) && item.evidenceRefs.length > 0
  ).slice(0, 5).map(item => ({
    id: String(item.id || '').slice(0, 180),
    purpose: String(item.purpose || '').slice(0, 420),
    kind: String(item.kind || 'general').slice(0, 80),
    confidence: Number.isFinite(Number(item.confidence)) ? Math.max(0,Math.min(1,Number(item.confidence))) : null,
    evidenceRefs: item.evidenceRefs.slice(0, 4).map(ref=>String(ref).slice(0,150)),
    verificationStatus: 'VERIFIED',
  }));
  const activeSkills = foundSkills.filter(item=>item?.status === 'ACTIVE').slice(0, 6).map(item=>({
    id: String(item.id || '').slice(0, 160),
    version: String(item.version || '').slice(0, 32),
    name: String(item.name || '').slice(0, 120),
    description: String(item.description || '').slice(0, 320),
    activation: 'DISCOVERED_NOT_AUTHORIZED',
    // An executable operation must be separately admitted by the current mission's
    // per-step runtime tool/skill grant, coding contract, device and budget policy.
    requires: ['active_mission', 'step_permission', 'tool_policy', 'budget_and_approval'],
  }));
  return {...empty, knowledge: verified, skills: activeSkills};
}
