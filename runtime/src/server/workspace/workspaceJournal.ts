/**
 * JACO Workspace Journal 1.0
 * Durable, append-only events.ndjson store with cryptographic SHA-256 hash chains,
 * schema versioning (jaco.workspace.v1), sequence counters, and state reduction.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface WorkspaceEvent {
  sequence: number;
  generation: number;
  schemaVersion: string;
  schemaHash: string;
  eventId: string;
  timestamp: string;
  actor: string;
  kind:
    | 'GOAL_DEFINED'
    | 'MISSION_STARTED'
    | 'ACTION_REQUEST'
    | 'ACTION_EXECUTED'
    | 'ACTION_VERIFIED'
    | 'ACTION_FAILED'
    | 'CAPABILITY_CREATED'
    | 'CAPABILITY_INVALIDATED'
    | 'FINDING_RECORDED'
    | 'EVIDENCE_RECORDED'
    | 'CHECKPOINT_CREATED'
    | 'RUNTIME_STATE_CHANGED'
    | 'PEER_ACK'
    | 'CHANGESET_COMMITTED'
    | 'JOURNEY_EXECUTED';
  priority: 'NORMAL' | 'HIGH' | 'CRITICAL';
  wake: boolean;
  target?: string;
  payload: Record<string, any>;
  prevEventHash: string;
  eventHash: string;
}

export interface QuarantineReport {
  id: string;
  timestamp: string;
  quarantineFile: string;
  quarantinedCount: number;
  reason: string;
  retainedValidPrefixCount: number;
}

export interface WorkspaceState {
  workspace: string;
  schemaVersion: string;
  schemaHash: string;
  generation: number;
  lastSequence: number;
  stateHash: string;
  activeGoal?: {
    id: string;
    title: string;
    desiredOutcome: string;
    constraints: string[];
    fixedConstraints?: string[];
    completionCriteria: string[];
    autonomyTier: string;
  };
  activeMissions: Array<{
    id: string;
    title: string;
    state: string;
    checkpointSequence: number;
  }>;
  capabilities: Array<{
    id: string;
    name: string;
    version: string;
    status: 'VERIFIED' | 'EXPERIMENTAL' | 'DEPRECATED' | 'UNAVAILABLE';
    executionTarget: string;
  }>;
  findings: Array<{
    id: string;
    author: string;
    summary: string;
    evidenceHash?: string;
    timestamp: string;
  }>;
  checkpoints: Array<{
    id: string;
    sequence: number;
    missionId: string;
    stateDigest: string;
    timestamp: string;
  }>;
  recentChangesets: Array<{
    id: string;
    intent: string;
    status: 'COMMITTED' | 'ROLLED_BACK';
    filesChanged: number;
    timestamp: string;
  }>;
}

export class WorkspaceJournal {
  private static instance: WorkspaceJournal;
  private readonly storageDir: string;
  private readonly journalFile: string;
  private readonly schemaVersion = 'jaco.workspace.v1';
  private readonly schemaHash: string;

  private events: WorkspaceEvent[] = [];
  private sequenceCounter: number = 0;
  private currentGeneration: number = 1;
  private listeners: Set<(event: WorkspaceEvent) => void> = new Set();
  private quarantineHistory: QuarantineReport[] = [];

  private reducedState: WorkspaceState;

  private constructor() {
    this.storageDir = path.join(process.cwd(), '.jaco', 'workspace');
    this.journalFile = path.join(this.storageDir, 'events.ndjson');

    // Calculate schema hash deterministically
    this.schemaHash = crypto
      .createHash('sha256')
      .update(this.schemaVersion + '-core-types-v1.0')
      .digest('hex')
      .substring(0, 16);

    this.reducedState = this.getInitialState();
    this.initStorage();
    this.replayFromDisk();
  }

  public static getInstance(): WorkspaceJournal {
    if (!WorkspaceJournal.instance) {
      WorkspaceJournal.instance = new WorkspaceJournal();
    }
    return WorkspaceJournal.instance;
  }

  private getInitialState(): WorkspaceState {
    return {
      workspace: 'jaco-main',
      schemaVersion: this.schemaVersion,
      schemaHash: this.schemaHash,
      generation: this.currentGeneration,
      lastSequence: 0,
      stateHash: crypto.createHash('sha256').update('init').digest('hex').substring(0, 16),
      activeMissions: [],
      capabilities: [
        {
          id: 'android.torch.set',
          name: 'Android Torch Control',
          version: '1.0.0',
          status: 'EXPERIMENTAL',
          executionTarget: 'NATIVE_ANDROID_API'
        },
        {
          id: 'code.ast.verify',
          name: 'Deterministic AST Verifier',
          version: '1.0.0',
          status: 'VERIFIED',
          executionTarget: 'LOCAL_VM'
        },
        {
          id: 'site.deploy.verify',
          name: 'Site Deployment Verifier',
          version: '1.0.0',
          status: 'EXPERIMENTAL',
          executionTarget: 'OPERATOR_HTTP'
        }
      ],
      findings: [],
      checkpoints: [],
      recentChangesets: []
    };
  }

  private initStorage(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  public computeEventHash(
    sequence: number,
    generation: number,
    actor: string,
    kind: string,
    payload: Record<string, any>,
    prevEventHash: string
  ): string {
    const hashContent = `${sequence}:${generation}:${actor}:${kind}:${JSON.stringify(payload)}:${prevEventHash}`;
    return crypto.createHash('sha256').update(hashContent).digest('hex');
  }

  private replayFromDisk(): void {
    if (!fs.existsSync(this.journalFile)) {
      // Seed first genesis event
      this.appendEvent({
        actor: 'jaco-kernel',
        kind: 'RUNTIME_STATE_CHANGED',
        priority: 'NORMAL',
        wake: false,
        payload: {
          status: 'READY',
          message: 'JACO Workspace Journal Initialized'
        }
      });
      return;
    }

    try {
      const raw = fs.readFileSync(this.journalFile, 'utf-8');
      const lines = raw.split('\n').filter(l => l.trim().length > 0);

      this.events = [];
      const validEvents: WorkspaceEvent[] = [];
      const invalidLines: string[] = [];
      let expectedSeq = 1;
      let prevHash = '0000000000000000';
      let corrupted = false;
      let corruptReason = '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (corrupted) {
          invalidLines.push(line);
          continue;
        }

        try {
          const ev: WorkspaceEvent = JSON.parse(line);

          // Sequence continuity check
          if (ev.sequence !== expectedSeq) {
            corrupted = true;
            corruptReason = `Sequence gap at line ${i + 1}: expected ${expectedSeq}, got ${ev.sequence}`;
            invalidLines.push(line);
            continue;
          }

          // Hash chain check
          if (ev.prevEventHash !== prevHash) {
            corrupted = true;
            corruptReason = `Hash chain break at sequence ${ev.sequence}: prevEventHash mismatch`;
            invalidLines.push(line);
            continue;
          }

          const expectedHash = this.computeEventHash(
            ev.sequence,
            ev.generation,
            ev.actor,
            ev.kind,
            ev.payload,
            ev.prevEventHash
          );

          if (ev.eventHash !== expectedHash) {
            corrupted = true;
            corruptReason = `Event hash mismatch at sequence ${ev.sequence}`;
            invalidLines.push(line);
            continue;
          }

          validEvents.push(ev);
          expectedSeq = ev.sequence + 1;
          prevHash = ev.eventHash;
          if (ev.generation > this.currentGeneration) {
            this.currentGeneration = ev.generation;
          }
        } catch (parseErr: any) {
          corrupted = true;
          corruptReason = `JSON parse error at line ${i + 1}: ${parseErr.message}`;
          invalidLines.push(line);
        }
      }

      // If corrupted tail found, quarantine it
      if (corrupted && invalidLines.length > 0) {
        const timestamp = Date.now();
        const quarantineFileName = `quarantine_events_${timestamp}.ndjson`;
        const quarantinePath = path.join(this.storageDir, quarantineFileName);

        fs.writeFileSync(quarantinePath, invalidLines.join('\n') + '\n', 'utf-8');

        // Rewrite journal file with ONLY valid prefix
        const validContent = validEvents.map(e => JSON.stringify(e)).join('\n') + (validEvents.length > 0 ? '\n' : '');
        fs.writeFileSync(this.journalFile, validContent, 'utf-8');

        const report: QuarantineReport = {
          id: `quarantine-${timestamp}`,
          timestamp: new Date().toISOString(),
          quarantineFile: quarantineFileName,
          quarantinedCount: invalidLines.length,
          reason: corruptReason,
          retainedValidPrefixCount: validEvents.length
        };
        this.quarantineHistory.unshift(report);
        console.warn(`[WorkspaceJournal] Quarantined ${invalidLines.length} invalid events: ${corruptReason}`);
      }

      // Reconstruct reduced state from valid events
      this.reducedState = this.getInitialState();
      this.events = validEvents;
      for (const ev of this.events) {
        this.reduceEvent(ev);
      }

      const lastSeq = this.events.length > 0 ? this.events[this.events.length - 1].sequence : 0;
      this.sequenceCounter = lastSeq;
      this.reducedState.lastSequence = lastSeq;
      this.reducedState.generation = this.currentGeneration;
      this.reducedState.stateHash = this.computeStateHash();
    } catch (err: any) {
      console.error('[WorkspaceJournal] Failed to replay disk journal:', err.message);
    }
  }

  public appendEvent(params: {
    actor: string;
    kind: WorkspaceEvent['kind'];
    priority?: WorkspaceEvent['priority'];
    wake?: boolean;
    target?: string;
    payload: Record<string, any>;
  }): WorkspaceEvent {
    const nextSeq = this.sequenceCounter + 1;
    const now = new Date().toISOString();
    const eventId = `ev-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const prevEvent = this.events[this.events.length - 1];
    const prevEventHash = prevEvent ? prevEvent.eventHash : '0000000000000000';

    const eventHash = this.computeEventHash(
      nextSeq,
      this.currentGeneration,
      params.actor,
      params.kind,
      params.payload,
      prevEventHash
    );

    const event: WorkspaceEvent = {
      sequence: nextSeq,
      generation: this.currentGeneration,
      schemaVersion: this.schemaVersion,
      schemaHash: this.schemaHash,
      eventId,
      timestamp: now,
      actor: params.actor,
      kind: params.kind,
      priority: params.priority || 'NORMAL',
      wake: params.wake ?? false,
      target: params.target,
      payload: params.payload,
      prevEventHash,
      eventHash
    };

    // Durability-first: append to file BEFORE advancing memory state
    try {
      fs.appendFileSync(this.journalFile, JSON.stringify(event) + '\n', 'utf-8');
    } catch (err: any) {
      console.error('[WorkspaceJournal] Disk append error, rejecting in-memory commit:', err.message);
      throw new Error(`Workspace journal disk write failed: ${err.message}`);
    }

    this.sequenceCounter = nextSeq;
    this.events.push(event);
    this.reduceEvent(event);

    // Notify live subscribers
    this.listeners.forEach(cb => {
      try {
        cb(event);
      } catch (err: any) {
        console.error('[WorkspaceJournal] Listener notification error:', err.message);
      }
    });

    return event;
  }

  private reduceEvent(ev: WorkspaceEvent): void {
    this.reducedState.lastSequence = ev.sequence;

    switch (ev.kind) {
      case 'GOAL_DEFINED':
        {
          const constraints = ev.payload.fixedConstraints || ev.payload.constraints || [];
          this.reducedState.activeGoal = {
            id: ev.payload.id || `goal-${ev.sequence}`,
            title: ev.payload.title || 'Untitled Goal',
            desiredOutcome: ev.payload.desiredOutcome || ev.payload.outcome || '',
            constraints: Array.isArray(constraints) ? constraints : [String(constraints)],
            fixedConstraints: Array.isArray(constraints) ? constraints : [String(constraints)],
            completionCriteria: Array.isArray(ev.payload.completionCriteria) ? ev.payload.completionCriteria : [],
            autonomyTier: ev.payload.autonomyTier || 'HIGH'
          };
          this.currentGeneration += 1;
          this.reducedState.generation = this.currentGeneration;
        }
        break;

      case 'MISSION_STARTED':
        this.reducedState.activeMissions.push({
          id: ev.payload.missionId || `mission-${ev.sequence}`,
          title: ev.payload.title || 'Mission',
          state: 'RUNNING',
          checkpointSequence: ev.sequence
        });
        break;

      case 'ACTION_VERIFIED':
        if (ev.payload.missionId) {
          const m = this.reducedState.activeMissions.find(x => x.id === ev.payload.missionId);
          if (m) m.checkpointSequence = ev.sequence;
        }
        break;

      case 'CAPABILITY_CREATED':
        if (ev.payload.capability) {
          const cap = ev.payload.capability;
          const idx = this.reducedState.capabilities.findIndex(c => c.id === cap.id);
          if (idx !== -1) {
            this.reducedState.capabilities[idx] = cap;
          } else {
            this.reducedState.capabilities.push(cap);
          }
          this.currentGeneration += 1;
          this.reducedState.generation = this.currentGeneration;
        }
        break;

      case 'CAPABILITY_INVALIDATED':
        if (ev.payload.capabilityId) {
          this.reducedState.capabilities = this.reducedState.capabilities.filter(
            c => c.id !== ev.payload.capabilityId
          );
          this.currentGeneration += 1;
          this.reducedState.generation = this.currentGeneration;
        }
        break;

      case 'FINDING_RECORDED':
        this.reducedState.findings.unshift({
          id: ev.payload.id || `find-${ev.sequence}`,
          author: ev.actor,
          summary: ev.payload.summary || '',
          evidenceHash: ev.payload.evidenceHash,
          timestamp: ev.timestamp
        });
        if (this.reducedState.findings.length > 50) {
          this.reducedState.findings.pop();
        }
        break;

      case 'CHECKPOINT_CREATED':
        this.reducedState.checkpoints.unshift({
          id: ev.payload.id || `cp-${ev.sequence}`,
          sequence: ev.sequence,
          missionId: ev.payload.missionId || '',
          stateDigest: ev.payload.stateDigest || '',
          timestamp: ev.timestamp
        });
        if (this.reducedState.checkpoints.length > 20) {
          this.reducedState.checkpoints.pop();
        }
        break;

      case 'CHANGESET_COMMITTED':
        this.reducedState.recentChangesets.unshift({
          id: ev.payload.changesetId || `cs-${ev.sequence}`,
          intent: ev.payload.intent || '',
          status: ev.payload.status || 'COMMITTED',
          filesChanged: ev.payload.filesChanged || 0,
          timestamp: ev.timestamp
        });
        if (this.reducedState.recentChangesets.length > 20) {
          this.reducedState.recentChangesets.pop();
        }
        break;
    }

    this.reducedState.stateHash = this.computeStateHash();
  }

  private computeStateHash(): string {
    const raw = `${this.reducedState.lastSequence}:${this.reducedState.generation}:${this.reducedState.activeGoal?.id}:${this.reducedState.capabilities.length}:${this.reducedState.findings.length}`;
    return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 16);
  }

  public validateChain(): { valid: boolean; count: number; headHash: string; errors: string[] } {
    const errors: string[] = [];
    let prevHash = '0000000000000000';

    for (let i = 0; i < this.events.length; i++) {
      const ev = this.events[i];
      if (ev.sequence !== i + 1) {
        errors.push(`Sequence mismatch at index ${i}: event has ${ev.sequence}, expected ${i + 1}`);
      }
      if (ev.prevEventHash !== prevHash) {
        errors.push(`PrevHash mismatch at sequence ${ev.sequence}`);
      }
      const expHash = this.computeEventHash(
        ev.sequence,
        ev.generation,
        ev.actor,
        ev.kind,
        ev.payload,
        ev.prevEventHash
      );
      if (ev.eventHash !== expHash) {
        errors.push(`Event hash mismatch at sequence ${ev.sequence}`);
      }
      prevHash = ev.eventHash;
    }

    return {
      valid: errors.length === 0,
      count: this.events.length,
      headHash: prevHash,
      errors
    };
  }

  public getEventsAfter(afterSequence: number, limit: number = 100): WorkspaceEvent[] {
    return this.events.filter(e => e.sequence > afterSequence).slice(0, limit);
  }

  public getLatestSequence(): number {
    return this.sequenceCounter;
  }

  public getGeneration(): number {
    return this.currentGeneration;
  }

  public getSchemaVersion(): string {
    return this.schemaVersion;
  }

  public getSchemaHash(): string {
    return this.schemaHash;
  }

  public getQuarantineHistory(): QuarantineReport[] {
    return [...this.quarantineHistory];
  }

  public getState(): WorkspaceState {
    return {
      ...this.reducedState,
      generation: this.currentGeneration,
      lastSequence: this.sequenceCounter,
      stateHash: this.computeStateHash()
    };
  }

  public subscribe(cb: (event: WorkspaceEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

export const workspaceJournal = WorkspaceJournal.getInstance();
