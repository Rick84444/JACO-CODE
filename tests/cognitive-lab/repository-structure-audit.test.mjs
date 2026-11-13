import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGitTree, auditGitEntries, duplicateClass } from '../../scripts/audit-repository-structure.mjs';
const sha = c => c.repeat(40);
const entry = (file, c) => ({ path: file, type: 'blob', mode: '100644', sha: sha(c) });

test('Git inventory parser uses nul records and never truncates paths containing spaces', () => {
  const raw = '100644 blob ' + sha('a') + '\tpublic/docs/hello world.md\0' +
              '100644 blob ' + sha('b') + '\truntime/index.mjs\0';
  assert.deepEqual(parseGitTree(raw).map(x => x.path), ['public/docs/hello world.md', 'runtime/index.mjs']);
  assert.throws(() => parseGitTree('100644 blob ' + sha('a') + '\tfile\n'), /GIT_TREE_MISSING_NUL/);
  assert.throws(() => parseGitTree('100644 blob invalid\tfile\0'), /GIT_TREE_RECORD_INVALID/);
});

test('full tracked blob inventory reports identical assets without claiming deletability', () => {
  const records = [
    entry('public/docs/overview.md','a'), entry('runtime/public/docs/overview.md','a'),
    entry('start.sh','b'), entry('runtime/start.sh','b'),
    entry('runtime/src/adk/index.d.mts','c'), entry('runtime/src/adk/index.mjs','c'),
    entry('src/one.mjs','d'), entry('src/two.mjs','d'),
    entry('runtime/docs/archive/old.md','e'), entry('runtime/docs/wip/draft.md','f'),
  ];
  const report = auditGitEntries(records, {
    rootPackage: { scripts: { 'jaco:start': 'node agents/lib/local-stack.mjs' } },
    rootLauncher: 'npm run start',
  });
  assert.equal(report.summary.trackedFiles, 10);
  assert.equal(report.summary.duplicateGroups, 4);
  assert.equal(report.summary.duplicateFileOccurrences, 8);
  assert.equal(report.summary.archivedDocuments, 1);
  assert.equal(report.summary.wipDocuments, 1);
  assert.equal(report.status, 'INVENTORIED_NOT_DEBT_FREE');
  assert.deepEqual(report.staticRisks.map(x => x.id), ['ROOT_LAUNCHER_SCRIPT_DRIFT']);
  assert.ok(report.exactDuplicates.some(x => x.category === 'PUBLIC_DISTRIBUTION_MIRROR'));
  assert.ok(report.exactDuplicates.some(x => x.category === 'ENTRYPOINT_DUPLICATE_REVIEW'));
  assert.ok(report.exactDuplicates.some(x => x.category === 'ESM_TYPE_SHIM_REVIEW'));
  assert.ok(report.exactDuplicates.some(x => x.category === 'UNCLASSIFIED_REVIEW'));
});

test('a clean checksum table is not proof of semantic or runtime health', () => {
  const report = auditGitEntries([entry('index.mjs','a')], {
    rootPackage: { scripts: { start: 'node index.mjs' } },
  });
  assert.equal(report.summary.duplicateGroups, 0);
  assert.equal(report.status, 'INVENTORIED_NOT_DEBT_FREE');
  assert.ok(report.notVerified.some(s => s.includes('semantic')));
});

test('distribution pair classification requires exact mirrored paths', () => {
  assert.equal(duplicateClass(['public/docs/x.md', 'runtime/public/docs/x.md']), 'PUBLIC_DISTRIBUTION_MIRROR');
  assert.equal(duplicateClass(['public/docs/x.md', 'runtime/public/docs/y.md']), 'UNCLASSIFIED_REVIEW');
  assert.equal(duplicateClass(['LICENSE', 'extensions/jaco-vscode/LICENSE']), 'LICENSE_DISTRIBUTION_COPY');
});
