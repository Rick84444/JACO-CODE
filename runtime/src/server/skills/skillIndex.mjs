import fs from 'node:fs';
import path from 'node:path';
import { normalizeSkillManifest, normalizeProcedure, tokeniseSkillText, assertInside } from './contracts.mjs';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export class SkillIndex {
  constructor({ roots = [] } = {}) {
    this.roots = [...new Set(roots.map(root => path.resolve(root)))];
    this.descriptors = new Map();
    this.refresh();
  }

  refresh() {
    const next = new Map();
    for (const root of this.roots) {
      if (!fs.existsSync(root)) continue;
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const folder = path.join(root, entry.name);
        const manifestFile = path.join(folder, 'skill.json');
        if (!fs.existsSync(manifestFile)) continue;
        const manifest = normalizeSkillManifest(readJson(manifestFile), manifestFile);
        const existing = next.get(manifest.id);
        if (existing && existing.manifest.version === manifest.version) throw new Error('SKILL_DUPLICATE_ID_VERSION:' + manifest.id);
        if (!existing || compareVersions(manifest.version, existing.manifest.version) > 0) {
          next.set(manifest.id, { manifest, folder, manifestFile });
        }
      }
    }
    this.descriptors = next;
    return this.list();
  }

  list({ includeRetired = false } = {}) {
    return [...this.descriptors.values()]
      .map(item => item.manifest)
      .filter(manifest => includeRetired || manifest.status !== 'RETIRED')
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  search(query, { limit = 8, substrates = [] } = {}) {
    const q = tokeniseSkillText(query);
    const requiredSubstrates = new Set(substrates.map(v => String(v).toLowerCase()));
    const scored = [];
    for (const item of this.descriptors.values()) {
      const manifest = item.manifest;
      if (manifest.status === 'RETIRED') continue;
      if (requiredSubstrates.size && !manifest.substrates.some(s => requiredSubstrates.has(String(s).toLowerCase()))) continue;
      const nameTokens = tokeniseSkillText(manifest.name);
      const descriptionTokens = tokeniseSkillText(manifest.description);
      const intentTokens = manifest.intents.flatMap(tokeniseSkillText);
      const tagTokens = manifest.tags.flatMap(tokeniseSkillText);
      let score = 0;
      for (const token of q) {
        if (manifest.id.includes(token)) score += 7;
        if (nameTokens.includes(token)) score += 6;
        if (intentTokens.includes(token)) score += 9;
        if (tagTokens.includes(token)) score += 4;
        if (descriptionTokens.includes(token)) score += 2;
      }
      if (!q.length) score = 1;
      if (score > 0) scored.push({ id: manifest.id, version: manifest.version, name: manifest.name, description: manifest.description, intents: manifest.intents, substrates: manifest.substrates, status: manifest.status, score });
    }
    return scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, Math.max(1, limit));
  }

  getDescriptor(id) {
    const item = this.descriptors.get(String(id));
    if (!item) throw new Error('SKILL_NOT_FOUND:' + id);
    return item.manifest;
  }

  loadInstructions(id) {
    const item = this.descriptors.get(String(id));
    if (!item) throw new Error('SKILL_NOT_FOUND:' + id);
    const file = path.join(item.folder, 'SKILL.md');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  }

  loadProcedure(id, entrypoint = 'main') {
    const item = this.descriptors.get(String(id));
    if (!item) throw new Error('SKILL_NOT_FOUND:' + id);
    const relative = item.manifest.entrypoints[entrypoint];
    if (!relative) throw new Error('SKILL_ENTRYPOINT_NOT_FOUND:' + entrypoint);
    const file = assertInside(item.folder, path.join(item.folder, relative));
    if (!fs.existsSync(file)) throw new Error('SKILL_PROCEDURE_NOT_FOUND:' + relative);
    return normalizeProcedure(readJson(file), file);
  }

  folderFor(id) {
    const item = this.descriptors.get(String(id));
    if (!item) throw new Error('SKILL_NOT_FOUND:' + id);
    return item.folder;
  }
}

function compareVersions(a, b) {
  const pa = String(a).split(/[.+-]/).slice(0, 3).map(v => Number(v) || 0);
  const pb = String(b).split(/[.+-]/).slice(0, 3).map(v => Number(v) || 0);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return String(a).localeCompare(String(b));
}
