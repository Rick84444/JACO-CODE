import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { JobRecord } from '../queue/jobTypes.js';

export type ContractStatus = 'CLARIFYING' | 'ACTIVE' | 'ADAPTING' | 'VERIFYING' | 'FULFILLED' | 'CANCELLED';

export interface ContractEvidence {
  id: string;
  jobId: string;
  subgoalId: string | null;
  kind: string;
  observedAt: string;
  resultHash: string;
}

export interface DurableIntuitionContract {
  id: string;
  humanIntuitionGoal: string;
  clarifyingQuestionsAsked: string[];
  operatorAnswers: Record<string, string>;
  fixedRules: string[];
  status: ContractStatus;
  progressPercent: number;
  isFulfilled: boolean;
  subGoals: Array<{
    id: string;
    title: string;
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'adapted_out' | 'replaced';
    reasoning: string;
    evidenceRefs: string[];
    createdAt: string;
    updatedAt: string;
  }>;
  evidence: ContractEvidence[];
  dynamicallyCreatedSkills: Array<{ name: string; category: string; createdAt: string }>;
  generatedTools: Array<{ toolId: string; title: string; targetFile?: string; createdAt: string }>;
  evaluationHistory: Array<Record<string, unknown>>;
  schemaReminderCron: string;
  signedByOperator: boolean;
  signedAt?: string;
  createdAt: string;
  lastEvaluatedAt: string;
  fulfillmentProof?: string;
}

function atomicWrite(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

export class IntuitionContractStore {
  private filePath: string;

  constructor(workspaceRoot: string) {
    this.filePath = path.join(workspaceRoot, '.jaco', 'state', 'autonomy', 'intuition-contracts.json');
    if (!fs.existsSync(this.filePath)) atomicWrite(this.filePath, []);
  }

  list(): DurableIntuitionContract[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  get(id: string): DurableIntuitionContract | null {
    return this.list().find((contract) => contract.id === id) || null;
  }

  save(contract: DurableIntuitionContract): DurableIntuitionContract {
    const contracts = this.list();
    const index = contracts.findIndex((candidate) => candidate.id === contract.id);
    if (index >= 0) contracts[index] = contract;
    else contracts.unshift(contract);
    atomicWrite(this.filePath, contracts);
    return contract;
  }

  create(goal: string): DurableIntuitionContract {
    const humanIntuitionGoal = goal.trim();
    if (humanIntuitionGoal.length < 5 || humanIntuitionGoal.length > 10_000) throw new Error('Intuition goal must be 5-10000 characters.');
    const now = new Date().toISOString();
    return this.save({
      id: `contract-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      humanIntuitionGoal,
      clarifyingQuestionsAsked: [
        'Vilken utgående betalning eller finansiell förpliktelse kräver operatörens uttryckliga godkännande?',
        'Vilka verifierbara bevis krävs innan huvudmålet får markeras som uppnått?',
      ],
      operatorAnswers: {},
      fixedRules: [
        'Utgående betalning eller ny finansiell förpliktelse kräver uttryckligt operatörsgodkännande.',
        'Autonomin får fritt skapa, omprioritera och ersätta tekniska delmål samt använda repository, Git, shell, web, MCP, A2A, browser, desktop, skills och capabilities inom mission scope.',
        'Filmutationer ska vara verifierbara och rollbackbara där det är praktiskt möjligt; single-writer gäller för konkurrerande mutation.',
        'Huvudmålet får markeras uppnått autonomt när dess verifierbara completion contract är uppfyllt.',
        'Secrets får användas via credential providers/Vault men ska inte exponeras i loggar, prompts eller artifacts.',
      ],
      status: 'CLARIFYING',
      progressPercent: 0,
      isFulfilled: false,
      subGoals: [{
        id: `sg-baseline-${Date.now().toString(36)}`,
        title: 'Etablera verifierad nulägesbaslinje',
        description: 'Kör verklig kvalitetskontroll och bind fortsatta delmål till evidens.',
        status: 'pending',
        reasoning: 'Autonomt arbete får inte börja från fabricerad eller okänd state.',
        evidenceRefs: [],
        createdAt: now,
        updatedAt: now,
      }],
      evidence: [],
      dynamicallyCreatedSkills: [],
      generatedTools: [],
      evaluationHistory: [],
      schemaReminderCron: 'ADAPTIVE_SEER_REVIEW',
      signedByOperator: false,
      createdAt: now,
      lastEvaluatedAt: now,
    });
  }

  sign(id: string, answers: Record<string, string> = {}, rules: string[] = []): DurableIntuitionContract {
    const contract = this.get(id);
    if (!contract) throw new Error('Intuition contract not found.');
    if (contract.status === 'CANCELLED' || contract.status === 'FULFILLED') throw new Error(`Contract cannot be signed in state ${contract.status}.`);
    contract.operatorAnswers = { ...contract.operatorAnswers, ...answers };
    contract.fixedRules = [...new Set([...contract.fixedRules, ...rules.map((rule) => String(rule).trim()).filter(Boolean)])];
    contract.signedByOperator = true;
    contract.signedAt = new Date().toISOString();
    contract.lastEvaluatedAt = contract.signedAt;
    contract.status = 'ACTIVE';
    contract.subGoals = contract.subGoals.map((subgoal, index) => index === 0 ? { ...subgoal, status: 'in_progress', updatedAt: contract.signedAt! } : subgoal);
    return this.save(contract);
  }

  isActive(id: string | undefined): boolean {
    if (!id) return false;
    const contract = this.get(id);
    return Boolean(contract?.signedByOperator && ['ACTIVE', 'ADAPTING', 'VERIFYING'].includes(contract.status));
  }

  addSubgoal(id: string, input: { title: string; description?: string; reasoning?: string }): DurableIntuitionContract {
    const contract = this.get(id);
    if (!contract || !this.isActive(id)) throw new Error('An active signed Intuition Contract is required.');
    if (contract.subGoals.length >= 200) throw new Error('Contract subgoal limit reached; adapt or replace an existing subgoal.');
    const title = String(input.title || '').trim();
    if (title.length < 5 || title.length > 1_000) throw new Error('Subgoal title must be 5-1000 characters.');
    const now = new Date().toISOString();
    contract.subGoals.push({
      id: `sg-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      title,
      description: String(input.description || title).trim().slice(0, 5_000),
      status: 'pending',
      reasoning: String(input.reasoning || 'Created autonomously because it contributes to the immutable intuition goal.').trim().slice(0, 5_000),
      evidenceRefs: [],
      createdAt: now,
      updatedAt: now,
    });
    contract.status = 'ADAPTING';
    contract.lastEvaluatedAt = now;
    return this.save(contract);
  }

  recordVerifiedJob(job: JobRecord, result: any): void {
    const contractId = typeof job.payload?.contractId === 'string' ? job.payload.contractId : null;
    if (!contractId || result?.evidence?.state !== 'VERIFIED') return;
    const contract = this.get(contractId);
    if (!contract || !this.isActive(contractId)) return;
    const subgoalId = typeof job.payload?.subgoalId === 'string' ? job.payload.subgoalId : null;
    const serialized = JSON.stringify(result);
    const resultHash = `sha256:${crypto.createHash('sha256').update(serialized).digest('hex')}`;
    if (contract.evidence.some((evidence) => evidence.jobId === job.id && evidence.resultHash === resultHash)) return;
    const evidence: ContractEvidence = {
      id: `evidence-${crypto.randomUUID()}`,
      jobId: job.id,
      subgoalId,
      kind: String(result.evidence.kind || job.type),
      observedAt: String(result.evidence.observedAt || new Date().toISOString()),
      resultHash,
    };
    contract.evidence.push(evidence);
    if (subgoalId && result.qualityGatePassed !== false) {
      contract.subGoals = contract.subGoals.map((subgoal) => subgoal.id === subgoalId
        ? { ...subgoal, status: 'completed', evidenceRefs: [...new Set([...subgoal.evidenceRefs, evidence.id])], updatedAt: new Date().toISOString() }
        : subgoal);
    }
    this.evaluate(contract);
  }

  evaluate(contractOrId: DurableIntuitionContract | string): DurableIntuitionContract {
    const contract = typeof contractOrId === 'string' ? this.get(contractOrId) : contractOrId;
    if (!contract) throw new Error('Intuition contract not found.');
    const relevant = contract.subGoals.filter((subgoal) => !['adapted_out', 'replaced'].includes(subgoal.status));
    const completed = relevant.filter((subgoal) => subgoal.status === 'completed' && subgoal.evidenceRefs.length > 0).length;
    const measured = relevant.length > 0 ? Math.round((completed / relevant.length) * 100) : 0;
    contract.progressPercent = Math.min(95, measured);
    contract.status = measured === 100 ? 'VERIFYING' : contract.signedByOperator ? 'ADAPTING' : 'CLARIFYING';
    contract.lastEvaluatedAt = new Date().toISOString();
    contract.evaluationHistory.unshift({
      id: `eval-${crypto.randomUUID()}`,
      timestamp: contract.lastEvaluatedAt,
      isFulfilledAccordingToSchema: false,
      evaluationOpinion: measured === 100 ? 'All current subgoals have evidence; final goal verification remains.' : `${completed}/${relevant.length} subgoals have bound evidence.`,
      rationaleForTaskSelection: 'Progress is derived only from completed subgoals with VERIFIED worker receipts.',
      adaptedGoalsCount: relevant.length,
      evidenceFound: contract.evidence.map((evidence) => evidence.id),
    });
    contract.evaluationHistory = contract.evaluationHistory.slice(0, 200);
    return this.save(contract);
  }

  fulfill(id: string, proof: string): DurableIntuitionContract {
    const contract = this.evaluate(id);
    if (contract.status !== 'VERIFYING' || contract.progressPercent < 95) throw new Error('All current subgoals must have verified evidence before fulfillment.');
    if (proof.trim().length < 20) throw new Error('A concrete fulfillment proof is required.');
    contract.isFulfilled = true;
    contract.status = 'FULFILLED';
    contract.progressPercent = 100;
    contract.fulfillmentProof = proof.trim();
    contract.lastEvaluatedAt = new Date().toISOString();
    return this.save(contract);
  }
}
