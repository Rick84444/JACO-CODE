import { createHash } from 'node:crypto';

const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','best','by','for','from','how','i','in','is','it','of','on','or','that','the','this','to','was','what','when','where','which','who','with',
  'alla','att','av','den','det','en','ett','för','från','har','hur','i','med','och','om','på','som','vad','var','vilken','visa'
]);

const clamp01 = value => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, stableValue(value[key])]),
  );
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value ?? null));
}

function parseValue(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function tokenizeExperienceText(value) {
  const normalized = String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) || [];
  return [...new Set(tokens.filter(token => token.length > 1 && !STOP_WORDS.has(token)))];
}

function experienceSignature(blueprint = {}) {
  return {
    type: blueprint.type ?? null,
    input: blueprint.input ?? null,
    precondition: blueprint.precondition ?? null,
    expected: blueprint.expected ?? null,
  };
}

export function fingerprintExperience(blueprint) {
  return createHash('sha256').update(stableJson(experienceSignature(blueprint))).digest('hex');
}

function compactEvidence({ action, actual, delta, now }) {
  return {
    action_id: action?.id || null,
    verified_at: Number(action?.verified_at) || now(),
    delta: clamp01(delta),
    actual: actual ?? null,
  };
}

function mergeEvidenceHistory(previousBlueprint, currentEvidence, limit = 8) {
  const previous = Array.isArray(previousBlueprint?.evidence?.history)
    ? previousBlueprint.evidence.history
    : previousBlueprint?.evidence?.latest
      ? [previousBlueprint.evidence.latest]
      : [];
  return [...previous, currentEvidence].slice(-Math.max(1, limit));
}

function buildTags(action, mission, previousTags = []) {
  const semanticTokens = tokenizeExperienceText(
    [mission?.title, mission?.goal, action?.type].filter(Boolean).join(' '),
  ).slice(0, 16);
  return [...new Set([
    ...previousTags.map(String).filter(Boolean),
    action?.type,
    mission?.title,
    ...semanticTokens,
  ].filter(Boolean))].slice(0, 32);
}

function ensureExperienceSchema(db) {
  const existing = new Set(
    db.prepare('PRAGMA table_info(experiences)').all().map(row => String(row.name)),
  );
  const columns = [
    ['fingerprint', 'TEXT'],
    ['evidence_count', 'INTEGER NOT NULL DEFAULT 1'],
    ['mean_delta', 'REAL NOT NULL DEFAULT 0.0'],
    ['last_used_at', 'INTEGER'],
  ];
  for (const [name, definition] of columns) {
    if (!existing.has(name)) db.exec(`ALTER TABLE experiences ADD COLUMN ${name} ${definition}`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_experiences_fingerprint ON experiences(fingerprint);
    CREATE INDEX IF NOT EXISTS idx_experiences_quality
      ON experiences(success_rate DESC, evidence_count DESC, uses DESC, promoted_at DESC);
  `);

  const legacy = db.prepare(
    'SELECT id,blueprint,fingerprint,evidence_count,mean_delta FROM experiences',
  ).all();
  const update = db.prepare(
    'UPDATE experiences SET fingerprint=?, evidence_count=?, mean_delta=? WHERE id=?',
  );
  for (const row of legacy) {
    if (row.fingerprint) continue;
    const blueprint = parseValue(row.blueprint, {});
    const delta = clamp01(blueprint?.delta ?? blueprint?.evidence?.latest?.delta ?? row.mean_delta ?? 0);
    update.run(
      fingerprintExperience(blueprint),
      Math.max(1, Number(row.evidence_count) || 1),
      delta,
      row.id,
    );
  }
}

function normalizedRecord(row) {
  return {
    ...row,
    uses: Math.max(0, Number(row.uses) || 0),
    success_rate: clamp01(row.success_rate == null ? 1 : row.success_rate),
    evidence_count: Math.max(1, Number(row.evidence_count) || 1),
    mean_delta: clamp01(row.mean_delta),
    blueprint: parseValue(row.blueprint, {}),
    tags: parseValue(row.tags, []),
  };
}

function textSets(record) {
  const blueprint = record.blueprint || {};
  const tagTokens = new Set(tokenizeExperienceText((record.tags || []).join(' ')));
  const primaryText = [
    blueprint.type,
    blueprint.mission?.title,
    blueprint.mission?.goal,
    stableJson(blueprint.expected),
    stableJson(blueprint.actual),
  ].filter(Boolean).join(' ');
  const primaryTokens = new Set(tokenizeExperienceText(primaryText));
  const fullText = [
    (record.tags || []).join(' '),
    stableJson(blueprint),
  ].join(' ').toLowerCase().replace(/[_-]+/g, ' ');
  const fullTokens = new Set(tokenizeExperienceText(fullText));
  return { tagTokens, primaryTokens, fullTokens, fullText };
}

function relevanceScore(query, record) {
  const queryTokens = tokenizeExperienceText(query);
  if (!queryTokens.length) return 0;
  const { tagTokens, primaryTokens, fullTokens, fullText } = textSets(record);
  let weightedMatches = 0;
  for (const token of queryTokens) {
    if (tagTokens.has(token)) weightedMatches += 1;
    else if (primaryTokens.has(token)) weightedMatches += 0.8;
    else if (fullTokens.has(token)) weightedMatches += 0.5;
  }
  const coverage = weightedMatches / queryTokens.length;
  const phrase = String(query || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  const phraseBonus = phrase.length >= 4 && fullText.includes(phrase) ? 0.12 : 0;
  return clamp01(coverage + phraseBonus);
}

function evidenceScore(record) {
  return clamp01(1 - Math.exp(-Math.max(1, record.evidence_count) / 3));
}

function usageScore(record) {
  return clamp01(1 - Math.exp(-Math.max(0, record.uses) / 5));
}

function qualityScore(record) {
  return clamp01(record.success_rate) * (1 - clamp01(record.mean_delta));
}

function rankRecord(query, record) {
  const relevance = relevanceScore(query, record);
  const quality = qualityScore(record);
  const evidence = evidenceScore(record);
  const usage = usageScore(record);
  const hasQuery = tokenizeExperienceText(query).length > 0;
  const score = hasQuery
    ? 0.68 * relevance + 0.22 * quality + 0.10 * evidence
    : 0.60 * quality + 0.25 * evidence + 0.15 * usage;
  return {
    ...record,
    retrieval: {
      query: String(query || ''),
      relevance: Number(relevance.toFixed(6)),
      quality: Number(quality.toFixed(6)),
      evidence: Number(evidence.toFixed(6)),
      usage: Number(usage.toFixed(6)),
      score: Number(score.toFixed(6)),
    },
  };
}

export function createExperienceStore({
  db,
  emit = () => {},
  uid = () => createHash('sha256').update(String(Math.random())).digest('hex').slice(0, 16),
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('experience store requires sqlite db');
  ensureExperienceSchema(db);

  const selectByFingerprint = db.prepare(
    'SELECT * FROM experiences WHERE fingerprint=? ORDER BY evidence_count DESC,promoted_at DESC LIMIT 1',
  );
  const insertExperience = db.prepare(
    'INSERT INTO experiences(id,blueprint,tags,uses,success_rate,promoted_at,fingerprint,evidence_count,mean_delta) VALUES(?,?,?,?,?,?,?,?,?)',
  );
  const reinforceExperience = db.prepare(
    'UPDATE experiences SET blueprint=?,tags=?,promoted_at=?,evidence_count=?,mean_delta=? WHERE id=?',
  );
  const selectById = db.prepare('SELECT * FROM experiences WHERE id=?');
  const recordUsage = db.prepare(
    'UPDATE experiences SET uses=?,success_rate=?,last_used_at=? WHERE id=?',
  );

  return {
    promote(action = {}, mission = null, actualOverride = undefined) {
      const actual = actualOverride === undefined
        ? parseValue(action.actual, null)
        : parseValue(actualOverride, actualOverride);
      const delta = clamp01(action.delta);
      const evidence = compactEvidence({ action, actual, delta, now });
      const baseBlueprint = {
        schema: 'jaco.experience-blueprint/v1',
        type: action.type || null,
        input: parseValue(action.input, {}),
        precondition: parseValue(action.precondition, {}),
        expected: parseValue(action.expected, {}),
        actual,
        mission: {
          title: mission?.title || null,
          goal: mission?.goal || null,
        },
      };
      const fingerprint = fingerprintExperience(baseBlueprint);
      const existingRaw = selectByFingerprint.get(fingerprint);
      const timestamp = now();

      if (existingRaw) {
        const existing = normalizedRecord(existingRaw);
        const evidenceCount = existing.evidence_count + 1;
        const meanDelta = (
          existing.mean_delta * existing.evidence_count + delta
        ) / evidenceCount;
        const tags = buildTags(action, mission, existing.tags);
        const blueprint = {
          ...baseBlueprint,
          evidence: {
            latest: evidence,
            history: mergeEvidenceHistory(existing.blueprint, evidence),
          },
        };
        reinforceExperience.run(
          stableJson(blueprint),
          JSON.stringify(tags),
          timestamp,
          evidenceCount,
          meanDelta,
          existing.id,
        );
        emit('experience.reinforced', {
          id: existing.id,
          type: action.type || null,
          fingerprint,
          evidence_count: evidenceCount,
          mean_delta: meanDelta,
        });
        return existing.id;
      }

      const id = uid();
      const tags = buildTags(action, mission);
      const blueprint = {
        ...baseBlueprint,
        evidence: {
          latest: evidence,
          history: [evidence],
        },
      };
      insertExperience.run(
        id,
        stableJson(blueprint),
        JSON.stringify(tags),
        0,
        1,
        timestamp,
        fingerprint,
        1,
        delta,
      );
      emit('experience.promoted', {
        id,
        type: action.type || null,
        fingerprint,
        evidence_count: 1,
        mean_delta: delta,
      });
      return id;
    },

    get(id) {
      const row = selectById.get(id);
      return row ? normalizedRecord(row) : null;
    },

    search(query = '', limit = 5) {
      const max = Math.min(50, Math.max(1, Number(limit) || 5));
      const candidateLimit = Math.min(500, Math.max(80, max * 20));
      const rows = db.prepare(
        'SELECT * FROM experiences ORDER BY promoted_at DESC LIMIT ?',
      ).all(candidateLimit).map(normalizedRecord);
      const hasQuery = tokenizeExperienceText(query).length > 0;
      const ranked = rows
        .map(row => rankRecord(query, row))
        .filter(row => !hasQuery || row.retrieval.relevance > 0)
        .sort((a, b) =>
          b.retrieval.score - a.retrieval.score
          || b.evidence_count - a.evidence_count
          || b.promoted_at - a.promoted_at
          || String(a.id).localeCompare(String(b.id)));

      const unique = [];
      const seen = new Set();
      for (const row of ranked) {
        const key = row.fingerprint || row.id;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(row);
        if (unique.length >= max) break;
      }
      return unique;
    },

    recordUse(id, { success } = {}) {
      const raw = selectById.get(id);
      if (!raw) return null;
      const row = normalizedRecord(raw);
      const uses = row.uses + 1;
      const successRate = typeof success === 'boolean'
        ? ((row.success_rate * row.uses) + (success ? 1 : 0)) / uses
        : row.success_rate;
      const timestamp = now();
      recordUsage.run(uses, successRate, timestamp, id);
      const updated = normalizedRecord(selectById.get(id));
      emit('experience.used', {
        id,
        success: typeof success === 'boolean' ? success : null,
        uses: updated.uses,
        success_rate: updated.success_rate,
      });
      return updated;
    },
  };
}
