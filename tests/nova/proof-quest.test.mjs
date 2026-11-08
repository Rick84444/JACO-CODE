import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProofQuest, proofQuestScripts } from '../../skills/proof-quest/proof-quest.mjs';
import { SkillRuntime } from '../../runtime/src/server/skills/skillRuntime.mjs';

const proof = {
  problem: 'Which HTTP retry policy works better?',
  testedApproach: 'Bounded exponential backoff',
  alternative: 'Unbounded immediate retry',
  observation: 'The bounded policy passed the supplied test.',
  limitation: 'Only one environment was tested.',
  receipt: {
    commit: 'a'.repeat(40),
    command: 'node --test tests/retry.test.mjs',
    artifactUrl: 'https://github.com/Rick84444/JACO-CODE/actions/runs/123',
    exitCode: 0,
  },
};

test('without independent receipt verification, campaign remains a prototype', async () => {
  const result = await createProofQuest(proof);
  assert.equal(result.status, 'PROTOTYPE');
  assert.equal(result.verified, false);
  assert.equal(result.suggestedPost, null);
  assert.equal(result.publicationPerformed, false);
  assert.match(result.landingHtml, /UNVERIFIED PREVIEW/);
  assert.match(result.landingHtml, /This claim has not been verified/);
});

test('trusted receipt verifier produces operator-reviewable interactive challenge', async () => {
  const result = await createProofQuest(proof, {
    verifyReceipt: async receipt => receipt.command === proof.receipt.command,
  });
  assert.equal(result.status, 'READY_FOR_OPERATOR_REVIEW');
  assert.equal(result.verified, true);
  assert.equal(result.operatorApprovalRequired, true);
  assert.equal(result.publicationPerformed, false);
  assert.match(result.landingHtml, /VERIFIED RECEIPT/);
  assert.match(result.landingHtml, /data-choice="a"/);
  assert.match(result.landingHtml, /data-choice="b"/);
  assert.match(result.landingHtml, /navigator\.share/);
  assert.deepEqual(result.id, (await createProofQuest(proof)).id);
});

test('rejects untrusted URL or fabricated receipt metadata', async () => {
  await assert.rejects(createProofQuest({ ...proof, receipt: {
    ...proof.receipt, artifactUrl: 'https://evil.test/bad',
  } }), /UNTRUSTED_EVIDENCE_URL/);
  await assert.rejects(createProofQuest({ ...proof, receipt: {
    ...proof.receipt, exitCode: 1,
  } }), /INVALID_RECEIPT/);
  await assert.rejects(createProofQuest({ ...proof, receipt: {
    ...proof.receipt, commit: 'not-a-commit',
  } }), /INVALID_RECEIPT/);
});

test('escapes untrusted campaign text in HTML and attribute contexts', async () => {
  const result = await createProofQuest({
    ...proof,
    problem: '<script>alert(1)</script>',
    testedApproach: '" onclick="evil()"',
    observation: '<img src=x onerror=evil()>',
  }, { verifyReceipt: () => false });
  assert.doesNotMatch(result.landingHtml, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(result.landingHtml, /<img src=x onerror=evil\(\)>/);
  assert.match(result.landingHtml, /&lt;script&gt;/);
  assert.match(result.landingHtml, /&quot; onclick=&quot;evil\(\)&quot;/);
});

test('candidate integrates with canonical SkillRuntime without a second runtime', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-marketing-'));
  try {
    const skillsRoot = fileURLToPath(new URL('../../skills/', import.meta.url));
    const runtime = new SkillRuntime({
      workspaceRoot,
      skillRoots: [skillsRoot],
      scripts: proofQuestScripts(async () => true),
    });
    assert.equal(runtime.search('marketing proof quest')[0].id, 'marketing.proof-quest');
    await assert.rejects(() => runtime.execute('marketing.proof-quest', proof), /SKILL_NOT_ACTIVE/);
    const execution = await runtime.execute('marketing.proof-quest', proof, { allowCandidate: true });
    assert.equal(execution.status, 'COMPLETED');
    assert.equal(execution.result.status, 'READY_FOR_OPERATOR_REVIEW');
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
