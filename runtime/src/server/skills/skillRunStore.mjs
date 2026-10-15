import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

export class SkillRunStore {
  constructor(root) {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true });
  }

  create({ skillId, version, input, runId = null, parentRunId = null }) {
    const id = runId || ('skillrun-' + Date.now() + '-' + crypto.randomBytes(5).toString('hex'));
    if (this.exists(id)) throw new Error('SKILL_RUN_ALREADY_EXISTS:' + id);
    const now = new Date().toISOString();
    const state = {
      schema: 'jaco.skill.run.v1',
      id,
      skillId,
      version,
      parentRunId,
      status: 'RUNNING',
      input,
      completedSteps: [],
      stepOutputs: {},
      createdAt: now,
      updatedAt: now,
      metrics: { toolCalls: 0, modelCalls: 0, scriptCalls: 0, childSkills: 0, retries: 0 },
      result: null,
      error: null,
    };
    this.save(state);
    this.append(id, { type: 'run.created', skillId, version });
    return state;
  }

  exists(id) {
    return fs.existsSync(this.stateFile(id));
  }

  load(id) {
    return JSON.parse(fs.readFileSync(this.stateFile(id), 'utf8'));
  }

  save(state) {
    state.updatedAt = new Date().toISOString();
    atomicJson(this.stateFile(state.id), state);
    return state;
  }

  checkpoint(id, stepId, output, metric = null) {
    const state = this.load(id);
    if (!state.completedSteps.includes(stepId)) state.completedSteps.push(stepId);
    state.stepOutputs[stepId] = output;
    if (metric && Object.prototype.hasOwnProperty.call(state.metrics, metric)) state.metrics[metric]++;
    state.status = 'RUNNING';
    state.error = null;
    this.save(state);
    this.append(id, { type: 'step.completed', stepId, metric });
    return state;
  }

  fail(id, error, stepId = null) {
    const state = this.load(id);
    state.status = 'FAILED';
    state.error = String(error instanceof Error ? error.message : error);
    state.metrics.retries += 1;
    this.save(state);
    this.append(id, { type: 'run.failed', stepId, error: state.error });
    return state;
  }

  complete(id, result) {
    const state = this.load(id);
    state.status = 'COMPLETED';
    state.result = result;
    state.error = null;
    this.save(state);
    this.append(id, { type: 'run.completed' });
    return state;
  }

  append(id, event) {
    const folder = this.folder(id);
    fs.mkdirSync(folder, { recursive: true });
    fs.appendFileSync(path.join(folder, 'events.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n', { encoding: 'utf8', mode: 0o600 });
  }

  folder(id) {
    const safe = String(id).replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(this.root, safe);
  }

  stateFile(id) {
    return path.join(this.folder(id), 'state.json');
  }
}
