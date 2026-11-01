import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { validProviderId } from './providerRegistry.mjs';

// The operator's agent company. The operator is CEO, Aura is vice CEO, and every other agent reports to someone.
// One store holds who exists, what each agent may do (mandate) and how each should work (traits).
// Mandates and traits are ceilings along the reporting chain: an agent may use a permission only while it and every
// manager above it hold it, so revoking a manager's permission stops the whole branch without touching its reports.
// High-risk permissions are granted by the operator only, with the risk explicitly accepted. Payments cannot be granted:
// the operator approves each one.
// Not yet enforced on Nova or tool execution: authorize() is the check those paths will call.

export const OPERATOR = 'operator';
export const AURA = 'aura';

export const PERMISSIONS = {
  'files.read': { risk: 'low', label: 'Läsa projekt och filer' },
  'mail.receive': { risk: 'low', label: 'Ta emot mail' },
  'files.write': { risk: 'medium', label: 'Skriva i projektmappen' },
  'commands.run': { risk: 'medium', label: 'Köra kommandon och tester' },
  'git.branch': { risk: 'medium', label: 'Commit och push till egen gren' },
  'cloud.models': { risk: 'medium', label: 'Använda molnmodeller inom sin budget' },
  'git.merge': { risk: 'high', label: 'Merga till huvudgrenen' },
  browser: { risk: 'high', label: 'Styra webbläsare' },
  'mail.send': { risk: 'high', label: 'Skicka mail' },
  publish: { risk: 'high', label: 'Publicera och deploya' },
  'agents.create': { risk: 'high', label: 'Skapa underagenter' },
  payments: { risk: 'locked', label: 'Betalningar och nya ekonomiska åtaganden' },
};

// 0–100 working-style weights. Capped traits govern autonomy, so a report never exceeds its manager's.
export const TRAITS = {
  toolUse: { label: 'Verktyg och MCP', capped: true },
  agency: { label: 'Agentisk (steg innan avstämning)', capped: true },
  freedom: { label: 'Frihet att ta initiativ utanför uppgiften', capped: true },
  rigor: { label: 'Noggrannhet och verifiering', capped: false },
  reporting: { label: 'Hur ofta den rapporterar', capped: false },
};

const ID = /^[a-z][a-z0-9-]{1,39}$/;
const MAIL = /^[a-z0-9._-]{1,64}@[a-z0-9.-]+\.[a-z]{2,}$/i;
const text = (value, max, error) => {
  const v = String(value ?? '').trim();
  if (!v || v.length > max) throw new Error(error);
  return v;
};
const optionalText = (value, max, error) => value == null || value === '' ? '' : text(value, max, error);
const slug = name => String(name).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
const defaultTraits = () => Object.fromEntries(Object.keys(TRAITS).map(key => [key, 50]));
const emptyMandate = () => ({ permissions: {}, budgetUsdPerDay: 0, maxSubAgents: 0, autoApproveSubAgents: false });

function checkModel(model) {
  if (model == null) return { kind: 'local', providerId: 'ollama', model: '' };
  if (typeof model !== 'object' || !['local', 'api'].includes(model.kind)) throw new Error('AGENT_MODEL_INVALID');
  if (!validProviderId(model.providerId)) throw new Error('INVALID_PROVIDER_ID');
  return { kind: model.kind, providerId: model.providerId, model: optionalText(model.model, 120, 'AGENT_MODEL_INVALID') };
}

export class AgentOrganization {
  constructor(stateDir, { now = () => new Date().toISOString() } = {}) {
    this.dir = path.join(stateDir, 'org');
    this.file = path.join(this.dir, 'organization.json');
    this.auditFile = path.join(this.dir, 'audit.jsonl');
    this.now = now;
    this.state = this.load();
  }

  load() {
    if (!fs.existsSync(this.file)) {
      const at = this.now();
      const state = { version: 1, agents: { [AURA]: {
        id: AURA, name: 'Aura', title: 'Vice VD', reportsTo: OPERATOR, model: checkModel(null), mail: '', task: '', goal: '',
        status: 'active', createdBy: OPERATOR, createdAt: at, mandate: emptyMandate(), traits: defaultTraits(),
      } } };
      this.save(state);
      this.ensureFolder(AURA);
      return state;
    }
    // A store that cannot be read must not be replaced by a fresh one: that would silently reset every mandate.
    try {
      const state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (state?.version !== 1 || !state.agents?.[AURA]) throw new Error('shape');
      return state;
    } catch { throw new Error('ORGANIZATION_STATE_CORRUPT'); }
  }

  save(state = this.state) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  audit(actor, action, details) {
    fs.appendFileSync(this.auditFile, `${JSON.stringify({ at: this.now(), actor, action, ...details })}\n`);
  }

  // Each agent's own folder: rules, skills, memory and the MCP servers it may use. The store above stays the one
  // owner of identity, mandate and traits.
  ensureFolder(id) {
    const root = this.folder(id);
    for (const sub of ['skills', 'memory']) fs.mkdirSync(path.join(root, sub), { recursive: true });
    const rules = path.join(root, 'rules.md');
    if (!fs.existsSync(rules)) fs.writeFileSync(rules, '# Regler\n\nRegler som agenten aldrig får bryta. En regel per rad.\n');
    const mcp = path.join(root, 'mcp.json');
    if (!fs.existsSync(mcp)) fs.writeFileSync(mcp, `${JSON.stringify({ servers: {} }, null, 2)}\n`);
  }

  folder(id) { return path.join(this.dir, 'agents', id); }

  agent(id) {
    const agent = this.state.agents[id];
    if (!agent) throw new Error('AGENT_NOT_FOUND');
    return agent;
  }

  // Managers from the agent's own manager up to Aura; the operator is the root and is not an agent.
  managers(id) {
    const chain = [];
    for (let at = this.agent(id).reportsTo; at !== OPERATOR; at = this.agent(at).reportsTo) {
      if (chain.includes(at) || chain.length > 32) throw new Error('ORGANIZATION_CYCLE');
      chain.push(at);
    }
    return chain;
  }

  isAbove(managerId, id) { return managerId === OPERATOR || this.managers(id).includes(managerId); }

  requireAuthority(actor, id) {
    if (actor === OPERATOR) return;
    if (actor === id || !this.state.agents[actor] || !this.isAbove(actor, id)) throw new Error('AGENT_AUTHORITY_DENIED');
    if (this.state.agents[actor].status !== 'active') throw new Error('AGENT_NOT_ACTIVE');
  }

  holds(id, key) { return Boolean(this.agent(id).mandate.permissions[key]); }

  // The single runtime check: the agent and its whole chain are active and hold the permission.
  authorize(id, key) {
    if (!PERMISSIONS[key]) return { allowed: false, reason: 'PERMISSION_UNKNOWN' };
    if (PERMISSIONS[key].risk === 'locked') return { allowed: false, reason: 'OPERATOR_APPROVAL_REQUIRED' };
    if (!this.state.agents[id]) return { allowed: false, reason: 'AGENT_NOT_FOUND' };
    for (const at of [id, ...this.managers(id)]) {
      const agent = this.agent(at);
      if (agent.status !== 'active') return { allowed: false, reason: at === id ? 'AGENT_NOT_ACTIVE' : 'MANAGER_NOT_ACTIVE', at };
      if (!agent.mandate.permissions[key]) return { allowed: false, reason: at === id ? 'PERMISSION_NOT_GRANTED' : 'MANAGER_LACKS_PERMISSION', at };
    }
    return { allowed: true };
  }

  effectiveBudgetUsdPerDay(id) {
    return Math.min(...[id, ...this.managers(id)].map(at => this.agent(at).mandate.budgetUsdPerDay));
  }

  effectiveTraits(id) {
    const own = { ...this.agent(id).traits };
    for (const at of this.managers(id)) {
      for (const [key, trait] of Object.entries(TRAITS)) if (trait.capped) own[key] = Math.min(own[key], this.agent(at).traits[key]);
    }
    return own;
  }

  createAgent(input = {}, actor = OPERATOR) {
    const name = text(input.name, 60, 'AGENT_NAME_INVALID');
    const id = input.id ? String(input.id) : slug(name);
    if (!ID.test(id) || id === OPERATOR) throw new Error('AGENT_ID_INVALID');
    if (this.state.agents[id]) throw new Error('AGENT_ID_TAKEN');
    const reportsTo = String(input.reportsTo || (actor === OPERATOR ? AURA : actor));
    if (!this.state.agents[reportsTo]) throw new Error('MANAGER_NOT_FOUND');
    let status = 'active';
    if (actor !== OPERATOR) {
      // An agent hires only into its own branch, within its quota, and the hire waits for the operator
      // unless the operator has let this agent approve its own hires.
      if (reportsTo !== actor && !this.managers(reportsTo).includes(actor)) throw new Error('AGENT_AUTHORITY_DENIED');
      const check = this.authorize(actor, 'agents.create');
      if (!check.allowed) throw new Error(check.reason);
      const hires = Object.values(this.state.agents).filter(a => a.createdBy === actor && a.status !== 'retired').length;
      if (hires >= this.agent(actor).mandate.maxSubAgents) throw new Error('SUB_AGENT_QUOTA_REACHED');
      if (!this.agent(actor).mandate.autoApproveSubAgents) status = 'pending';
    }
    const mail = optionalText(input.mail, 120, 'AGENT_MAIL_INVALID');
    if (mail && !MAIL.test(mail)) throw new Error('AGENT_MAIL_INVALID');
    if (mail && Object.values(this.state.agents).some(a => a.mail.toLowerCase() === mail.toLowerCase())) throw new Error('AGENT_MAIL_TAKEN');
    const managerTraits = this.effectiveTraits(reportsTo);
    const traits = defaultTraits();
    for (const [key, trait] of Object.entries(TRAITS)) if (trait.capped) traits[key] = Math.min(traits[key], managerTraits[key]);
    const agent = {
      id, name, title: optionalText(input.title, 60, 'AGENT_TITLE_INVALID'), reportsTo, model: checkModel(input.model), mail,
      task: optionalText(input.task, 2000, 'AGENT_TASK_INVALID'), goal: optionalText(input.goal, 2000, 'AGENT_GOAL_INVALID'),
      status, createdBy: actor, createdAt: this.now(), mandate: emptyMandate(), traits,
    };
    this.state.agents[id] = agent;
    this.save();
    this.ensureFolder(id);
    this.audit(actor, 'agent.created', { agent: id, reportsTo, status });
    return agent;
  }

  updateProfile(id, patch = {}, actor = OPERATOR) {
    this.requireAuthority(actor, id);
    const agent = this.agent(id);
    const allowed = ['name', 'title', 'task', 'goal', 'model', 'mail'];
    if (Object.keys(patch).some(key => !allowed.includes(key))) throw new Error('AGENT_FIELDS_INVALID');
    const next = { ...agent };
    if ('name' in patch) next.name = text(patch.name, 60, 'AGENT_NAME_INVALID');
    if ('title' in patch) next.title = optionalText(patch.title, 60, 'AGENT_TITLE_INVALID');
    if ('task' in patch) next.task = optionalText(patch.task, 2000, 'AGENT_TASK_INVALID');
    if ('goal' in patch) next.goal = optionalText(patch.goal, 2000, 'AGENT_GOAL_INVALID');
    if ('model' in patch) next.model = checkModel(patch.model);
    if ('mail' in patch) {
      next.mail = optionalText(patch.mail, 120, 'AGENT_MAIL_INVALID');
      if (next.mail && !MAIL.test(next.mail)) throw new Error('AGENT_MAIL_INVALID');
      if (next.mail && Object.values(this.state.agents).some(a => a.id !== id && a.mail.toLowerCase() === next.mail.toLowerCase())) throw new Error('AGENT_MAIL_TAKEN');
    }
    this.state.agents[id] = next;
    this.save();
    this.audit(actor, 'agent.profile', { agent: id, fields: Object.keys(patch) });
    return next;
  }

  setPermission(id, key, granted, actor = OPERATOR, { acceptRisk = false } = {}) {
    const permission = PERMISSIONS[key];
    if (!permission) throw new Error('PERMISSION_UNKNOWN');
    if (permission.risk === 'locked') throw new Error('PERMISSION_LOCKED');
    this.requireAuthority(actor, id);
    const agent = this.agent(id);
    if (!granted) {
      delete agent.mandate.permissions[key];
    } else {
      if (permission.risk === 'high' && actor !== OPERATOR) throw new Error('HIGH_RISK_OPERATOR_ONLY');
      if (permission.risk === 'high' && acceptRisk !== true) throw new Error('RISK_ACCEPTANCE_REQUIRED');
      // A manager hands down only what it holds itself; the operator's grant to Aura is the top of the chain.
      if (this.managers(id).some(at => !this.holds(at, key))) throw new Error('MANAGER_LACKS_PERMISSION');
      if (actor !== OPERATOR && !this.authorize(actor, key).allowed) throw new Error('GRANTOR_LACKS_PERMISSION');
      agent.mandate.permissions[key] = { grantedBy: actor, grantedAt: this.now(), ...(permission.risk === 'high' ? { riskAcceptedAt: this.now() } : {}) };
    }
    this.save();
    this.audit(actor, granted ? 'permission.granted' : 'permission.revoked', { agent: id, permission: key, risk: permission.risk });
    return agent.mandate;
  }

  setLimits(id, patch = {}, actor = OPERATOR) {
    this.requireAuthority(actor, id);
    const agent = this.agent(id);
    const keys = ['budgetUsdPerDay', 'maxSubAgents', 'autoApproveSubAgents'];
    if (!Object.keys(patch).length || Object.keys(patch).some(key => !keys.includes(key))) throw new Error('LIMIT_FIELDS_INVALID');
    const next = { ...agent.mandate };
    if ('budgetUsdPerDay' in patch) {
      const usd = Number(patch.budgetUsdPerDay);
      if (!Number.isFinite(usd) || usd < 0 || usd > 1000) throw new Error('BUDGET_INVALID');
      if (agent.reportsTo !== OPERATOR && usd > this.effectiveBudgetUsdPerDay(agent.reportsTo)) throw new Error('BUDGET_ABOVE_MANAGER');
      next.budgetUsdPerDay = Math.round(usd * 100) / 100;
    }
    if ('maxSubAgents' in patch) {
      const max = Number(patch.maxSubAgents);
      if (!Number.isInteger(max) || max < 0 || max > 50) throw new Error('SUB_AGENT_LIMIT_INVALID');
      next.maxSubAgents = max;
    }
    if ('autoApproveSubAgents' in patch) {
      if (typeof patch.autoApproveSubAgents !== 'boolean') throw new Error('AUTO_APPROVE_INVALID');
      if (patch.autoApproveSubAgents && actor !== OPERATOR) throw new Error('HIGH_RISK_OPERATOR_ONLY');
      next.autoApproveSubAgents = patch.autoApproveSubAgents;
    }
    agent.mandate = next;
    this.save();
    this.audit(actor, 'limits.set', { agent: id, ...patch });
    return next;
  }

  setTraits(id, patch = {}, actor = OPERATOR) {
    this.requireAuthority(actor, id);
    const agent = this.agent(id);
    if (!Object.keys(patch).length || Object.keys(patch).some(key => !TRAITS[key])) throw new Error('TRAIT_UNKNOWN');
    const manager = agent.reportsTo === OPERATOR ? null : this.effectiveTraits(agent.reportsTo);
    const next = { ...agent.traits };
    for (const [key, value] of Object.entries(patch)) {
      if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error('TRAIT_VALUE_INVALID');
      if (TRAITS[key].capped && manager && value > manager[key]) throw new Error('TRAIT_ABOVE_MANAGER');
      next[key] = value;
    }
    agent.traits = next;
    this.save();
    this.audit(actor, 'traits.set', { agent: id, ...patch });
    return next;
  }

  setStatus(id, status, actor = OPERATOR) {
    this.requireAuthority(actor, id);
    const agent = this.agent(id);
    const allowed = { approve: ['pending'], pause: ['active', 'pending'], resume: ['paused'] };
    if (!allowed[status]) throw new Error('STATUS_INVALID');
    if (!allowed[status].includes(agent.status)) throw new Error(`AGENT_${agent.status.toUpperCase()}`);
    if (status === 'approve' && actor !== OPERATOR) throw new Error('OPERATOR_APPROVAL_REQUIRED');
    // A manager cannot undo the operator's pause.
    if (status === 'resume' && actor !== OPERATOR && agent.pausedBy === OPERATOR) throw new Error('OPERATOR_APPROVAL_REQUIRED');
    agent.status = status === 'pause' ? 'paused' : 'active';
    if (status === 'pause') agent.pausedBy = actor; else delete agent.pausedBy;
    this.save();
    this.audit(actor, `agent.${status}`, { agent: id });
    return agent;
  }

  // Traits compiled into limits the runtime enforces and a short brief the agent reads in its system prompt.
  workingWeights(id) {
    const t = this.effectiveTraits(id);
    const weights = {
      maxToolCallsPerStep: Math.round(t.toolUse / 5),
      stepsBeforeCheckIn: 1 + Math.round(t.agency / 100 * 19),
      scope: t.freedom < 34 ? 'task' : t.freedom < 67 ? 'adjacent' : 'open',
      mayProposeGoals: t.freedom >= 67,
      evidence: t.rigor < 34 ? 'self-check' : t.rigor < 67 ? 'tests' : 'tests-and-review',
      reportEveryMinutes: Math.round(240 - t.reporting / 100 * 225),
    };
    const scope = { task: 'håll dig strikt till uppgiften', adjacent: 'du får ta närliggande initiativ som tjänar målet', open: 'du får ta egna initiativ och föreslå nya mål' }[weights.scope];
    const evidence = { 'self-check': 'kontrollera själv', tests: 'kör tester', 'tests-and-review': 'kör tester och be om oberoende granskning' }[weights.evidence];
    const brief = [
      `Verktyg ${t.toolUse}%: högst ${weights.maxToolCallsPerStep} verktygsanrop per steg.`,
      `Agentisk ${t.agency}%: högst ${weights.stepsBeforeCheckIn} steg innan du stämmer av med din chef.`,
      `Frihet ${t.freedom}%: ${scope}.`,
      `Noggrannhet ${t.rigor}%: ${evidence} innan du säger att något är klart.`,
      `Rapportering ${t.reporting}%: rapportera minst var ${weights.reportEveryMinutes}:e minut.`,
    ].join('\n');
    return { traits: t, weights, brief };
  }

  snapshot() {
    return {
      operator: { id: OPERATOR, title: 'VD' },
      agents: Object.values(this.state.agents).map(agent => ({
        ...agent,
        folder: this.folder(agent.id),
        effective: {
          permissions: Object.keys(PERMISSIONS).filter(key => this.authorize(agent.id, key).allowed),
          budgetUsdPerDay: this.effectiveBudgetUsdPerDay(agent.id),
          traits: this.effectiveTraits(agent.id),
        },
      })),
      catalog: { permissions: PERMISSIONS, traits: TRAITS },
    };
  }
}

// Operator UI adapter: every change through these routes is made by the operator (local UI only, same origin).
export function createAgentOrganizationRouter({ organization, requireOperatorUi }) {
  const router = express.Router();
  router.use(requireOperatorUi);
  router.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin) {
      try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ success: false, error: 'ORGANIZATION_CROSS_ORIGIN_DENIED' }); }
      catch { return res.status(403).json({ success: false, error: 'ORGANIZATION_ORIGIN_INVALID' }); }
    }
    next();
  });
  const handle = run => (req, res) => {
    try { res.json({ success: true, ...run(req) }); }
    catch (error) { res.status(error.message === 'AGENT_NOT_FOUND' ? 404 : 400).json({ success: false, error: error.message }); }
  };
  router.get('/', handle(() => ({ organization: organization.snapshot() })));
  router.post('/agents', handle(req => ({ agent: organization.createAgent(req.body) })));
  router.patch('/agents/:id', handle(req => ({ agent: organization.updateProfile(req.params.id, req.body) })));
  router.put('/agents/:id/permissions/:key', handle(req => ({
    mandate: organization.setPermission(req.params.id, req.params.key, req.body?.granted === true, OPERATOR, { acceptRisk: req.body?.acceptRisk === true }),
  })));
  router.patch('/agents/:id/limits', handle(req => ({ mandate: organization.setLimits(req.params.id, req.body) })));
  router.patch('/agents/:id/traits', handle(req => ({ traits: organization.setTraits(req.params.id, req.body) })));
  router.post('/agents/:id/:status(approve|pause|resume)', handle(req => ({ agent: organization.setStatus(req.params.id, req.params.status) })));
  router.get('/agents/:id/weights', handle(req => organization.workingWeights(req.params.id)));
  return router;
}
