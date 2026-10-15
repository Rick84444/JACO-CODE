import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

export type SeerLivePhase = 'IDLE' | 'OBSERVING' | 'PLANNING' | 'EXECUTING' | 'VERIFYING' | 'DEGRADED';
export type SeerActiveModule =
  | 'SEER'
  | 'Foundry'
  | 'Nova'
  | 'Aura'
  | 'MissionBus'
  | 'Worker'
  | 'Hypothesis'
  | 'WordPress/Web'
  | 'A2A'
  | 'Nova/Hands-Off'
  | 'Android bridge'
  | 'DesktopHandsOff'
  | 'BrowserHandsOff'
  | 'ModelRelay'
  | 'AutonomyContract'
  | 'UNAVAILABLE';

export interface SeerLiveEvent {
  id: string;
  at: string;
  type: string;
  actor: string;
  message: string;
  verified: boolean;
  receipt?: unknown;
}

export interface SeerLiveState {
  schemaVersion: 1;
  phase: SeerLivePhase;
  primaryGoal: string | null;
  subgoal: string | null;
  activeModule: SeerActiveModule;
  provider: string | null;
  model: string | null;
  cycle: number;
  iteration: number;
  workers: { active: number; max: number };
  toolsSkills: string[];
  blocker: string | null;
  drift: number | null;
  latestVerifiedProgress: string | null;
  nextCycleAt: string | null;
  action: {
    surface: 'ANDROID' | 'DESKTOP' | 'BROWSER' | 'NONE';
    type: string | null;
    status: 'WAITING' | 'EXECUTING' | 'VERIFYING' | 'VERIFIED' | 'REJECTED' | 'NONE';
  };
  evidenceState: 'UNVERIFIED' | 'OBSERVED' | 'DEGRADED';
  events: SeerLiveEvent[];
  updatedAt: string;
}

const initial = (): SeerLiveState => ({
  schemaVersion: 1,
  phase: 'IDLE',
  primaryGoal: null,
  subgoal: null,
  activeModule: 'UNAVAILABLE',
  provider: null,
  model: null,
  cycle: 0,
  iteration: 0,
  workers: { active: 0, max: 0 },
  toolsSkills: [],
  blocker: null,
  drift: null,
  latestVerifiedProgress: null,
  nextCycleAt: null,
  action: { surface: 'NONE', type: null, status: 'NONE' },
  evidenceState: 'UNVERIFIED',
  events: [],
  updatedAt: new Date().toISOString(),
});

class SeerLiveWorkstream extends EventEmitter {
  private state: SeerLiveState = initial();

  snapshot(): SeerLiveState {
    return structuredClone(this.state);
  }

  update(patch: Partial<Omit<SeerLiveState, 'schemaVersion' | 'events' | 'updatedAt'>>): SeerLiveState {
    this.state = {
      ...this.state,
      ...patch,
      workers: patch.workers ? { ...patch.workers } : this.state.workers,
      action: patch.action ? { ...patch.action } : this.state.action,
      toolsSkills: patch.toolsSkills ? [...new Set(patch.toolsSkills.map(String))].slice(0, 30) : this.state.toolsSkills,
      updatedAt: new Date().toISOString(),
    };
    this.emit('state', this.snapshot());
    return this.snapshot();
  }

  record(event: Omit<SeerLiveEvent, 'id' | 'at'> & { at?: string }): SeerLiveEvent {
    const item: SeerLiveEvent = {
      id: crypto.randomUUID(),
      at: event.at || new Date().toISOString(),
      type: event.type,
      actor: event.actor,
      message: event.message,
      verified: event.verified === true,
      ...(event.receipt !== undefined ? { receipt: event.receipt } : {}),
    };
    this.state.events = [...this.state.events, item].slice(-100);
    if (item.verified) {
      this.state.latestVerifiedProgress = item.message;
      this.state.evidenceState = 'OBSERVED';
    }
    this.state.updatedAt = new Date().toISOString();
    this.emit('event', item);
    this.emit('state', this.snapshot());
    return item;
  }

  beginCycle(input: { cycle: number; primaryGoal?: string | null; subgoal?: string | null; drift?: number | null; workers?: { active: number; max: number } }): void {
    this.update({
      phase: 'OBSERVING',
      activeModule: 'SEER',
      cycle: input.cycle,
      iteration: input.cycle,
      primaryGoal: input.primaryGoal ?? this.state.primaryGoal,
      subgoal: input.subgoal ?? this.state.subgoal,
      drift: input.drift ?? this.state.drift,
      workers: input.workers ?? this.state.workers,
      blocker: null,
    });
    this.record({ actor: 'SEER', type: 'seer.cycle.started', message: `SEER cycle ${input.cycle} started`, verified: true });
  }

  degrade(message: string, module: SeerActiveModule = 'SEER'): void {
    this.update({ phase: 'DEGRADED', activeModule: module, blocker: message, evidenceState: 'DEGRADED' });
    this.record({ actor: module, type: 'runtime.degraded', message, verified: true });
  }
}

export const seerLiveWorkstream = new SeerLiveWorkstream();
