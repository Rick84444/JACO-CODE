---
name: JACO Proof Quest
description: Turn independently verified JACO engineering evidence into an interactive challenge draft. Publication always requires operator review.
---

# JACO Proof Quest

**Status:** CANDIDATE. Generates reviewable marketing artifacts only; never publishes, sends messages, or deploys.

## Idea

A developer chooses between two technical approaches before seeing the actual test result. The reveal includes a test command, a permalink to evidence and an explicit limitation. The page has no analytics or tracking; sharing is initiated by the visitor.

## Requirements

- A real 40-character Git commit SHA, executed test command, GitHub evidence artifact URL and exit code 0.
- A trusted runtime callback `verifyReceipt(receipt, data)` must match the receipt against an actual execution record. Provided metadata is *not* proof. If verification is unavailable or false, output remains `PROTOTYPE` and cannot be shared as verified.
- Truthful non-promotional copy. Apply the rules in `skills/community-post/SKILL.md` before creating any public community post.
- Explicit operator approval before publication, account actions or spending. This skill does none of those actions.

## Runtime integration

Register the *existing* SkillRuntime with both roots, preserving the runtime's normal memory skills:

```js
import path from 'node:path';
import { SkillRuntime } from './runtime/src/server/skills/skillRuntime.mjs';
import { proofQuestScripts } from './skills/proof-quest/proof-quest.mjs';

const runtime = new SkillRuntime({
  workspaceRoot: process.cwd(),
  skillRoots: [path.resolve('.jaco/skills-runtime'), path.resolve('skills')],
  scripts: proofQuestScripts(trustedTestReceiptVerifier),
});
const result = await runtime.execute('marketing.proof-quest', input, {
  allowCandidate: true, // Preview only; promotion is a separate review gate.
});
```

This is an integration example, not an automatic runtime wiring. Replace `trustedTestReceiptVerifier` with a real evidence adapter. The return value contains `landingHtml`, `status`, `verified`, `evidence`, and `suggestedPost` (only when verified). To use an output file, persist the returned HTML via an existing workspace tool after review, not via this skill.

## Falsifiers

- Fabricated or unverifiable result -> `PROTOTYPE`, no verified CTA.
- Evidence URL outside the selected repo -> rejection.
- HTML input injection -> escaped output.
- Any automatic publishing, tracking or claim of live deployment -> unacceptable.
