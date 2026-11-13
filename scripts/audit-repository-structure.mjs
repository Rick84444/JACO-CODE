#!/usr/bin/env node
/**
 * Git-tree-based structural debt inventory. Reports evidence; never deletes files
 * or equates passing a static scan with zero architectural/host debt.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function parseGitTree(raw) {
  if (typeof raw !== 'string' || !raw.includes('\0')) throw new Error('GIT_TREE_MISSING_NUL_RECORDS');
  return raw.split('\0').filter(Boolean).map(record => {
    const match = /^(\d{6}) (blob|commit) ([0-9a-f]{40})\t(.+)$/s.exec(record);
    if (!match) throw new Error('GIT_TREE_RECORD_INVALID:' + record.slice(0, 80));
    return { mode: match[1], type: match[2], sha: match[3], path: match[4] };
  });
}

export function duplicateClass(paths) {
  const names = [...paths].sort();
  if (names.length === 2 && names.includes('start.sh') && names.includes('runtime/start.sh')) return 'ENTRYPOINT_DUPLICATE_REVIEW';
  if (names.length === 2 && names[0].startsWith('public/') &&
      names[1] === 'runtime/' + names[0]) return 'PUBLIC_DISTRIBUTION_MIRROR';
  if (names.every(name => name.endsWith('/LICENSE') || name === 'LICENSE')) return 'LICENSE_DISTRIBUTION_COPY';
  if (names.length === 2 && names.includes('runtime/src/adk/index.mjs') && names.includes('runtime/src/adk/index.d.mts')) return 'ESM_TYPE_SHIM_REVIEW';
  if (names.every(name => /(?:^|\/)(?:branding|brand|media)\//.test(name))) return 'BRAND_DISTRIBUTION_COPY_REVIEW';
  return 'UNCLASSIFIED_REVIEW';
}

export function auditGitEntries(entries, { rootPackage = {}, rootLauncher = '' } = {}) {
  const files = entries.filter(x => x.type === 'blob');
  const bySha = new Map();
  for (const file of files) {
    if (!bySha.has(file.sha)) bySha.set(file.sha, []);
    bySha.get(file.sha).push(file.path);
  }
  const exactDuplicates = [...bySha.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([sha, names]) => ({
      sha, paths: names.sort(), category: duplicateClass(names),
    }))
    .sort((a, b) => a.paths.join('|').localeCompare(b.paths.join('|')));
  const source = new Set(files.map(f => f.path));
  const staticRisks = [];
  if (source.has('start.sh') && source.has('runtime/start.sh') &&
      !rootPackage.scripts?.start && rootLauncher.includes('npm run start')) {
    staticRisks.push({
      id: 'ROOT_LAUNCHER_SCRIPT_DRIFT',
      evidence: ['start.sh', 'runtime/start.sh', 'package.json'],
      limitation: 'Static inconsistency only. Runtime execution and distribution compatibility are not proved.',
    });
  }
  return {
    schema: 'jaco.repository-structural-debt-inventory/v1',
    status: 'INVENTORIED_NOT_DEBT_FREE',
    coverage: 'ALL_TRACKED_GIT_BLOBS_AT_HEAD',
    summary: {
      trackedFiles: files.length,
      duplicateGroups: exactDuplicates.length,
      duplicateFileOccurrences: exactDuplicates.reduce((n, group) => n + group.paths.length, 0),
      archivedDocuments: files.filter(x => x.path.startsWith('runtime/docs/archive/')).length,
      wipDocuments: files.filter(x => x.path.startsWith('runtime/docs/wip/')).length,
    },
    exactDuplicates,
    staticRisks,
    notVerified: [
      'semantic function/class duplicate analysis',
      'runtime and client import/caller graph',
      'npm vulnerability/outdated registry comparison',
      'Windows/Android/Termux/VS Code end-to-end behavior',
      'external plugin and host state',
    ],
  };
}

export function inventoryRepository({ cwd = process.cwd(), git = spawnSync } = {}) {
  const tree = git('git', ['ls-tree', '-r', '-z', 'HEAD'], {
    cwd, encoding: 'utf8', maxBuffer: 8_000_000, timeout: 30_000,
  });
  if (tree.error || tree.status !== 0) throw new Error('GIT_TREE_UNAVAILABLE:' + String(tree.stderr || tree.error?.message || tree.status));
  const files = parseGitTree(tree.stdout);
  const rootPackage = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  const rootLauncher = readFileSync(path.join(cwd, 'start.sh'), 'utf8');
  const summary = auditGitEntries(files, { rootPackage, rootLauncher });
  const revision = git('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', timeout: 10_000 });
  if (revision.error || revision.status !== 0) throw new Error('GIT_REVISION_UNAVAILABLE');
  return { ...summary, revision: revision.stdout.trim() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(inventoryRepository(), null, 2) + '\n'); }
  catch (error) { console.error('REPOSITORY_DEBT_INVENTORY_FAILED:' + error.message); process.exitCode = 2; }
}
