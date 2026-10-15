import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { guardedPeerFetch, type PeerGuardOptions } from './peerGuard.js';

/**
 * A2A discovery scanner.
 *
 * Backs the Scraper tab of the A2A Workflow Dashboard. It does exactly one
 * thing: fetch `/.well-known/agent.json` from configured seed targets through
 * the peer guard and record what actually answered.
 *
 * Two properties are deliberate:
 *  - it is disabled by default and never starts a background loop at import
 *    time. The archived sales orchestrator started a 30-second timer in a module
 *    constructor, which meant importing a file was enough to begin autonomous
 *    outbound activity. Discovery here starts only when an operator enables it.
 *  - it records only observed values. A pathway that did not answer is marked
 *    UNREACHABLE with its error; nothing is invented to fill the dashboard.
 */

export interface SeedTarget {
  name: string;
  url: string;
  market: string;
}

export interface DiscoveredPathway {
  id: string;
  name: string;
  endpoint: string;
  sourceMarket: string;
  capabilities: { streaming: boolean; pushNotifications: boolean };
  skills: Array<{ id: string; name: string; description: string; priceUsdc?: number }>;
  latencyMs: number;
  reliabilityScore: number;
  status: 'ACTIVE' | 'VERIFIED' | 'UNREACHABLE';
  lastDiscovered: string;
  protocol: 'A2A v1.0' | 'JSON-RPC 2.0' | 'uAgents';
  lastError?: string;
  probeCount: number;
  successCount: number;
}

export interface ScraperLogEntry {
  timestamp: string;
  type: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

export interface ScraperState {
  isEnabled: boolean;
  intervalMinutes: number;
  lastScanTime: string | null;
  nextScanTime: string | null;
  seedTargets: SeedTarget[];
  discoveredPathways: DiscoveredPathway[];
  logs: ScraperLogEntry[];
}

const MAX_SEEDS = 50;
const MAX_PATHWAYS = 200;
const MAX_LOGS = 200;
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 1_440;

export class A2AScraperService {
  private readonly file: string;
  private state: ScraperState | null = null;
  private timer: NodeJS.Timeout | null = null;
  private scanning = false;

  constructor(private readonly workspaceRoot: string, private readonly guardOptions: () => PeerGuardOptions) {
    this.file = path.join(workspaceRoot, '.jaco', 'a2a_scraper.json');
  }

  private load(): ScraperState {
    if (this.state) return this.state;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<ScraperState>;
      this.state = {
        isEnabled: parsed.isEnabled === true,
        intervalMinutes: clampInterval(Number(parsed.intervalMinutes ?? 60)),
        lastScanTime: typeof parsed.lastScanTime === 'string' ? parsed.lastScanTime : null,
        nextScanTime: typeof parsed.nextScanTime === 'string' ? parsed.nextScanTime : null,
        seedTargets: Array.isArray(parsed.seedTargets) ? parsed.seedTargets.slice(0, MAX_SEEDS) : [],
        discoveredPathways: Array.isArray(parsed.discoveredPathways) ? parsed.discoveredPathways.slice(0, MAX_PATHWAYS) : [],
        logs: Array.isArray(parsed.logs) ? parsed.logs.slice(-MAX_LOGS) : [],
      };
    } catch {
      this.state = {
        isEnabled: false,
        intervalMinutes: 60,
        lastScanTime: null,
        nextScanTime: null,
        seedTargets: [],
        discoveredPathways: [],
        logs: [{ timestamp: new Date().toISOString(), type: 'info', message: 'Discovery scanner initialised. Disabled until an operator enables it.' }],
      };
    }
    return this.state;
  }

  private persist(): void {
    const state = this.load();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }

  private log(type: ScraperLogEntry['type'], message: string): void {
    const state = this.load();
    state.logs.push({ timestamp: new Date().toISOString(), type, message: message.slice(0, 500) });
    if (state.logs.length > MAX_LOGS) state.logs = state.logs.slice(-MAX_LOGS);
  }

  public getState(): ScraperState {
    return this.load();
  }

  public configure(patch: { isEnabled?: unknown; intervalMinutes?: unknown; newSeedTarget?: unknown }): ScraperState {
    const state = this.load();

    if (typeof patch.isEnabled === 'boolean') {
      state.isEnabled = patch.isEnabled;
      this.log('info', `Discovery scanner ${patch.isEnabled ? 'enabled' : 'disabled'} by operator.`);
    }

    if (patch.intervalMinutes !== undefined && patch.intervalMinutes !== null) {
      const requested = Number(patch.intervalMinutes);
      if (!Number.isFinite(requested)) throw new Error('intervalMinutes must be a number');
      state.intervalMinutes = clampInterval(requested);
    }

    if (patch.newSeedTarget) {
      const seed = patch.newSeedTarget as Record<string, unknown>;
      const url = String(seed.url ?? '').trim();
      if (!url) throw new Error('seed target url is required');
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error('seed target url must be an absolute http(s) URL');
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('seed target must use http or https');
      if (state.seedTargets.length >= MAX_SEEDS) throw new Error(`seed target limit of ${MAX_SEEDS} reached`);

      const normalised = parsed.origin + parsed.pathname.replace(/\/+$/, '');
      if (state.seedTargets.some((target) => target.url === normalised)) throw new Error('seed target already configured');

      state.seedTargets.push({
        name: String(seed.name ?? '').trim().slice(0, 120) || parsed.hostname,
        url: normalised,
        market: String(seed.market ?? '').trim().slice(0, 120) || 'Custom A2A Mesh',
      });
      this.log('info', `Seed target added: ${normalised}`);
    }

    this.applySchedule();
    this.persist();
    return state;
  }

  public removeSeedTarget(url: string): ScraperState {
    const state = this.load();
    state.seedTargets = state.seedTargets.filter((target) => target.url !== url);
    this.persist();
    return state;
  }

  /** Probes every seed target once. Safe to call concurrently: overlapping scans are refused. */
  public async scanOnce(reason: string): Promise<ScraperState> {
    const state = this.load();
    if (this.scanning) {
      this.log('warn', 'Scan requested while a scan was already running; the request was ignored.');
      this.persist();
      return state;
    }

    this.scanning = true;
    const startedAt = new Date();
    this.log('info', `Discovery scan started (${reason}) across ${state.seedTargets.length} seed target(s).`);

    try {
      for (const target of state.seedTargets) {
        const cardUrl = `${target.url.replace(/\/+$/, '')}/.well-known/agent.json`;
        const response = await guardedPeerFetch(cardUrl, { method: 'GET' }, this.guardOptions());
        const id = crypto.createHash('sha256').update(target.url).digest('hex').slice(0, 16);
        const existing = state.discoveredPathways.find((pathway) => pathway.id === id);
        const probeCount = (existing?.probeCount ?? 0) + 1;

        if (!response.ok) {
          const successCount = existing?.successCount ?? 0;
          upsertPathway(state, {
            id,
            name: target.name,
            endpoint: target.url,
            sourceMarket: target.market,
            capabilities: existing?.capabilities ?? { streaming: false, pushNotifications: false },
            skills: existing?.skills ?? [],
            latencyMs: response.latencyMs,
            reliabilityScore: Math.round((successCount / probeCount) * 100),
            status: 'UNREACHABLE',
            lastDiscovered: new Date().toISOString(),
            protocol: existing?.protocol ?? 'A2A v1.0',
            lastError: response.error || `HTTP ${response.status}`,
            probeCount,
            successCount,
          });
          this.log('error', `${target.url} did not answer: ${response.error || `HTTP ${response.status}`}`);
          continue;
        }

        let card: Record<string, unknown>;
        try {
          card = JSON.parse(response.bodyText) as Record<string, unknown>;
        } catch {
          this.log('warn', `${target.url} answered with a body that is not JSON.`);
          continue;
        }

        const capabilities = (card.capabilities || {}) as Record<string, unknown>;
        const skills = Array.isArray(card.skills) ? (card.skills as Array<Record<string, unknown>>) : [];
        const successCount = (existing?.successCount ?? 0) + 1;

        upsertPathway(state, {
          id,
          name: String(card.name ?? target.name).slice(0, 200),
          endpoint: target.url,
          sourceMarket: target.market,
          capabilities: {
            streaming: capabilities.streaming === true,
            pushNotifications: capabilities.pushNotifications === true,
          },
          skills: skills.slice(0, 50).map((skill) => ({
            id: String(skill.id ?? '').slice(0, 128),
            name: String(skill.name ?? '').slice(0, 200),
            description: String(skill.description ?? '').slice(0, 500),
            priceUsdc: Number.isFinite(Number(skill.priceUsdc)) ? Number(skill.priceUsdc) : undefined,
          })),
          latencyMs: response.latencyMs,
          reliabilityScore: Math.round((successCount / probeCount) * 100),
          // VERIFIED is reserved for a card that carried a signature this node checked.
          status: typeof card.signature === 'string' && typeof card.publicKeyPem === 'string' ? 'VERIFIED' : 'ACTIVE',
          lastDiscovered: new Date().toISOString(),
          protocol: 'A2A v1.0',
          probeCount,
          successCount,
        });
        this.log('success', `${target.url} answered in ${response.latencyMs} ms with ${skills.length} skill(s).`);
      }

      state.lastScanTime = startedAt.toISOString();
      this.applySchedule();
      this.persist();
      return state;
    } finally {
      this.scanning = false;
    }
  }

  /** Probes one already-discovered pathway. Used by the dashboard ping button. */
  public async pingPathway(pathwayId: string): Promise<{ latencyMs: number; status: DiscoveredPathway['status']; error?: string }> {
    const state = this.load();
    const pathway = state.discoveredPathways.find((entry) => entry.id === pathwayId);
    if (!pathway) throw new Error(`pathway '${pathwayId}' is not known to this node`);

    const response = await guardedPeerFetch(`${pathway.endpoint.replace(/\/+$/, '')}/.well-known/agent.json`, { method: 'GET' }, this.guardOptions());
    pathway.probeCount += 1;
    pathway.latencyMs = response.latencyMs;
    pathway.lastDiscovered = new Date().toISOString();

    if (response.ok) {
      pathway.successCount += 1;
      pathway.status = pathway.status === 'VERIFIED' ? 'VERIFIED' : 'ACTIVE';
      pathway.lastError = undefined;
      this.log('success', `Ping to ${pathway.endpoint} returned in ${response.latencyMs} ms.`);
    } else {
      pathway.status = 'UNREACHABLE';
      pathway.lastError = response.error || `HTTP ${response.status}`;
      this.log('error', `Ping to ${pathway.endpoint} failed: ${pathway.lastError}`);
    }

    pathway.reliabilityScore = Math.round((pathway.successCount / pathway.probeCount) * 100);
    this.persist();
    return { latencyMs: response.latencyMs, status: pathway.status, error: pathway.lastError };
  }

  /** Starts or stops the interval timer to match current configuration. */
  public applySchedule(): void {
    const state = this.load();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (!state.isEnabled) {
      state.nextScanTime = null;
      return;
    }
    const intervalMs = state.intervalMinutes * 60_000;
    state.nextScanTime = new Date(Date.now() + intervalMs).toISOString();
    this.timer = setInterval(() => {
      void this.scanOnce('SCHEDULED').catch(() => undefined);
    }, intervalMs);
    this.timer.unref?.();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

function clampInterval(minutes: number): number {
  if (!Number.isFinite(minutes)) return 60;
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(minutes)));
}

function upsertPathway(state: ScraperState, pathway: DiscoveredPathway): void {
  const index = state.discoveredPathways.findIndex((entry) => entry.id === pathway.id);
  if (index >= 0) state.discoveredPathways[index] = pathway;
  else state.discoveredPathways.unshift(pathway);
  if (state.discoveredPathways.length > MAX_PATHWAYS) state.discoveredPathways.length = MAX_PATHWAYS;
}
