// Operator-initiated blueprints, not runtime workers or additional model processes.
// Provision through the existing /api/aura/organization operator-authenticated POST /agents route.
// Never place API keys, grants, privileged capabilities or invented live outcomes in a blueprint.
export const AURA_SPECIALISTS = Object.freeze([
  Object.freeze({
    id: 'grokbot-analyst',
    name: 'Grok Bot Analyst',
    title: 'Competitive Research Lead',
    reportsTo: 'aura',
    task: 'Study Grok Bot primary documentation, product architecture and independent user feedback. Distinguish vendor claims, first-hand reports and reproducible evidence; track what changed since the last review.',
    goal: 'Deliver a sourced competitor scorecard covering architecture, strengths, criticism, pricing, privacy, approvals and user friction. Turn findings into falsifiable JACO improvements; never invent access to proprietary implementation.',
  }),
  Object.freeze({
    id: 'senior-developer',
    name: 'Senior Developer',
    title: 'Senior Software Architect',
    reportsTo: 'aura',
    task: 'Design and review production-quality JACO changes using existing Aura, SEER, Durable Nova, ModelRelay and Continuum owners. Require explicit scope, tests, security implications and a rollback plan.',
    goal: 'Ship minimal, maintainable changes through reviewed pull requests with deterministic tests and verified host evidence. Do not claim a deployment from a green unit test.',
  }),
  Object.freeze({
    id: 'reliability-debugger',
    name: 'Reliability Debugger',
    title: 'Debugging and Verification Engineer',
    reportsTo: 'aura',
    task: 'Reproduce reported failures with precise versions, environment, logs and steps. Isolate root causes across Windows, Termux, Chrome/CDP, MCP and CI. Preserve evidence before proposing a fix.',
    goal: 'Return a minimal reproduction, falsifiable root-cause hypothesis, regression test and before/after observation for each incident; do not restart healthy or foreign processes.',
  }),
  Object.freeze({
    id: 'user-advocate',
    name: 'User Advocate',
    title: 'User Experience and Acceptance Lead',
    reportsTo: 'aura',
    task: 'Evaluate the JACO operator experience from a first-time user perspective: onboarding, English-first copy, model/provider setup, approvals, budget visibility, task completion and accessibility.',
    goal: 'Deliver user-journey acceptance tests and prioritized friction reports, validated against actual UI and receipts. Do not substitute screenshots or fabricated interactions for real tests.',
  }),
]);

export function planAuraSpecialistProvision(agents) {
  if (!Array.isArray(agents)) throw new Error('ORGANIZATION_AGENTS_INVALID');
  const byId = new Map(agents.map(a => [a?.id, a]));
  const missing = [];
  const present = [];
  for (const specialist of AURA_SPECIALISTS) {
    const existing = byId.get(specialist.id);
    if (!existing) {
      missing.push({
        ...specialist,
        mail: '',
        model: { kind: 'local', providerId: 'ollama', model: '' },
      });
      continue;
    }
    // Never silently reinterpret an operator-modified identity or an existing agent.
    if (existing.name !== specialist.name || existing.reportsTo !== 'aura') {
      throw new Error('SPECIALIST_ID_CONFLICT:' + specialist.id);
    }
    present.push(specialist.id);
  }
  return { missing, present };
}

// Caller must be a real operator-authenticated client; this function does NOT authorize.
// A partial failure is retriable because the next run reads the current organization.
export async function provisionAuraSpecialists({ readAgents, createAgent }) {
  const agents = await readAgents();
  const { missing, present } = planAuraSpecialistProvision(agents);
  const created = [];
  for (const definition of missing) {
    await createAgent(definition);
    created.push(definition.id);
  }
  return { created, present };
}
