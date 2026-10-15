import { 
  IMemoryStore, 
  AgentWorkflowItem, 
  PatchHistoryItem, 
  AgenticSkill, 
  AuraMemoryItem, 
  ContextQueryResult, 
  MemoryStoreStats, 
  MemoryStoreName 
} from '../types';

const DB_NAME = 'JACO_MemoryStore_DB';
const DB_VERSION = 1;

class IndexedDBMemoryStore implements IMemoryStore {
  private db: IDBDatabase | null = null;
  private isInitPromise: Promise<boolean> | null = null;
  private lastIndexedAtTimestamp: string = new Date().toISOString();

  public async init(): Promise<boolean> {
    if (this.db) return true;
    if (this.isInitPromise) return this.isInitPromise;

    this.isInitPromise = new Promise<boolean>((resolve) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        console.warn('IndexedDB not supported in current environment.');
        resolve(false);
        return;
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (evt) => {
        console.error('Failed to open IndexedDB MemoryStore:', evt);
        resolve(false);
      };

      request.onsuccess = async () => {
        this.db = request.result;
        await this.seedInitialContextIfEmpty();
        resolve(true);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // 1. Workflows store
        if (!db.objectStoreNames.contains('workflows')) {
          const store = db.createObjectStore('workflows', { keyPath: 'id' });
          store.createIndex('by_status', 'status', { unique: false });
          store.createIndex('by_timestamp', 'timestamp', { unique: false });
          store.createIndex('by_assignedAgent', 'assignedAgent', { unique: false });
        }

        // 2. Patches store
        if (!db.objectStoreNames.contains('patches')) {
          const store = db.createObjectStore('patches', { keyPath: 'id' });
          store.createIndex('by_targetFile', 'targetFile', { unique: false });
          store.createIndex('by_status', 'status', { unique: false });
          store.createIndex('by_timestamp', 'timestamp', { unique: false });
          store.createIndex('by_agentName', 'agentName', { unique: false });
        }

        // 3. Skills store
        if (!db.objectStoreNames.contains('skills')) {
          const store = db.createObjectStore('skills', { keyPath: 'id' });
          store.createIndex('by_category', 'category', { unique: false });
          store.createIndex('by_isEnabled', 'isEnabled', { unique: false });
          store.createIndex('by_triggerKey', 'triggerKey', { unique: false });
        }

        // 4. Memories store
        if (!db.objectStoreNames.contains('memories')) {
          const store = db.createObjectStore('memories', { keyPath: 'id' });
          store.createIndex('by_category', 'category', { unique: false });
          store.createIndex('by_importance', 'importance', { unique: false });
          store.createIndex('by_timestamp', 'timestamp', { unique: false });
        }
      };
    });

    return this.isInitPromise;
  }

  private async seedInitialContextIfEmpty(): Promise<void> {
    const stats = await this.getStats();
    if (stats.totalItemsCount > 0) return;

    // Seed default workflow
    const defaultWorkflow: AgentWorkflowItem = {
      id: 'wf-initial-1',
      title: 'JACO OS Architecture Initialization',
      prompt: 'Initiera JACO OS agentic node, Ollama API bridge och NPU matrix accelerators.',
      goal: 'Skapa en stabil autonom agentisk runtime med typsäkerhet och persistent minne.',
      assignedAgent: 'JACO Master',
      status: 'completed',
      steps: [
        {
          id: 'step-1',
          stepNumber: 1,
          name: 'Environment Check',
          action: 'READ_FILE',
          description: 'Verifierade server.ts och auraEngine.ts för API-endpoints.',
          status: 'completed',
          timestamp: new Date().toLocaleTimeString('sv-SE')
        },
        {
          id: 'step-2',
          stepNumber: 2,
          name: 'AST Verification',
          action: 'AST_ANALYSIS',
          description: 'Analyserade TypeScript AST i src/types.ts.',
          status: 'completed',
          timestamp: new Date().toLocaleTimeString('sv-SE')
        }
      ],
      outcomeSummary: 'JACO OS runtime aktiverad med fullständig IndexedDB MemoryStore persistering.',
      tags: ['system', 'initialization', 'ast', 'npu'],
      timestamp: new Date().toLocaleDateString('sv-SE'),
      executionDurationMs: 1240,
      modelUsed: 'gemini-3.6-flash'
    };
    await this.indexWorkflow(defaultWorkflow);

    // Seed default patch
    const defaultPatch: PatchHistoryItem = {
      id: 'patch-seed-1',
      workflowId: 'wf-initial-1',
      workflowTitle: 'JACO MemoryStore Setup',
      agentName: 'JACO Core',
      targetFile: 'src/lib/memoryStore.ts',
      patchDescription: 'Skapade persistent IndexedDB MemoryStore med sökindexering för agent workflows, patchar och skills.',
      diffContent: 'export interface IMemoryStore { ... }',
      timestamp: new Date().toLocaleDateString('sv-SE'),
      status: 'applied',
      linesAdded: 120,
      linesRemoved: 0,
      verificationHash: 'sha256-a2a-indexeddb'
    };
    await this.indexPatch(defaultPatch);

    // Seed default skill
    const defaultSkill: AgenticSkill = {
      id: 'skill-seed-1',
      name: 'TypeScript AST Analyzer',
      description: 'Analyserar TypeScript-filer efter typsäkerhet, saknade variabler och syntaxfel.',
      category: 'Code AST',
      isEnabled: true,
      triggerKey: 'ast_analyzer',
      parametersSchema: '{"targetFile": "string"}',
      executionCount: 5,
      pluginCode: 'export function analyzeAST(code: string) { return { isClean: true }; }',
      createdAt: new Date().toLocaleDateString('sv-SE')
    };
    await this.indexSkill(defaultSkill);

    // Seed initial memories
    const seedMemories: AuraMemoryItem[] = [
      {
        id: 'mem-idx-1',
        category: 'system',
        content: 'IndexedDB MemoryStore aktiv. Alla agentic workflows, lyckade patchar och inlärda skills indexeras lokalt i webbläsaren.',
        importance: 'high',
        source: 'JACO MemoryStore',
        timestamp: new Date().toLocaleDateString('sv-SE')
      },
      {
        id: 'mem-idx-2',
        category: 'code_ast',
        content: 'JACO har lärt sig att alltid validera TypeScript AST via tsc --noEmit före commit.',
        importance: 'high',
        source: 'AST Engine',
        timestamp: new Date().toLocaleDateString('sv-SE')
      },
      {
        id: 'mem-idx-3',
        category: 'learned_skill',
        content: 'Ollama local endpoints & Cloudflare Tunnels integrerade för A2A node discovery.',
        importance: 'medium',
        source: 'A2A Protocol',
        timestamp: new Date().toLocaleDateString('sv-SE')
      }
    ];

    for (const mem of seedMemories) {
      await this.indexMemoryItem(mem);
    }
  }

  private async getStore(storeName: MemoryStoreName, mode: IDBTransactionMode = 'readonly'): Promise<IDBObjectStore> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');
    const tx = this.db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  }

  public async indexWorkflow(workflow: AgentWorkflowItem): Promise<void> {
    const store = await this.getStore('workflows', 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put(workflow);
      req.onsuccess = () => {
        this.lastIndexedAtTimestamp = new Date().toISOString();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  public async indexPatch(patch: PatchHistoryItem): Promise<void> {
    const store = await this.getStore('patches', 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put(patch);
      req.onsuccess = () => {
        this.lastIndexedAtTimestamp = new Date().toISOString();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  public async indexSkill(skill: AgenticSkill): Promise<void> {
    const store = await this.getStore('skills', 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put(skill);
      req.onsuccess = () => {
        this.lastIndexedAtTimestamp = new Date().toISOString();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  public async indexMemoryItem(item: AuraMemoryItem): Promise<void> {
    const store = await this.getStore('memories', 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put(item);
      req.onsuccess = () => {
        this.lastIndexedAtTimestamp = new Date().toISOString();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  public async getWorkflows(filter?: { status?: string; tag?: string }): Promise<AgentWorkflowItem[]> {
    const store = await this.getStore('workflows', 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        let items: AgentWorkflowItem[] = req.result || [];
        if (filter?.status) {
          items = items.filter(w => w.status === filter.status);
        }
        if (filter?.tag) {
          items = items.filter(w => w.tags && w.tags.includes(filter.tag!));
        }
        resolve(items.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || '')));
      };
      req.onerror = () => reject(req.error);
    });
  }

  public async getPatches(filter?: { targetFile?: string; status?: string }): Promise<PatchHistoryItem[]> {
    const store = await this.getStore('patches', 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        let items: PatchHistoryItem[] = req.result || [];
        if (filter?.targetFile) {
          items = items.filter(p => p.targetFile === filter.targetFile);
        }
        if (filter?.status) {
          items = items.filter(p => p.status === filter.status);
        }
        resolve(items.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || '')));
      };
      req.onerror = () => reject(req.error);
    });
  }

  public async getSkills(category?: string): Promise<AgenticSkill[]> {
    const store = await this.getStore('skills', 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        let items: AgenticSkill[] = req.result || [];
        if (category) {
          items = items.filter(s => s.category === category);
        }
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  }

  public async getAllMemories(category?: string): Promise<AuraMemoryItem[]> {
    const store = await this.getStore('memories', 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        let items: AuraMemoryItem[] = req.result || [];
        if (category) {
          items = items.filter(m => m.category === category);
        }
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  }

  public async deleteItem(storeName: MemoryStoreName, id: string): Promise<void> {
    const store = await this.getStore(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  public async clearAll(): Promise<void> {
    const storeNames: MemoryStoreName[] = ['workflows', 'patches', 'skills', 'memories'];
    for (const sName of storeNames) {
      const store = await this.getStore(sName, 'readwrite');
      await new Promise<void>((resolve, reject) => {
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }
  }

  public async queryContext(query: string, limit: number = 5): Promise<ContextQueryResult> {
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    
    const [workflows, patches, skills, memories] = await Promise.all([
      this.getWorkflows(),
      this.getPatches(),
      this.getSkills(),
      this.getAllMemories()
    ]);

    const calculateScore = (text: string) => {
      if (!text) return 0;
      const lower = text.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (lower.includes(term)) {
          score += 10;
        }
      }
      return score;
    };

    // Rank Workflows
    const rankedWorkflows = workflows.map(w => {
      const matchScore = calculateScore(`${w.title} ${w.prompt} ${w.goal} ${w.outcomeSummary} ${w.tags.join(' ')}`);
      return { ...w, matchScore };
    }).filter(w => w.matchScore > 0 || terms.length === 0).sort((a, b) => b.matchScore - a.matchScore).slice(0, limit);

    // Rank Patches
    const rankedPatches = patches.map(p => {
      const matchScore = calculateScore(`${p.workflowTitle} ${p.patchDescription} ${p.targetFile} ${p.diffContent}`);
      return { ...p, matchScore };
    }).filter(p => p.matchScore > 0 || terms.length === 0).sort((a, b) => b.matchScore - a.matchScore).slice(0, limit);

    // Rank Skills
    const rankedSkills = skills.map(s => {
      const matchScore = calculateScore(`${s.name} ${s.description} ${s.category} ${s.triggerKey} ${s.pluginCode || ''}`);
      return { ...s, matchScore };
    }).filter(s => s.matchScore > 0 || terms.length === 0).sort((a, b) => b.matchScore - a.matchScore).slice(0, limit);

    // Rank Memories
    const rankedMemories = memories.map(m => {
      const matchScore = calculateScore(`${m.content} ${m.category} ${m.source}`);
      return { ...m, matchScore };
    }).filter(m => m.matchScore > 0 || terms.length === 0).sort((a, b) => b.matchScore - a.matchScore).slice(0, limit);

    const totalMatches = rankedWorkflows.length + rankedPatches.length + rankedSkills.length + rankedMemories.length;
    const relevanceScore = Math.min(100, totalMatches * 20);

    // Build context snippet string for AI prompts
    const contextSnippets: string[] = [];
    if (rankedWorkflows.length > 0) {
      contextSnippets.push(`[Historiska Workflows]:\n` + rankedWorkflows.map(w => `- ${w.title}: ${w.outcomeSummary}`).join('\n'));
    }
    if (rankedPatches.length > 0) {
      contextSnippets.push(`[Verifierade Patchar]:\n` + rankedPatches.map(p => `- Fil: ${p.targetFile} (${p.patchDescription})`).join('\n'));
    }
    if (rankedSkills.length > 0) {
      contextSnippets.push(`[Inlärda Skills]:\n` + rankedSkills.map(s => `- ${s.name} (${s.category}): ${s.description}`).join('\n'));
    }
    if (rankedMemories.length > 0) {
      contextSnippets.push(`[Kontextminnen]:\n` + rankedMemories.map(m => `- [${m.category}] ${m.content}`).join('\n'));
    }

    const contextSnippet = contextSnippets.join('\n\n') || 'Ingen relevant historisk kontext hittades för sökningen.';

    return {
      query,
      totalMatches,
      relevanceScore,
      relevantWorkflows: rankedWorkflows,
      relevantPatches: rankedPatches,
      relevantSkills: rankedSkills,
      relevantMemories: rankedMemories,
      contextSnippet
    };
  }

  public async getStats(): Promise<MemoryStoreStats> {
    const isAvailable = await this.init();
    if (!isAvailable) {
      return {
        dbName: DB_NAME,
        version: DB_VERSION,
        workflowsCount: 0,
        patchesCount: 0,
        skillsCount: 0,
        memoriesCount: 0,
        totalItemsCount: 0,
        isAvailable: false
      };
    }

    const [workflows, patches, skills, memories] = await Promise.all([
      this.getWorkflows(),
      this.getPatches(),
      this.getSkills(),
      this.getAllMemories()
    ]);

    const workflowsCount = workflows.length;
    const patchesCount = patches.length;
    const skillsCount = skills.length;
    const memoriesCount = memories.length;
    const totalItemsCount = workflowsCount + patchesCount + skillsCount + memoriesCount;

    const dumpStr = JSON.stringify({ workflows, patches, skills, memories });
    const estimatedSizeKb = Math.round(dumpStr.length / 1024);

    return {
      dbName: DB_NAME,
      version: DB_VERSION,
      workflowsCount,
      patchesCount,
      skillsCount,
      memoriesCount,
      totalItemsCount,
      isAvailable: true,
      lastIndexedAt: this.lastIndexedAtTimestamp,
      estimatedSizeKb
    };
  }

  public async exportDump(): Promise<string> {
    const [workflows, patches, skills, memories] = await Promise.all([
      this.getWorkflows(),
      this.getPatches(),
      this.getSkills(),
      this.getAllMemories()
    ]);

    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      version: DB_VERSION,
      workflows,
      patches,
      skills,
      memories
    }, null, 2);
  }

  public async importDump(jsonDump: string): Promise<boolean> {
    try {
      const data = JSON.parse(jsonDump);
      if (Array.isArray(data.workflows)) {
        for (const w of data.workflows) await this.indexWorkflow(w);
      }
      if (Array.isArray(data.patches)) {
        for (const p of data.patches) await this.indexPatch(p);
      }
      if (Array.isArray(data.skills)) {
        for (const s of data.skills) await this.indexSkill(s);
      }
      if (Array.isArray(data.memories)) {
        for (const m of data.memories) await this.indexMemoryItem(m);
      }
      return true;
    } catch (err) {
      console.error('Failed to import MemoryStore dump:', err);
      return false;
    }
  }
}

export const memoryStore: IMemoryStore = new IndexedDBMemoryStore();
