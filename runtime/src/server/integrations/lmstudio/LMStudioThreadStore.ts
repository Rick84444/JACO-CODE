import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import {
  LMStudioPluginManifest,
  LMStudioAuditLogEntry,
  LMStudioPendingApproval,
  JacoLMStudioEvent
} from './schemas';

export class LMStudioThreadStore extends EventEmitter {
  private manifestPath: string;
  private manifest: LMStudioPluginManifest;
  private auditLogs: Map<string, LMStudioAuditLogEntry[]> = new Map();
  private pendingApprovals: Map<string, LMStudioPendingApproval> = new Map();
  private eventHistory: JacoLMStudioEvent[] = [];

  constructor() {
    super();
    this.manifestPath = path.resolve(process.cwd(), 'config/plugins/lmstudio-runtime-adapter.json');
    this.manifest = this.loadManifest();
  }

  private loadManifest(): LMStudioPluginManifest {
    try {
      if (fs.existsSync(this.manifestPath)) {
        const raw = fs.readFileSync(this.manifestPath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.warn('[LMStudioThreadStore] Failed to load manifest, using default:', err);
    }

    return {
      schemaVersion: '1.0',
      id: 'jaco.lmstudio-runtime',
      name: 'LM Studio Runtime Adapter',
      description: 'Valbar LM Studio-motor för lokal LLM-inferens, kodanalys och snabb modellväxling.',
      enabled: false,
      runtime: 'server',
      mode: 'advisor',
      hostUrl: 'http://127.0.0.1:1234/v1',
      selectedModel: '',
      capabilities: ['local_llm.inference', 'model.list', 'patch.propose', 'patch.apply'],
      permissions: {
        workspace: 'selected',
        network: 'restricted',
        shell: 'allowlist',
        destructiveActions: 'operator_approval',
        writeOutsideWorkspace: false
      }
    };
  }

  public getManifest(): LMStudioPluginManifest {
    return { ...this.manifest };
  }

  public updateManifest(partial: Partial<LMStudioPluginManifest>): LMStudioPluginManifest {
    this.manifest = { ...this.manifest, ...partial };
    try {
      const dir = path.dirname(this.manifestPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2), 'utf-8');
    } catch (err) {
      console.error('[LMStudioThreadStore] Failed to save manifest:', err);
    }
    return this.getManifest();
  }

  public addAuditLog(entry: LMStudioAuditLogEntry): void {
    const list = this.auditLogs.get(entry.missionId) || [];
    list.push(entry);
    this.auditLogs.set(entry.missionId, list);
  }

  public getAuditLogs(missionId?: string): LMStudioAuditLogEntry[] {
    if (missionId) {
      return this.auditLogs.get(missionId) || [];
    }
    const all: LMStudioAuditLogEntry[] = [];
    for (const list of this.auditLogs.values()) {
      all.push(...list);
    }
    return all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  public addPendingApproval(approval: LMStudioPendingApproval): void {
    this.pendingApprovals.set(approval.actionId, approval);
  }

  public getPendingApproval(actionId: string): LMStudioPendingApproval | undefined {
    return this.pendingApprovals.get(actionId);
  }

  public getPendingApprovalsForMission(missionId: string): LMStudioPendingApproval[] {
    const list: LMStudioPendingApproval[] = [];
    for (const app of this.pendingApprovals.values()) {
      if (app.missionId === missionId && app.status === 'pending') {
        list.push(app);
      }
    }
    return list;
  }

  public updatePendingApproval(actionId: string, status: 'approved' | 'rejected'): boolean {
    const app = this.pendingApprovals.get(actionId);
    if (!app) return false;
    app.status = status;
    if (status === 'approved') {
      app.approvedAt = new Date().toISOString();
    }
    this.pendingApprovals.set(actionId, app);
    return true;
  }

  public emitEvent(evt: JacoLMStudioEvent): void {
    this.eventHistory.push(evt);
    if (this.eventHistory.length > 500) {
      this.eventHistory.shift();
    }
    this.emit('lmstudio-event', evt);
  }

  public getEventHistory(missionId?: string): JacoLMStudioEvent[] {
    if (missionId) {
      return this.eventHistory.filter((e) => e.missionId === missionId);
    }
    return [...this.eventHistory];
  }
}

export const lmStudioThreadStore = new LMStudioThreadStore();
