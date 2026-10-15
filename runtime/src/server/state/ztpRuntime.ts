import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// ==========================================
// 1. LATTICES (Djup Immutabilitet & CRDTs)
// ==========================================

export interface JoinSemilattice<T> {
  join(other: JoinSemilattice<T>): JoinSemilattice<T>;
  getValue(): T;
}

export class EpochRegister implements JoinSemilattice<any> {
  constructor(
    public readonly value: any,
    public readonly generation: { epoch: number; counter: number; nodeId: string }
  ) {}

  getValue() {
    return this.value;
  }

  join(other: EpochRegister): EpochRegister {
    const { epoch: e1, counter: c1, nodeId: n1 } = this.generation;
    const { epoch: e2, counter: c2, nodeId: n2 } = other.generation;

    // Lexikografisk jämförelse av klockan
    if (e2 > e1 || (e2 === e1 && c2 > c1) || (e2 === e1 && c2 === c1 && n2 > n1)) {
      return other;
    }
    if (e1 > e2 || (e1 === e2 && c1 > c2) || (e1 === e2 && c1 === c2 && n1 > n2)) {
      return this;
    }

    // Deterministisk tie-breaker via SHA-256 om klockorna av någon anledning är exakt lika
    const hashSelf = crypto.createHash('sha256').update(JSON.stringify(this.value)).digest('hex');
    const hashOther = crypto.createHash('sha256').update(JSON.stringify(other.value)).digest('hex');
    
    return hashSelf >= hashOther ? this : other;
  }
}

export class ProductLattice implements JoinSemilattice<Record<string, JoinSemilattice<any>>> {
  constructor(public readonly fields: Readonly<Record<string, JoinSemilattice<any>>> = {}) {}

  getValue() {
    return this.fields;
  }

  join(other: ProductLattice): ProductLattice {
    const merged = { ...this.fields };
    for (const [k, v] of Object.entries(other.fields)) {
      if (merged[k]) {
        merged[k] = merged[k].join(v as any);
      } else {
        merged[k] = v;
      }
    }
    return new ProductLattice(merged);
  }
}

// ==========================================
// 2. FRONTIER (Gap-Aware Causal Tracking)
// ==========================================

export class CausalState {
  constructor(
    public readonly contiguousSeq: number = 0,
    public readonly gapSet: ReadonlySet<number> = new Set()
  ) {}

  observe(seq: number): CausalState {
    if (seq <= this.contiguousSeq || this.gapSet.has(seq)) {
      return this;
    }

    if (seq === this.contiguousSeq + 1) {
      let newSeq = seq;
      const newGaps = new Set(this.gapSet);
      while (newGaps.has(newSeq + 1)) {
        newSeq += 1;
        newGaps.delete(newSeq);
      }
      return new CausalState(newSeq, newGaps);
    }

    const newGaps = new Set(this.gapSet);
    newGaps.add(seq);
    return new CausalState(this.contiguousSeq, newGaps);
  }
}

export class VectorClock {
  constructor(public readonly clock: Readonly<Record<string, CausalState>> = {}) {}

  advance(nodeId: string, seq: number): VectorClock {
    const currentState = this.clock[nodeId] || new CausalState();
    return new VectorClock({
      ...this.clock,
      [nodeId]: currentState.observe(seq)
    });
  }
}

// ==========================================
// 3. STORAGE (Agent-Local Journal WAL)
// ==========================================

export interface JournalRecord {
  node: string;
  seq: number;
  type: string;
  key: string;
  payload: string;
  chk: string;
  timestamp: string;
}

class LocalJournal {
  private buffer: string[] = [];
  private fd: number;

  constructor(public readonly nodeId: string, public readonly filepath: string) {
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    this.fd = fs.openSync(filepath, 'a+');
  }

  appendAndSync(seq: number, typeId: string, key: string, payloadRaw: string): JournalRecord {
    const checksum = crypto.createHash('sha256').update(payloadRaw).digest('hex');
    const record: JournalRecord = {
      node: this.nodeId,
      seq,
      type: typeId,
      key,
      payload: payloadRaw,
      chk: checksum,
      timestamp: new Date().toISOString()
    };
    
    this.buffer.push(JSON.stringify(record) + '\n');
    
    // Batching/flush
    const data = this.buffer.join('');
    fs.writeSync(this.fd, data);
    fs.fsyncSync(this.fd);
    this.buffer = [];
    return record;
  }

  readAllRecords(): JournalRecord[] {
    try {
      if (!fs.existsSync(this.filepath)) return [];
      const content = fs.readFileSync(this.filepath, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      return lines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter((r): r is JournalRecord => r !== null);
    } catch {
      return [];
    }
  }
}

// ==========================================
// 4. ENGINE (Materialized State Frontier)
// ==========================================

export interface StateSnapshot {
  readonly version: number;
  readonly frontier: VectorClock;
  readonly state: ProductLattice;
  readonly indexTree: Readonly<Record<string, any>>;
}

export class ZTPRuntime {
  private journal: LocalJournal;
  private currentSnapshot: StateSnapshot;
  private inbox: Array<{ seq: number; key: string; delta: JoinSemilattice<any> }> = [];
  private isMaterializing = false;
  private currentEpoch = 1;
  private sequenceCounter = 0;

  constructor(public readonly localNodeId: string, journalPath: string) {
    this.journal = new LocalJournal(localNodeId, journalPath);
    this.currentSnapshot = {
      version: 0,
      frontier: new VectorClock(),
      state: new ProductLattice(),
      indexTree: {}
    };

    // Automatisk återställning från WAL-journal om den existerar
    this.recoverFromJournal();
  }

  private recoverFromJournal() {
    const records = this.journal.readAllRecords();
    for (const record of records) {
      try {
        let val: any;
        try {
          val = JSON.parse(record.payload);
        } catch {
          val = record.payload;
        }
        
        if (record.seq > this.sequenceCounter) {
          this.sequenceCounter = record.seq;
        }

        const delta = new EpochRegister(val, {
          epoch: 1,
          counter: record.seq,
          nodeId: record.node
        });

        const snap = this.currentSnapshot;
        const currentField = snap.state.fields[record.key];
        const newField = currentField ? currentField.join(delta) : delta;

        const newState = new ProductLattice({
          ...snap.state.fields,
          [record.key]: newField
        });
        const newFrontier = snap.frontier.advance(record.node, record.seq);

        this.currentSnapshot = {
          version: snap.version + 1,
          frontier: newFrontier,
          state: newState,
          indexTree: {
            ...snap.indexTree,
            [record.key]: newField
          }
        };
      } catch (err) {
        console.warn(`[ZTPRuntime] Fel vid uppspelning av journal-rad seq=${record?.seq}:`, err);
      }
    }
  }

  /** Lock-free read: returnerar direkt pekaren till den oföränderliga snapshoten */
  snapshotRead(): StateSnapshot {
    return this.currentSnapshot;
  }

  /** O(1) uppslagning i det materialiserade trädet */
  pointRead(key: string): any {
    const field = this.currentSnapshot.indexTree[key];
    if (!field) return undefined;
    return typeof field.getValue === 'function' ? field.getValue() : field;
  }

  /** Hämtar rå register-metadata (Epoch, Generation, Node) */
  pointReadRegister(key: string): EpochRegister | undefined {
    return this.currentSnapshot.indexTree[key];
  }

  /** Genererar nästa sekvensnummer för noden */
  nextSeq(): number {
    this.sequenceCounter += 1;
    return this.sequenceCounter;
  }

  /** Icke-blockerande ingest för agenter */
  dispatch(seq: number, key: string, delta: JoinSemilattice<any>): void {
    this.inbox.push({ seq, key, delta });
    this.triggerMaterialization();
  }

  /** Högnivå-helper för att skriva tillstånd deterministiskt */
  recordState(key: string, value: any, options?: { epoch?: number; counter?: number; nodeId?: string }): { seq: number; key: string } {
    const seq = options?.counter ?? this.nextSeq();
    const epoch = options?.epoch ?? this.currentEpoch;
    const nodeId = options?.nodeId ?? this.localNodeId;

    const delta = new EpochRegister(value, { epoch, counter: seq, nodeId });
    this.dispatch(seq, key, delta);
    return { seq, key };
  }

  /** Returnerar alla materialiserade värden som en ren JSON-struktur */
  getAllValues(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(this.currentSnapshot.indexTree)) {
      result[k] = typeof v.getValue === 'function' ? v.getValue() : v;
    }
    return result;
  }

  /** Hämtar råa loggposter för granskning */
  getJournalHistory(limit = 100): JournalRecord[] {
    const records = this.journal.readAllRecords();
    return records.slice(-limit);
  }

  /** Async event-loop materializer (Node.js single-thread friendly) */
  private async triggerMaterialization() {
    if (this.isMaterializing) return;
    this.isMaterializing = true;

    while (this.inbox.length > 0) {
      const item = this.inbox.shift();
      if (!item) continue;
      const { seq, key, delta } = item;

      // 1. WAL Persist
      const rawVal = delta.getValue();
      const payloadStr = typeof rawVal === 'object' ? JSON.stringify(rawVal) : String(rawVal);
      this.journal.appendAndSync(seq, delta.constructor.name, key, payloadStr);

      // 2. Pure Lattice Fold (S ⊔ e)
      const snap = this.currentSnapshot;
      const currentField = snap.state.fields[key];
      const newField = currentField ? currentField.join(delta) : delta;

      const newState = new ProductLattice({
        ...snap.state.fields,
        [key]: newField
      });
      const newFrontier = snap.frontier.advance(this.localNodeId, seq);

      // 3. Atomic Publish (Pointer Swap)
      this.currentSnapshot = {
        version: snap.version + 1,
        frontier: newFrontier,
        state: newState,
        indexTree: {
          ...snap.indexTree,
          [key]: newField
        }
      };
    }

    this.isMaterializing = false;
  }
}

// ==========================================
// 5. GLOBAL SINGLETON INSTANCE
// ==========================================

let globalZTPInstance: ZTPRuntime | null = null;

export function getZTPRuntime(): ZTPRuntime {
  if (!globalZTPInstance) {
    const defaultJournalPath = path.join(process.cwd(), '.jaco', 'data', 'ztp-main.journal');
    globalZTPInstance = new ZTPRuntime('jaco_studio_main', defaultJournalPath);

    // Initialisera grundläggande systemtillstånd om tomt
    if (!globalZTPInstance.pointRead('system_status')) {
      globalZTPInstance.recordState('system_status', 'OPERATIONAL');
      globalZTPInstance.recordState('manifold_drift_control', 0.0000);
      globalZTPInstance.recordState('agent_velocity', { trend: 'NOMINAL', score: 0.88, parallel_workers: 4 });
      globalZTPInstance.recordState('primary_goal', {
        id: 'GOAL-001',
        objective: 'Establish autonomous paid capability execution & A2A nodal operations',
        progress: 0.65,
        status: 'ACTIVE'
      });
    }
  }
  return globalZTPInstance;
}
