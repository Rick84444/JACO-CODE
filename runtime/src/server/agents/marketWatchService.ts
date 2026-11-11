import crypto from 'crypto';
import { generate } from '../modelPool/poolManager.js';
import { recordExternalMeasurement, CompetitorIntelItem } from './competitorIntelligence.js';
import { CompetitiveIntelligenceMemoryItem, TrackedCompetitorTarget, MarketWatchServiceState } from '../../types.js';

// Pre-configured list of tracked competitors and frontier frameworks
const INITIAL_TRACKED_TARGETS: TrackedCompetitorTarget[] = [
  {
    id: 'target_cursor',
    name: 'Cursor AI & Claude Code',
    ecosystem: 'Anthropic / Anysphere',
    targetUrls: [
      'https://docs.cursor.com/agent/subgoals',
      'https://anthropic.com/claude-code/subtask-architecture'
    ],
    focusAreas: ['Atomic Subgoal Decomposition', 'AST Gate Validation', 'Terminal Execution Safeguards'],
    lastScannedAt: null,
    status: 'active',
    discoveredSignalsCount: 0
  },
  {
    id: 'target_devin',
    name: 'Devin',
    ecosystem: 'Cognition AI',
    targetUrls: [
      'https://cognition.ai/blog/devin-architecture-memory',
      'https://github.com/aistudio-build/jaco-specs'
    ],
    focusAreas: ['Compressed Memory Distillation', 'Long-Horizon Checkpointing', 'Error Recovery Loops'],
    lastScannedAt: null,
    status: 'active',
    discoveredSignalsCount: 0
  },
  {
    id: 'target_windsurf',
    name: 'Windsurf Cascade',
    ecosystem: 'Codeium',
    targetUrls: [
      'https://codeium.com/windsurf/cascade',
      'https://arxiv.org/abs/2402.multi-agent-verification'
    ],
    focusAreas: ['Dual-Agent Verification Gates', 'Real-Time Tool Execution Mesh', 'Adversarial Falsifiers'],
    lastScannedAt: null,
    status: 'active',
    discoveredSignalsCount: 0
  },
  {
    id: 'target_openai_swarm',
    name: 'OpenAI Swarm & Operator',
    ecosystem: 'OpenAI',
    targetUrls: [
      'https://github.com/openai/swarm',
      'https://platform.openai.com/docs/guides/function-calling'
    ],
    focusAreas: ['Lightweight A2A Handshake Protocols', 'Decentralized Agent Routing', 'Stateless Tool Calling'],
    lastScannedAt: null,
    status: 'active',
    discoveredSignalsCount: 0
  },
  {
    id: 'target_opengate_autogpt',
    name: 'OpenClaw & AutoGPT Mesh',
    ecosystem: 'Open Agent Foundation',
    targetUrls: [
      'https://github.com/Significant-Gravitas/AutoGPT',
      'https://github.com/Rick84444/jaco-code'
    ],
    focusAreas: ['Autonomous Web Scraping', 'P2P Capability Discovery', 'Decentralized Skill Marketplaces'],
    lastScannedAt: null,
    status: 'active',
    discoveredSignalsCount: 0
  }
];

// Legacy seed claims had fabricated metrics and simulated timestamps.
// They must not ship as observed research or steer Aura's decisions.
const INITIAL_INTELLIGENCE_ITEMS: CompetitiveIntelligenceMemoryItem[] = [];

class MarketWatchService {
  private isRunning: boolean = true;
  private pollingIntervalSeconds: number = 180; // 3 minutes default
  private timer: NodeJS.Timeout | null = null;
  private lastScanTimestamp: string | null = null;
  private nextScheduledScan: string | null = new Date(Date.now() + 180000).toISOString();
  private totalScansCompleted: number = 0;
  private trackedTargets: TrackedCompetitorTarget[] = [...INITIAL_TRACKED_TARGETS];
  private intelligenceItems: CompetitiveIntelligenceMemoryItem[] = [...INITIAL_INTELLIGENCE_ITEMS];
  private autoInjectIntoReasoning: boolean = false;

  private scanInFlight = false;

  constructor() {
    // Every scan is an LLM call; only run on a timer when the operator opts in (or starts it via the API).
    if (process.env.JACO_BACKGROUND_INTEL === '1') {
      this.startPeriodicScan();
    } else {
      this.isRunning = false;
      this.nextScheduledScan = null;
    }
  }

  /**
   * Returns the current Market Watch state
   */
  public getState(): MarketWatchServiceState {
    return {
      isRunning: this.isRunning,
      pollingIntervalSeconds: this.pollingIntervalSeconds,
      lastScanTimestamp: this.lastScanTimestamp,
      nextScheduledScan: this.nextScheduledScan,
      totalScansCompleted: this.totalScansCompleted,
      totalIntelligenceGathered: this.intelligenceItems.length,
      autoInjectIntoReasoning: this.autoInjectIntoReasoning,
      trackedTargets: [...this.trackedTargets],
      recentIntelligence: [...this.intelligenceItems]
    };
  }

  /**
   * Starts periodic monitoring
   */
  public startPeriodicScan(intervalSec?: number) {
    if (intervalSec && intervalSec > 0) {
      this.pollingIntervalSeconds = intervalSec;
    }
    this.isRunning = true;
    this.nextScheduledScan = new Date(Date.now() + this.pollingIntervalSeconds * 1000).toISOString();

    if (this.timer) {
      clearInterval(this.timer);
    }

    this.timer = setInterval(() => {
      if (this.isRunning && !this.scanInFlight) {
        this.scanInFlight = true;
        this.runAutonomousScan().catch((err) => {
          console.warn('[Market Watch Autonomous Scan Error]:', err.message);
        }).finally(() => {
          this.scanInFlight = false;
        });
      }
    }, this.pollingIntervalSeconds * 1000);
  }

  /**
   * Stops periodic monitoring
   */
  public stopPeriodicScan() {
    this.isRunning = false;
    this.nextScheduledScan = null;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Changes the polling interval
   */
  public setIntervalSeconds(intervalSec: number) {
    if (intervalSec < 30) intervalSec = 30; // At least 30s
    this.pollingIntervalSeconds = intervalSec;
    if (this.isRunning) {
      this.startPeriodicScan(intervalSec);
    }
  }

  /**
   * Toggles auto-injection into the reasoning engine
   */
  public setAutoInject(enabled: boolean) {
    this.autoInjectIntoReasoning = enabled;
  }

  /**
   * Runs OpenClaw to scrape and synthesize a competitor insight
   */
  public async executeOpenClawScrape(targetId?: string, customQuery?: string): Promise<{
    success: boolean;
    item: CompetitiveIntelligenceMemoryItem;
    digest: string;
    message: string;
  }> {
    const target = this.trackedTargets.find(t => t.id === targetId) || this.trackedTargets[Math.floor(Math.random() * this.trackedTargets.length)];
    const nowIso = new Date().toISOString();
    const openClawTaskId = `task-oc-mw-${Date.now()}`;

    // Mark target as scanning
    target.status = 'scanning';
    target.lastScannedAt = nowIso;

    const query = customQuery || `Latest feature updates, atomic subtask decomposition, memory compression and reasoning patterns in ${target.name} (${target.ecosystem})`;
    const targetUrl = target.targetUrls[0] || 'https://github.com/Rick84444/jaco-code';

    let rawCrawlData = '';
    try {
      // Try to fetch data via OpenClaw / HTTP
      const fetchRes = await fetch(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (JACO-OpenClaw-Market-Watch-Bot/2.0)' },
        signal: AbortSignal.timeout(6000)
      }).catch(() => null);

      if (fetchRes && fetchRes.ok) {
        const text = await fetchRes.text();
        rawCrawlData = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 2000);
      }
    } catch {
      // Ignore HTTP errors and continue to model synthesis
    }

    // No fetched source is no observed market signal. The model's prior
    // knowledge cannot be attributed to a fabricated web observation.
    if (!rawCrawlData.trim()) {
      target.status = 'active';
      throw new Error('MARKET_WATCH_SOURCE_UNAVAILABLE');
    }

    // Build the LLM prompt that compresses competitor data into a structured Competitive Intelligence memory item
    const prompt = `
You are the OpenClaw Market Watch & Competitive Intelligence Scraper Agent for JACO OS.
We continuously monitor the competitive landscape: ${target.name} (${target.ecosystem}).
Focus areas: ${target.focusAreas.join(', ')}.

Extracted raw data (OpenClaw crawl):
${rawCrawlData}

Synthesize a new 'Competitive Intelligence' memory node in strict JSON format:
{
  "competitorName": "${target.name}",
  "featureDomain": "SUBGOAL_DECOMPOSITION" | "COMPRESSED_MEMORY_RAG" | "A2A_PROTOCOL" | "AUTONOMOUS_DAEMON" | "AST_PATCHING" | "EDGE_NPU" | "TEST_GATES",
  "observedUpdate": "1-2 sentences on what the competitor introduced or improved",
  "architecturalBreakdown": "In-depth architectural explanation of the mechanism (why it works and why it increases determinism)",
  "compressedDigest": "[COMPRESSED MEMORY] An ultra-compressed 1-2 sentence memory node that can be injected directly into the reasoning engine and RAG to steer future task planning.",
  "tacticalCounterStrategy": "Exactly how JACO's reasoning engine should counter and surpass this pattern.",
  "impactOnUpcomingPlans": "How this directly shapes future subgoal decomposition, agent assignment or test gates.",
  "confidenceScore": 95,
  "sourceUrls": ["${targetUrl}"]
}
`.trim();

    try {
      const res = await generate({
        prompt,
        systemPrompt: 'You are the OpenClaw Market Watch Engine. Respond exclusively with valid JSON.'
      });

      let parsed: any = {};
      try {
        const cleaned = res.text.replace(/```json|```/g, '').trim();
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
          parsed = JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
        } else {
          parsed = JSON.parse(cleaned);
        }
      } catch {
        throw new Error('MARKET_WATCH_MODEL_OUTPUT_INVALID');
      }

      const proofHash = crypto.createHash('sha256').update(JSON.stringify(parsed) + nowIso).digest('hex').substring(0, 16);

      const newItem: CompetitiveIntelligenceMemoryItem = {
        id: `ci_mem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        timestamp: nowIso,
        competitorName: parsed.competitorName || target.name,
        featureDomain: parsed.featureDomain || 'SUBGOAL_DECOMPOSITION',
        observedUpdate: parsed.observedUpdate || `Update observed in ${target.focusAreas[0]}.`,
        architecturalBreakdown: parsed.architecturalBreakdown || 'Optimized subtask execution with isolated memory context.',
        compressedDigest: parsed.compressedDigest || `[COMPRESSED MEMORY] ${target.name}: Apply granular subgoals and deterministic test contracts.`,
        tacticalCounterStrategy: parsed.tacticalCounterStrategy || 'Integrate synthesized memory vectors into every new subgoal decision.',
        impactOnUpcomingPlans: parsed.impactOnUpcomingPlans || 'Requires at least 5 atomic subgoals and verification logs in future blueprints.',
        // A model-generated confidence is not a verified measurement.
        confidenceScore: 0,
        verificationLevel: 'OBSERVED',
        sourceDigest: crypto.createHash('sha256').update(rawCrawlData).digest('hex'),
        // Only cite the fetched URL. URLs invented by the model are not proof.
        sourceUrls: [targetUrl],
        proofHash,
        rawOpenClawTaskId: openClawTaskId,
        status: 'active'
      };

      this.intelligenceItems.unshift(newItem);
      if (this.intelligenceItems.length > 50) this.intelligenceItems.pop();

      target.status = 'active';
      target.discoveredSignalsCount++;
      this.totalScansCompleted++;
      this.lastScanTimestamp = nowIso;
      this.nextScheduledScan = new Date(Date.now() + this.pollingIntervalSeconds * 1000).toISOString();

      // Update external KPIs
      recordExternalMeasurement({
        metricKey: 'compressed_memory_count',
        currentValue: this.intelligenceItems.length,
        unit: 'nodes'
      });

      return {
        success: true,
        item: newItem,
        digest: newItem.compressedDigest,
        message: `OpenClaw Market Watch scraped ${target.name} and compressed new Competitive Intelligence.`
      };
    } catch (err: any) {
      // Fallback generation
      const fallbackProof = crypto.createHash('sha256').update('fallback_mw_' + target.id + nowIso).digest('hex').substring(0, 16);
      const fallbackItem: CompetitiveIntelligenceMemoryItem = {
        id: `ci_mem_auto_${Date.now()}`,
        timestamp: nowIso,
        competitorName: target.name,
        featureDomain: 'SUBGOAL_DECOMPOSITION',
        observedUpdate: `Periodic scan of ${target.name}: introduced deterministic sub-steps and memory contracts.`,
        architecturalBreakdown: 'Granular breakdown into short subtasks with independent context windows maximizes accuracy.',
        compressedDigest: `[COMPRESSED MEMORY] ${target.name} Pattern: Split plans into at least 5 atomic subgoals with explicit linter and build gates.`,
        tacticalCounterStrategy: 'Ensure every new JACO plan is validated with live commands before the next subgoal starts.',
        impactOnUpcomingPlans: 'Injects test contracts and sub-agent delegation into future subgoals.',
        confidenceScore: 90,
        sourceUrls: target.targetUrls,
        proofHash: fallbackProof,
        rawOpenClawTaskId: openClawTaskId,
        status: 'active'
      };

      // Keep a diagnostic for callers, but do not insert a fabricated signal
      // into memory, counters or the evidence used by Aura.
      target.status = 'active';
      this.lastScanTimestamp = nowIso;
      return {
        success: false,
        item: { ...fallbackItem, confidenceScore: 0, verificationLevel: 'SYNTHETIC', sourceUrls: [] },
        digest: '',
        message: `[UNKNOWN] Market Watch could not verify a source or parse the model response: ${String(err?.message || err).slice(0, 150)}`
      };
    }
  }

  /**
   * Runs an automated scan of all competitors or the next one
   */
  public async runAutonomousScan(): Promise<void> {
    const nextTarget = this.trackedTargets.reduce((oldest, current) => {
      const oldestTime = oldest.lastScannedAt ? new Date(oldest.lastScannedAt).getTime() : 0;
      const currentTime = current.lastScannedAt ? new Date(current.lastScannedAt).getTime() : 0;
      return currentTime < oldestTime ? current : oldest;
    }, this.trackedTargets[0]);

    if (nextTarget) {
      await this.executeOpenClawScrape(nextTarget.id);
    }
  }

  /**
   * Returns the compiled context string to inject into the reasoning engine and planDecide.ts
   */
  public getMarketWatchReasoningContext(): string {
    // The current Market Watch has fetched text and model summaries, but no
    // independent source/claim verifier connected to the canonical EvidenceLedger.
    // Until that verification exists, neither seeds nor summaries may become
    // planning instructions, even when auto-injection is switched on.
    return '[MARKET WATCH] No independently verified market claims available. Treat market research as an open hypothesis; use real research tools and verify primary sources before acting.';
  }

  /**
   * Returns all stored intelligence entries
   */
  public listIntelligence(): CompetitiveIntelligenceMemoryItem[] {
    return [...this.intelligenceItems];
  }
}

// Singleton instance of the Market Watch Service
export const marketWatchService = new MarketWatchService();
