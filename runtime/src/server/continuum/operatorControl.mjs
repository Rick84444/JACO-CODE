import path from 'node:path';
import { atomicWriteJson, readJson, nowIso } from './util.mjs';

export class OperatorControl {
  constructor(root, events) {
    this.file = path.join(root, 'operator-control.json');
    this.events = events;
    this.state = readJson(this.file, {
      mode: 'RUNNING', emergencyLatched: false, reason: null,
      changedAt: nowIso(), changedBy: 'system', generation: 1,
    });
  }

  snapshot() { return structuredClone(this.state); }

  assertExecutionAllowed() {
    if (this.state.emergencyLatched) throw new Error('EMERGENCY_STOP_LATCHED');
    if (this.state.mode !== 'RUNNING') throw new Error(`RUNTIME_${this.state.mode}`);
  }

  pause(actor = 'operator', reason = 'operator pause') {
    if (this.state.emergencyLatched) throw new Error('Emergency stop is latched; use operator reset before resume');
    return this.#set('PAUSED', false, actor, reason, 'operator.paused');
  }

  resume(actor = 'operator', reason = 'operator resume') {
    if (this.state.emergencyLatched) throw new Error('Emergency stop is latched; reset is required');
    return this.#set('RUNNING', false, actor, reason, 'operator.resumed');
  }

  emergencyStop(actor = 'operator', reason = 'operator emergency stop') {
    return this.#set('STOPPED', true, actor, reason, 'operator.emergency_stop');
  }

  resetEmergency(actor = 'operator', reason = 'operator reset emergency latch') {
    if (!this.state.emergencyLatched) return this.snapshot();
    return this.#set('PAUSED', false, actor, reason, 'operator.emergency_reset');
  }

  #set(mode, emergencyLatched, actor, reason, type) {
    this.state = {
      mode, emergencyLatched, reason: String(reason || '').slice(0, 500),
      changedAt: nowIso(), changedBy: String(actor || 'operator').slice(0, 120),
      generation: Number(this.state.generation || 0) + 1,
    };
    atomicWriteJson(this.file, this.state);
    this.events.append({ stream: 'operator', type, actor, data: this.state });
    return this.snapshot();
  }
}
