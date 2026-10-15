// Cost-Aware API Orchestrator Module
// Tracks Cloud API Free Tier Usage and handles zero-cost automatic failover to local Ollama / Qwen / DeepSeek

export interface QuotaStats {
  providerName: string;
  freeTierLimitTokens: number;
  tokensUsed: number;
  freeTierLimitRequests: number;
  requestsUsed: number;
  costSavedSek: number;
  activeEngine: 'CLOUD_GEMINI_FREE' | 'LOCAL_OLLAMA_QWEN' | 'LOCAL_DEEPSEEK' | 'HYBRID_AUTO_FAILOVER';
  autoFailoverEnabled: boolean;
  quotaExhausted: boolean;
  lastFailoverTimestamp?: string;
  totalFailoversCount: number;
  recentLogs: { id: string; timestamp: string; engine: string; tokens: number; mode: string; costSek: number }[];
}

const STORAGE_KEY = 'jaco_cost_orchestrator_stats';

const DEFAULT_STATS: QuotaStats = {
  providerName: 'Google Gemini API (Free Tier)',
  freeTierLimitTokens: 1000000, // 1M tokens free tier quota pot
  tokensUsed: 142800,
  freeTierLimitRequests: 1500,
  requestsUsed: 215,
  costSavedSek: 38.40,
  activeEngine: 'HYBRID_AUTO_FAILOVER',
  autoFailoverEnabled: true,
  quotaExhausted: false,
  totalFailoversCount: 3,
  recentLogs: [
    {
      id: 'log-1',
      timestamp: new Date(Date.now() - 3600000).toLocaleTimeString(),
      engine: 'Google Gemini 1.5 Flash (Free Tier)',
      tokens: 1250,
      mode: 'Cloud Free Pot',
      costSek: 0.00
    },
    {
      id: 'log-2',
      timestamp: new Date(Date.now() - 1800000).toLocaleTimeString(),
      engine: 'Local Ollama / Qwen2.5:0.5b',
      tokens: 3400,
      mode: 'Local Zero-Cost Failover',
      costSek: 0.00
    }
  ]
};

export class CostAwareOrchestrator {
  private stats: QuotaStats;

  constructor() {
    this.stats = this.loadStats();
  }

  private loadStats(): QuotaStats {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn('[CostAwareOrchestrator] Error loading stored stats:', e);
    }
    return { ...DEFAULT_STATS };
  }

  public saveStats(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.stats));
    } catch (e) {
      console.warn('[CostAwareOrchestrator] Error saving stats:', e);
    }
  }

  public getStats(): QuotaStats {
    return { ...this.stats };
  }

  public recordRequest(tokensEstimated: number, forcedLocal: boolean = false): { routedEngine: string; isLocal: boolean; costSek: number } {
    const now = new Date().toLocaleTimeString();

    // Check if free tier quota is exhausted or if user forced local mode
    const isExhausted = this.stats.tokensUsed + tokensEstimated >= this.stats.freeTierLimitTokens || 
                        this.stats.requestsUsed >= this.stats.freeTierLimitRequests;

    if (isExhausted) {
      this.stats.quotaExhausted = true;
    }

    const shouldSendLocal = forcedLocal || (this.stats.autoFailoverEnabled && isExhausted) || this.stats.activeEngine === 'LOCAL_OLLAMA_QWEN' || this.stats.activeEngine === 'LOCAL_DEEPSEEK';

    let routedEngine = '';
    let isLocal = false;
    let costSek = 0.00;

    if (shouldSendLocal) {
      routedEngine = 'Local Ollama / Qwen2.5:0.5b (192.168.1.114)';
      isLocal = true;
      costSek = 0.00; // Local hardware = 0 SEK
      // Estimate cloud savings compared to commercial rate (e.g. 0.015 SEK per 1k tokens)
      const estimatedCloudCost = (tokensEstimated / 1000) * 0.015;
      this.stats.costSavedSek = parseFloat((this.stats.costSavedSek + estimatedCloudCost).toFixed(2));
      this.stats.totalFailoversCount++;
      this.stats.lastFailoverTimestamp = now;
    } else {
      routedEngine = 'Google Gemini 3.6 Flash (Free Tier Pot)';
      isLocal = false;
      costSek = 0.00; // Still inside free pot
      this.stats.tokensUsed += tokensEstimated;
      this.stats.requestsUsed += 1;
    }

    const logItem = {
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: now,
      engine: routedEngine,
      tokens: tokensEstimated,
      mode: isLocal ? 'Automatsk Lokal Failover (0 SEK)' : 'Gratis Cloud Pot',
      costSek
    };

    this.stats.recentLogs.unshift(logItem);
    if (this.stats.recentLogs.length > 50) this.stats.recentLogs.pop();

    this.saveStats();

    return { routedEngine, isLocal, costSek };
  }

  public setEngineMode(mode: QuotaStats['activeEngine']): void {
    this.stats.activeEngine = mode;
    this.saveStats();
  }

  public setAutoFailover(enabled: boolean): void {
    this.stats.autoFailoverEnabled = enabled;
    this.saveStats();
  }

  public resetQuotaPot(): void {
    this.stats.tokensUsed = 0;
    this.stats.requestsUsed = 0;
    this.stats.quotaExhausted = false;
    this.saveStats();
  }
}

export const orchestratorInstance = new CostAwareOrchestrator();
