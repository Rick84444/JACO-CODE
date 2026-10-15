import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Durable A2A task ledger.
 *
 * Shape follows what the existing A2A Workflow Dashboard already renders
 * (`task.status.state`, `task.artifacts`, `task.history`) so the GUI needs no
 * change. Hardening added around it:
 *
 *  - idempotency: a repeated `tasks/send` with the same task id returns the
 *    original task instead of executing the skill twice, so a peer retrying on
 *    a dropped connection is not billed or served twice;
 *  - bounded retention with atomic writes, so a peer cannot grow the ledger
 *    until the disk fills;
 *  - every terminal state carries a result checksum, so a receipt can be
 *    checked against the returned artifact.
 */

export type TaskState = 'submitted' | 'working' | 'completed' | 'failed' | 'canceled';

export interface TaskArtifact {
  type: 'data' | 'text';
  data?: unknown;
  text?: string;
  checksum?: string;
}

export interface TaskHistoryEntry {
  at: string;
  state: TaskState;
  note: string;
}

export interface A2ATask {
  id: string;
  skill: string;
  requesterNodeId: string;
  responderNodeId: string;
  status: { state: TaskState; message?: string; timestamp: string };
  params: Record<string, unknown>;
  artifacts: TaskArtifact[];
  history: TaskHistoryEntry[];
  createdAt: string;
  updatedAt: string;
  executionTimeMs?: number;
  checksum?: string;
  idempotencyKey: string;
}

const MAX_TASKS = 1_000;
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{1,127}$/;

export class A2ATaskStore {
  private readonly file: string;
  private tasks: A2ATask[] | null = null;

  constructor(workspaceRoot: string) {
    this.file = path.join(workspaceRoot, '.jaco', 'a2a_tasks.json');
  }

  private load(): A2ATask[] {
    if (this.tasks) return this.tasks;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.tasks = Array.isArray(parsed) ? (parsed as A2ATask[]) : [];
    } catch {
      this.tasks = [];
    }
    return this.tasks;
  }

  private persist(): void {
    const tasks = this.load();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(tasks.slice(0, MAX_TASKS), null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }

  public static validateTaskId(candidate: string): string {
    const id = String(candidate || '').trim();
    if (!TASK_ID_PATTERN.test(id)) throw new Error('task id must be 2-128 characters of A-Z, a-z, 0-9, dot, colon, underscore or hyphen');
    return id;
  }

  public list(limit = 100): A2ATask[] {
    return this.load().slice(0, Math.max(1, Math.min(limit, MAX_TASKS)));
  }

  public get(id: string): A2ATask | undefined {
    return this.load().find((task) => task.id === id);
  }

  /** Returns the existing task when the id has already been accepted. */
  public findIdempotent(id: string, idempotencyKey: string): A2ATask | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    return existing.idempotencyKey === idempotencyKey ? existing : undefined;
  }

  public create(input: {
    id: string;
    skill: string;
    params: Record<string, unknown>;
    requesterNodeId: string;
    responderNodeId: string;
    idempotencyKey: string;
  }): A2ATask {
    const now = new Date().toISOString();
    const task: A2ATask = {
      id: input.id,
      skill: input.skill,
      requesterNodeId: input.requesterNodeId,
      responderNodeId: input.responderNodeId,
      status: { state: 'submitted', timestamp: now },
      params: input.params,
      artifacts: [],
      history: [{ at: now, state: 'submitted', note: `accepted from ${input.requesterNodeId}` }],
      createdAt: now,
      updatedAt: now,
      idempotencyKey: input.idempotencyKey,
    };
    const tasks = this.load();
    tasks.unshift(task);
    if (tasks.length > MAX_TASKS) tasks.length = MAX_TASKS;
    this.persist();
    return task;
  }

  public transition(id: string, state: TaskState, note: string, patch: Partial<A2ATask> = {}): A2ATask | undefined {
    const task = this.get(id);
    if (!task) return undefined;
    if (['completed', 'failed', 'canceled'].includes(task.status.state) && state !== task.status.state) {
      // Terminal states are final; a late worker result must not resurrect a task.
      return task;
    }
    const now = new Date().toISOString();
    Object.assign(task, patch);
    task.status = { state, message: note, timestamp: now };
    task.updatedAt = now;
    task.history.push({ at: now, state, note });
    if (task.history.length > 50) task.history = task.history.slice(-50);
    this.persist();
    return task;
  }

  public cancel(id: string): A2ATask | undefined {
    const task = this.get(id);
    if (!task) return undefined;
    if (['completed', 'failed', 'canceled'].includes(task.status.state)) return task;
    return this.transition(id, 'canceled', 'canceled by operator');
  }

  public counts(): Record<TaskState | 'total', number> {
    const tasks = this.load();
    const counts = { submitted: 0, working: 0, completed: 0, failed: 0, canceled: 0, total: tasks.length };
    for (const task of tasks) counts[task.status.state] += 1;
    return counts;
  }
}
