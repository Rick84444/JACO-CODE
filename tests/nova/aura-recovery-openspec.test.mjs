import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const change = path.join(root, 'openspec/changes/aura-resilient-mission-recovery');
test('Aura recovery OpenSpec delta has normative requirements and executable scenarios', () => {
  const proposal = fs.readFileSync(path.join(change, 'proposal.md'), 'utf8');
  const spec = fs.readFileSync(path.join(change, 'specs/aura-mission-recovery/spec.md'), 'utf8');
  assert.match(proposal, /^## Why$/m);
  assert.match(proposal, /^## What Changes$/m);
  assert.match(spec, /^## ADDED Requirements$/m);
  const reqs = spec.match(/^### Requirement: .+$/gm) || [];
  assert.equal(reqs.length, 7);
  const blocks = spec.split(/^### Requirement: /m).slice(1);
  for (const block of blocks) {
    assert.match(block, /(?:^|\n).{1,500}(?:.|\n)*?#### Scenario: /);
    assert.match(block, /^#### Scenario: /m);
    const scenarios = block.split(/^#### Scenario: /m).slice(1);
    for (const scenario of scenarios) {
      assert.match(scenario, /- \*\*WHEN\*\* /);
      assert.match(scenario, /- \*\*THEN\*\* /);
    }
  }
});
