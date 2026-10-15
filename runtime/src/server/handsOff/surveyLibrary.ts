import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Survey library — the reconnaissance memory behind Nova Traction.
 *
 * A robot mower maps the lawn once and then reuses the map. The instinct
 * transfers to a UI; the mechanism does not, and measurement showed exactly
 * where the line falls. Across five Explorer windows differing only in folder,
 * size and contents, every whole-window fingerprint came out distinct — the node
 * count alone ranged 88 to 153. The route to a named element resolved in all
 * five. So the durable map is the route, not the picture of the lawn.
 *
 * What this library stores, therefore:
 *
 *   - a survey per observed application state, keyed by a structural
 *     fingerprint (control types and automation ids only — never names, values
 *     or coordinates, which are the parts that vary between instances, locales
 *     and themes);
 *   - the route and operating pattern for every actionable element found;
 *   - how often a state has been seen and whether its routes still resolve.
 *
 * The point is sequencing. A full tree walk measured ~480 ms. Resolving a known
 * automation id is a targeted lookup. Surveying once before a complex run and
 * then executing against the stored routes is roughly an order of magnitude
 * cheaper than rediscovering the screen between every action — and it is the
 * difference between an agent that reasons about a whole screenshot each step
 * and one that already knows what it is looking at.
 */

/**
 * One actionable element. The field names are UI Automation's, because that is
 * where the library was born, but they are deliberately generic enough to carry
 * a second surface. The browser client stores web elements here unchanged:
 *
 *   route        UIA tree route          →  CSS selector
 *   controlType  UIA control type        →  tag name + role
 *   automationId UIA AutomationId        →  DOM id
 *   patterns     UIA patterns supported  →  capabilities (click/setValue/…)
 *
 * Keeping one route memory for both surfaces is the point: a state surveyed in
 * Chrome and a state surveyed in a desktop app answer the same question, and
 * findRoute() should not care which one it is reading.
 */
export interface ActionableElement {
  route: string;
  name: string;
  controlType: string;
  automationId: string;
  patterns: string[];
  depth: number;
  stableKey: string | null;
}

export interface SurveyRecord {
  fingerprint: string;
  /** Conservative semantic guard layered on top of the structural fingerprint. */
  semanticSignature?: string | null;
  semanticAnchors?: string[];
  semanticDriftCount?: number;
  label: string;
  processName: string | null;
  windowName: string;
  actionable: ActionableElement[];
  actionableCount: number;
  nodesWalked: number;
  walkMs: number;
  budgetExhausted: boolean;
  firstSeen: string;
  lastSeen: string;
  timesSeen: number;
  /** Routes proven to still resolve, and those that stopped resolving. */
  routesConfirmed: number;
  routesLost: number;
}

interface LibraryFile {
  version: 1;
  surveys: SurveyRecord[];
}

const MAX_SURVEYS = 300;
const MAX_ACTIONABLE_PER_SURVEY = 400;

export class SurveyLibrary {
  private readonly file: string;
  private cache: LibraryFile | null = null;

  /**
   * `namespace` separates the route memories of different actuation surfaces.
   * It defaults to the desktop path so existing libraries keep resolving.
   */
  constructor(workspaceRoot: string, namespace = 'desktop-hands-off') {
    this.file = path.join(workspaceRoot, '.jaco', 'state', namespace, 'survey-library.json');
  }

  private load(): LibraryFile {
    if (this.cache) return this.cache;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<LibraryFile>;
      this.cache = { version: 1, surveys: Array.isArray(parsed.surveys) ? parsed.surveys : [] };
    } catch {
      this.cache = { version: 1, surveys: [] };
    }
    return this.cache;
  }

  private persist(): void {
    const data = this.load();
    data.surveys = data.surveys
      .sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen))
      .slice(0, MAX_SURVEYS);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }

  /** Have we surveyed this exact application state before? */
  public recall(fingerprint: string): SurveyRecord | undefined {
    return this.load().surveys.find((survey) => survey.fingerprint === fingerprint);
  }

  /**
   * Records a survey. A repeat sighting updates the existing record rather than
   * appending, so `timesSeen` measures how stable a state actually is instead of
   * how often the library was written to.
   */
  public record(input: {
    fingerprint: string;
    semanticSignature?: string | null;
    semanticAnchors?: string[];
    windowName: string;
    processName: string | null;
    actionable: ActionableElement[];
    nodesWalked: number;
    walkMs: number;
    budgetExhausted: boolean;
    label?: string;
  }): { record: SurveyRecord; recognised: boolean; semanticMatched: boolean } {
    const data = this.load();
    const now = new Date().toISOString();
    const existing = data.surveys.find((survey) => survey.fingerprint === input.fingerprint);
    const actionable = input.actionable.slice(0, MAX_ACTIONABLE_PER_SURVEY);

    if (existing) {
      // A structural fingerprint is only a fast candidate key. Semantic anchors
      // prevent a structurally identical screen (e.g. Save vs Publish) from
      // silently reusing a route with different meaning.
      const semanticMatched = !existing.semanticSignature || !input.semanticSignature || existing.semanticSignature === input.semanticSignature;
      if (!semanticMatched) existing.semanticDriftCount = (existing.semanticDriftCount || 0) + 1;

      // Routes that were present before and are gone now are the useful signal:
      // the application changed under a fingerprint we thought we knew.
      const previous = new Set(existing.actionable.map((entry) => entry.route));
      const current = new Set(actionable.map((entry) => entry.route));
      existing.routesConfirmed = semanticMatched ? [...current].filter((route) => previous.has(route)).length : 0;
      existing.routesLost = semanticMatched ? [...previous].filter((route) => !current.has(route)).length : previous.size;
      existing.semanticSignature = input.semanticSignature ?? existing.semanticSignature ?? null;
      existing.semanticAnchors = input.semanticAnchors?.slice(0, 80) ?? existing.semanticAnchors ?? [];
      existing.actionable = actionable;
      existing.actionableCount = actionable.length;
      existing.nodesWalked = input.nodesWalked;
      existing.walkMs = input.walkMs;
      existing.budgetExhausted = input.budgetExhausted;
      existing.windowName = input.windowName;
      existing.lastSeen = now;
      existing.timesSeen += 1;
      if (input.label) existing.label = input.label;
      this.persist();
      return { record: existing, recognised: true, semanticMatched };
    }

    const record: SurveyRecord = {
      fingerprint: input.fingerprint,
      semanticSignature: input.semanticSignature ?? null,
      semanticAnchors: input.semanticAnchors?.slice(0, 80) ?? [],
      semanticDriftCount: 0,
      label: input.label || input.windowName.slice(0, 120) || 'unlabelled state',
      processName: input.processName,
      windowName: input.windowName,
      actionable,
      actionableCount: actionable.length,
      nodesWalked: input.nodesWalked,
      walkMs: input.walkMs,
      budgetExhausted: input.budgetExhausted,
      firstSeen: now,
      lastSeen: now,
      timesSeen: 1,
      routesConfirmed: 0,
      routesLost: 0,
    };
    data.surveys.unshift(record);
    this.persist();
    return { record, recognised: false, semanticMatched: true };
  }

  /**
   * Finds a stored route to an element by name or automation id, across every
   * surveyed state of a process. This is what lets a later run skip discovery:
   * ask for "Publish" in `chrome` and get back the id to resolve directly.
   */
  public findRoute(query: { processName?: string; name?: string; automationId?: string; semanticSignature?: string }): Array<{
    fingerprint: string;
    label: string;
    element: ActionableElement;
  }> {
    const wantedName = query.name?.toLowerCase();
    const results: Array<{ fingerprint: string; label: string; element: ActionableElement }> = [];

    for (const survey of this.load().surveys) {
      if (query.processName && survey.processName?.toLowerCase() !== query.processName.toLowerCase()) continue;
      if (query.semanticSignature && survey.semanticSignature !== query.semanticSignature) continue;
      for (const element of survey.actionable) {
        const nameHit = wantedName ? (element.name || '').toLowerCase().includes(wantedName) : false;
        const idHit = query.automationId ? element.automationId === query.automationId : false;
        if (nameHit || idHit) results.push({ fingerprint: survey.fingerprint, label: survey.label, element });
      }
    }
    return results;
  }

  public list(limit = 50): SurveyRecord[] {
    return this.load().surveys.slice(0, Math.max(1, Math.min(limit, MAX_SURVEYS)));
  }

  public stats(): Record<string, unknown> {
    const surveys = this.load().surveys;
    const processes = new Map<string, number>();
    for (const survey of surveys) {
      const key = survey.processName || 'unknown';
      processes.set(key, (processes.get(key) ?? 0) + 1);
    }
    const repeats = surveys.filter((survey) => survey.timesSeen > 1);
    return {
      states: surveys.length,
      totalActionable: surveys.reduce((sum, survey) => sum + survey.actionableCount, 0),
      statesSeenMoreThanOnce: repeats.length,
      // How well fingerprints actually hold up on a second sighting. A high
      // routesLost figure means the fingerprint is matching states that are not
      // really the same, which is the failure mode worth watching.
      routesConfirmed: repeats.reduce((sum, survey) => sum + survey.routesConfirmed, 0),
      routesLost: repeats.reduce((sum, survey) => sum + survey.routesLost, 0),
      semanticDrift: surveys.reduce((sum, survey) => sum + (survey.semanticDriftCount || 0), 0),
      byProcess: Object.fromEntries(processes),
      averageWalkMs: surveys.length ? Math.round(surveys.reduce((sum, s) => sum + s.walkMs, 0) / surveys.length) : 0,
    };
  }
}
