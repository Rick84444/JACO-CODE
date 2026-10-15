/**
 * JACO Sync Fabric 1.0
 * Distributed Event Broker, Peer Cursor Reconciler, Schema Ping Negotiator,
 * WebSocket Push Invalidation Broadcaster, and Watchdog State Machine.
 */

import { workspaceJournal, WorkspaceEvent, WorkspaceState } from './workspaceJournal.js';
import crypto from 'crypto';

export type PeerWatchdogStatus = 'READY' | 'SYNCING' | 'BEHIND' | 'DEGRADED' | 'OFFLINE';

export interface PeerRecord {
  actor: string;
  runtimeId: string;
  transport: 'WEBSOCKET' | 'SSE' | 'FCM_SIGNAL' | 'WEBHOOK' | 'POLLING_HEARTBEAT';
  lastSequence: number;
  generation: number;
  stateHash: string;
  schemaVersion: string;
  schemaHash: string;
  watchdogStatus: PeerWatchdogStatus;
  lastHeartbeat: string;
  activeMissionId?: string;
  eventsPending: number;
  ipAddress?: string;
}

export interface HeartbeatRequest {
  actor: string;
  runtimeId: string;
  transport?: PeerRecord['transport'];
  workspace: {
    schema: string;
    schemaHash: string;
    lastSequence: number;
    generation: number;
  };
  runtime: {
    state: string;
    activeMission?: string;
  };
  timestamp: string;
}

export interface HeartbeatResponse {
  ok: boolean;
  sync: {
    currentSequence: number;
    generation: number;
    schemaChanged: boolean;
    schemaCompatible: boolean;
    eventsPending: number;
    stateHash: string;
    schemaVersion: string;
    schemaHash: string;
  };
  actionRequired?: 'NONE' | 'FETCH_DELTA' | 'SCHEMA_MIGRATION' | 'FULL_RESYNC';
  wakeEvent?: WorkspaceEvent | null;
  serverTimestamp: string;
}

export interface WorkspaceInvalidateMessage {
  type: 'workspace.invalidate';
  workspace: string;
  sequence: number;
  generation: number;
  schemaVersion: string;
  schemaHash: string;
  reason: string;
  wake?: boolean;
  target?: string;
  timestamp: string;
}

export interface WebSocketClientSession {
  id: string;
  actor: string;
  runtimeId: string;
  cursor: number;
  connectedAt: string;
  lastSeenAt: string;
  send: (data: string) => void;
  close: () => void;
}

export class SyncFabric {
  private static instance: SyncFabric;
  private peers: Map<string, PeerRecord> = new Map();
  private wsClients: Map<string, WebSocketClientSession> = new Map();
  private sseClients: Set<(data: string) => void> = new Set();

  private constructor() {
    this.initCorePeers();

    // Listen to WorkspaceJournal events and broadcast invalidation signals
    workspaceJournal.subscribe(event => {
      this.handleJournalEvent(event);
    });

    // Run watchdog audit every 10 seconds
    setInterval(() => {
      this.runWatchdogAudit();
    }, 10000);
  }

  public static getInstance(): SyncFabric {
    if (!SyncFabric.instance) {
      SyncFabric.instance = new SyncFabric();
    }
    return SyncFabric.instance;
  }

  /**
   * [TRUTH HARDENING]: Configured peers start OFFLINE until a real heartbeat is received.
   */
  private initCorePeers(): void {
    const schemaVer = workspaceJournal.getSchemaVersion();
    const schemaHash = workspaceJournal.getSchemaHash();

    const configuredPeers: Array<{ actor: string; runtimeId: string; transport: PeerRecord['transport'] }> = [
      { actor: 'aura-core', runtimeId: 'aura-runtime-01', transport: 'WEBSOCKET' },
      { actor: 'ai-studio', runtimeId: 'aistudio-runtime-01', transport: 'POLLING_HEARTBEAT' },
      { actor: 'forge-compiler', runtimeId: 'forge-engine-01', transport: 'WEBSOCKET' },
      { actor: 'android-device', runtimeId: 'pixel-10-pro-termux', transport: 'FCM_SIGNAL' },
      { actor: 'a2a-peer-node', runtimeId: 'mimirpower-a2a-broker', transport: 'WEBHOOK' }
    ];

    for (const cp of configuredPeers) {
      this.peers.set(cp.runtimeId, {
        actor: cp.actor,
        runtimeId: cp.runtimeId,
        transport: cp.transport,
        lastSequence: 0,
        generation: 1,
        stateHash: '',
        schemaVersion: schemaVer,
        schemaHash: schemaHash,
        watchdogStatus: 'OFFLINE',
        lastHeartbeat: '',
        eventsPending: workspaceJournal.getLatestSequence()
      });
    }
  }

  /**
   * Broadcast invalidation event to all active WebSocket & SSE subscribers
   */
  private handleJournalEvent(event: WorkspaceEvent): void {
    const currentSeq = workspaceJournal.getLatestSequence();
    const currentGen = workspaceJournal.getGeneration();

    const invalidateMsg: WorkspaceInvalidateMessage = {
      type: 'workspace.invalidate',
      workspace: 'jaco-main',
      sequence: currentSeq,
      generation: currentGen,
      schemaVersion: workspaceJournal.getSchemaVersion(),
      schemaHash: workspaceJournal.getSchemaHash(),
      reason: `${event.kind}:${event.actor}`,
      wake: event.wake,
      target: event.target,
      timestamp: event.timestamp
    };

    const payloadStr = JSON.stringify(invalidateMsg);

    // Push to connected WebSocket clients
    for (const [clientId, session] of this.wsClients) {
      try {
        session.send(payloadStr);
      } catch (err: any) {
        console.warn(`[SyncFabric] Failed to push ws message to ${clientId}:`, err.message);
      }
    }

    // Push to SSE streams
    const sseData = `data: ${payloadStr}\n\n`;
    this.sseClients.forEach(sendFn => {
      try {
        sendFn(sseData);
      } catch {
        // Discard
      }
    });

    // Update pending events count across registered peers
    for (const [_, peer] of this.peers) {
      if (peer.lastHeartbeat) {
        peer.eventsPending = Math.max(0, currentSeq - peer.lastSequence);
        if (peer.watchdogStatus === 'READY' && peer.eventsPending > 0) {
          peer.watchdogStatus = 'BEHIND';
        }
      } else {
        peer.eventsPending = currentSeq;
      }
    }
  }

  /**
   * WebSocket Client Connection Handler
   */
  public handleWebSocketConnection(
    rawWs: any,
    reqMeta?: { ip?: string; query?: Record<string, string> }
  ): void {
    const clientId = `ws-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();

    const session: WebSocketClientSession = {
      id: clientId,
      actor: reqMeta?.query?.actor || 'anonymous-ws-peer',
      runtimeId: reqMeta?.query?.runtimeId || clientId,
      cursor: parseInt(reqMeta?.query?.cursor || '0', 10),
      connectedAt: now,
      lastSeenAt: now,
      send: (data: string) => {
        if (rawWs.readyState === 1) {
          rawWs.send(data);
        }
      },
      close: () => {
        try {
          rawWs.close();
        } catch {
          // ignore
        }
      }
    };

    this.wsClients.set(clientId, session);

    // If client provided runtimeId, register/update peer
    if (session.runtimeId && session.actor !== 'anonymous-ws-peer') {
      const peer = this.peers.get(session.runtimeId) || {
        actor: session.actor,
        runtimeId: session.runtimeId,
        transport: 'WEBSOCKET',
        lastSequence: session.cursor,
        generation: workspaceJournal.getGeneration(),
        stateHash: workspaceJournal.getState().stateHash,
        schemaVersion: workspaceJournal.getSchemaVersion(),
        schemaHash: workspaceJournal.getSchemaHash(),
        watchdogStatus: 'READY',
        lastHeartbeat: now,
        eventsPending: Math.max(0, workspaceJournal.getLatestSequence() - session.cursor),
        ipAddress: reqMeta?.ip
      };
      peer.lastHeartbeat = now;
      peer.watchdogStatus = peer.eventsPending > 0 ? 'BEHIND' : 'READY';
      peer.transport = 'WEBSOCKET';
      this.peers.set(session.runtimeId, peer);
    }

    // Send initial welcome & sync greeting
    const latestSeq = workspaceJournal.getLatestSequence();
    session.send(
      JSON.stringify({
        type: 'sync.welcome',
        clientId,
        currentSequence: latestSeq,
        generation: workspaceJournal.getGeneration(),
        schemaVersion: workspaceJournal.getSchemaVersion(),
        schemaHash: workspaceJournal.getSchemaHash(),
        stateHash: workspaceJournal.getState().stateHash,
        serverTime: new Date().toISOString()
      })
    );

    // Handle incoming messages
    rawWs.on('message', (rawMsg: any) => {
      try {
        const text = typeof rawMsg === 'string' ? rawMsg : rawMsg.toString('utf-8');
        const data = JSON.parse(text);
        session.lastSeenAt = new Date().toISOString();

        this.handleWebSocketMessage(session, data);
      } catch (err: any) {
        session.send(
          JSON.stringify({
            type: 'error',
            message: `Invalid JSON payload: ${err.message}`
          })
        );
      }
    });

    rawWs.on('close', () => {
      this.wsClients.delete(clientId);
    });

    rawWs.on('error', () => {
      this.wsClients.delete(clientId);
    });
  }

  private handleWebSocketMessage(session: WebSocketClientSession, data: any): void {
    const msgType = data.type;

    switch (msgType) {
      case 'subscribe':
      case 'sync.subscribe': {
        if (data.actor) session.actor = data.actor;
        if (data.runtimeId) session.runtimeId = data.runtimeId;
        if (typeof data.cursor === 'number') session.cursor = data.cursor;

        const peer = this.peers.get(session.runtimeId);
        if (peer) {
          peer.lastHeartbeat = new Date().toISOString();
          peer.lastSequence = session.cursor;
          peer.watchdogStatus =
            session.cursor < workspaceJournal.getLatestSequence() ? 'BEHIND' : 'READY';
        }

        session.send(
          JSON.stringify({
            type: 'sync.subscribed',
            runtimeId: session.runtimeId,
            cursor: session.cursor,
            currentSequence: workspaceJournal.getLatestSequence()
          })
        );
        break;
      }

      case 'fetch_delta':
      case 'sync.fetch_delta': {
        const afterSeq = typeof data.afterSequence === 'number' ? data.afterSequence : session.cursor;
        const limit = typeof data.limit === 'number' ? data.limit : 50;
        const events = workspaceJournal.getEventsAfter(afterSeq, limit);

        session.send(
          JSON.stringify({
            type: 'sync.delta',
            afterSequence: afterSeq,
            events,
            currentSequence: workspaceJournal.getLatestSequence(),
            generation: workspaceJournal.getGeneration(),
            stateHash: workspaceJournal.getState().stateHash
          })
        );
        break;
      }

      case 'ack':
      case 'sync.ack': {
        if (typeof data.sequence === 'number') {
          session.cursor = data.sequence;
          this.processAck({
            actor: session.actor,
            runtimeId: session.runtimeId,
            sequence: data.sequence,
            stateHash: data.stateHash
          });
        }
        session.send(
          JSON.stringify({
            type: 'sync.ack_response',
            ok: true,
            cursor: session.cursor,
            currentSequence: workspaceJournal.getLatestSequence()
          })
        );
        break;
      }

      case 'heartbeat':
      case 'sync.heartbeat': {
        const hbResp = this.processHeartbeat({
          actor: data.actor || session.actor,
          runtimeId: data.runtimeId || session.runtimeId,
          transport: 'WEBSOCKET',
          workspace: {
            schema: data.workspace?.schema || workspaceJournal.getSchemaVersion(),
            schemaHash: data.workspace?.schemaHash || workspaceJournal.getSchemaHash(),
            lastSequence: typeof data.workspace?.lastSequence === 'number' ? data.workspace.lastSequence : session.cursor,
            generation: typeof data.workspace?.generation === 'number' ? data.workspace.generation : workspaceJournal.getGeneration()
          },
          runtime: {
            state: data.runtime?.state || 'READY',
            activeMission: data.runtime?.activeMission
          },
          timestamp: data.timestamp || new Date().toISOString()
        });

        session.send(
          JSON.stringify({
            type: 'sync.heartbeat_response',
            ...hbResp
          })
        );
        break;
      }

      case 'ping': {
        session.send(
          JSON.stringify({
            type: 'pong',
            timestamp: new Date().toISOString(),
            currentSequence: workspaceJournal.getLatestSequence()
          })
        );
        break;
      }

      default: {
        session.send(
          JSON.stringify({
            type: 'ack_unhandled',
            receivedType: msgType
          })
        );
      }
    }
  }

  /**
   * Heartbeat & Schema Ping Negotiation Endpoint
   */
  public processHeartbeat(req: HeartbeatRequest): HeartbeatResponse {
    const currentSeq = workspaceJournal.getLatestSequence();
    const currentGen = workspaceJournal.getGeneration();
    const expectedSchema = workspaceJournal.getSchemaVersion();
    const expectedSchemaHash = workspaceJournal.getSchemaHash();
    const state = workspaceJournal.getState();

    const schemaCompatible = req.workspace.schema === expectedSchema;
    const schemaChanged = req.workspace.schemaHash !== expectedSchemaHash;
    const eventsPending = Math.max(0, currentSeq - req.workspace.lastSequence);

    // Update or register peer
    const now = new Date().toISOString();
    const peer: PeerRecord = this.peers.get(req.runtimeId) || {
      actor: req.actor,
      runtimeId: req.runtimeId,
      transport: req.transport || 'POLLING_HEARTBEAT',
      lastSequence: req.workspace.lastSequence,
      generation: req.workspace.generation,
      stateHash: state.stateHash,
      schemaVersion: req.workspace.schema,
      schemaHash: req.workspace.schemaHash,
      watchdogStatus: 'READY',
      lastHeartbeat: now,
      eventsPending
    };

    peer.lastHeartbeat = now;
    peer.lastSequence = req.workspace.lastSequence;
    peer.generation = req.workspace.generation;
    peer.activeMissionId = req.runtime.activeMission;
    peer.eventsPending = eventsPending;

    if (!schemaCompatible) {
      peer.watchdogStatus = 'DEGRADED';
    } else if (eventsPending > 0) {
      peer.watchdogStatus = 'BEHIND';
    } else {
      peer.watchdogStatus = 'READY';
    }

    this.peers.set(req.runtimeId, peer);

    let actionRequired: HeartbeatResponse['actionRequired'] = 'NONE';
    if (!schemaCompatible) {
      actionRequired = 'SCHEMA_MIGRATION';
    } else if (eventsPending > 0) {
      actionRequired = 'FETCH_DELTA';
    }

    // Check if there is any pending wake action targeting this actor
    let wakeEvent: WorkspaceEvent | null = null;
    if (eventsPending > 0) {
      const deltas = workspaceJournal.getEventsAfter(req.workspace.lastSequence, 10);
      wakeEvent = deltas.find(d => d.wake && (!d.target || d.target === req.actor || d.target === req.runtimeId)) || null;
    }

    return {
      ok: true,
      sync: {
        currentSequence: currentSeq,
        generation: currentGen,
        schemaChanged,
        schemaCompatible,
        eventsPending,
        stateHash: state.stateHash,
        schemaVersion: expectedSchema,
        schemaHash: expectedSchemaHash
      },
      actionRequired,
      wakeEvent,
      serverTimestamp: now
    };
  }

  /**
   * Acknowledge peer cursor synchronization.
   * [TRUTH HARDENING]: ACK updates peer cursor without generating a new replicated ACK event.
   */
  public processAck(params: {
    actor: string;
    runtimeId: string;
    sequence: number;
    stateHash?: string;
  }): { ok: boolean; currentSequence: number; synced: boolean } {
    const currentSeq = workspaceJournal.getLatestSequence();
    const peer = this.peers.get(params.runtimeId);

    if (peer) {
      peer.lastSequence = params.sequence;
      peer.eventsPending = Math.max(0, currentSeq - params.sequence);
      peer.lastHeartbeat = new Date().toISOString();
      if (peer.eventsPending === 0) {
        peer.watchdogStatus = 'READY';
      }
      if (params.stateHash) {
        peer.stateHash = params.stateHash;
      }
    }

    return {
      ok: true,
      currentSequence: currentSeq,
      synced: params.sequence >= currentSeq
    };
  }

  public registerWebSocketClient(sendFn: (msg: WorkspaceInvalidateMessage) => void): () => void {
    const dummyId = `cb-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const session: WebSocketClientSession = {
      id: dummyId,
      actor: 'callback-client',
      runtimeId: dummyId,
      cursor: 0,
      connectedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      send: (str: string) => {
        try {
          sendFn(JSON.parse(str));
        } catch {
          // ignore
        }
      },
      close: () => {}
    };
    this.wsClients.set(dummyId, session);
    return () => {
      this.wsClients.delete(dummyId);
    };
  }

  public registerSseClient(sendFn: (data: string) => void): () => void {
    this.sseClients.add(sendFn);
    return () => this.sseClients.delete(sendFn);
  }

  public getPeers(): PeerRecord[] {
    return Array.from(this.peers.values());
  }

  public getConnectedClientsCount(): number {
    return this.wsClients.size;
  }

  /**
   * Cursor-based delta fetching helper
   */
  public fetchDelta(afterSequence: number, limit: number = 50): {
    events: WorkspaceEvent[];
    currentSequence: number;
    generation: number;
    schemaVersion: string;
    schemaHash: string;
    stateHash: string;
  } {
    const events = workspaceJournal.getEventsAfter(afterSequence, limit);
    return {
      events,
      currentSequence: workspaceJournal.getLatestSequence(),
      generation: workspaceJournal.getGeneration(),
      schemaVersion: workspaceJournal.getSchemaVersion(),
      schemaHash: workspaceJournal.getSchemaHash(),
      stateHash: workspaceJournal.getState().stateHash
    };
  }

  private runWatchdogAudit(): void {
    const now = Date.now();
    for (const [_, peer] of this.peers) {
      if (!peer.lastHeartbeat) {
        peer.watchdogStatus = 'OFFLINE';
        continue;
      }

      const lastHbTime = new Date(peer.lastHeartbeat).getTime();
      const elapsedSec = (now - lastHbTime) / 1000;

      if (elapsedSec > 120) {
        peer.watchdogStatus = 'OFFLINE';
      } else if (elapsedSec > 30) {
        peer.watchdogStatus = 'DEGRADED';
      } else if (peer.eventsPending > 0) {
        peer.watchdogStatus = 'BEHIND';
      } else {
        peer.watchdogStatus = 'READY';
      }
    }
  }
}

export const syncFabric = SyncFabric.getInstance();

