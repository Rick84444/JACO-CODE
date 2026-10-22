# Mobile Aura workspace

The phone layout uses the canonical Aura workspace and existing APIs. It has five
primary destinations: Samtal, Agenter, Arbete, Filer and Mer. Desktop navigation is
retained above 767 CSS pixels. The mobile menu is a native HTML dialog with focus
containment, Escape dismissal and focus return. Project files occupy the full
phone width. The composer and its draft remain mounted while switching views.

Routine background observations are grouped in the conversation. Mission-linked
observations, failures, unknown outcomes and blockers remain in the main feed.
The existing decision center remains the sole owner of approval actions.

## Reviewing actual agent output

The ordinary Git panel reads the selected project, while repository missions run
in separate worktrees. The new read-only mission review resolves the existing
worktree owner, verifies the repository and mission branch, and reads tracked and
new file diffs. It never creates a worktree or applies changes to the user's
project. Contract scope and secret redaction are applied before delivery. Git
external diff/text conversion and fsmonitor are disabled for review commands.

Recorded test receipts are explicitly historical: they do not prove that a later
manual edit still passes. Review shows at most 500 files, 200,000 patch characters,
3,000 rendered lines and 20 test receipts. A missing worktree, wrong project,
unrelated branch or inaccessible file is reported without inventing a result.

## Verification

- Real temporary Git repositories: committed and new file diffs, original project
  unchanged, owner reopened, protected paths, project mismatch, unrelated branch,
  symlink rejection and secret redaction.
- React rendering: setup, cancellation, visible decisions, agent network,
  attachments, connections and grouping of background events without hiding
  blockers.
- `python3 runtime/scripts/verify_mobile_workspace.py http://127.0.0.1:3000`
  checks a running production runtime in Chromium at 320, 390 and 430 CSS pixels,
  plus desktop. Python Playwright and Chromium must be installed. It checks
  navigation, draft retention, full-width files, menu focus, integrations, cost
  popover bounds and a shortened viewport. It makes no model calls or project
  writes. Screenshots default to `/tmp/jaco-mobile-check` and stay outside Git.

The operator-provided PNG is used unchanged as the shared Aura wordmark, with
its original proportions. Text is a fallback only if the image cannot decode. Native Android engine
controls, Termux installation, mobile OS keyboard behavior, background execution,
physical-device inference and user satisfaction scores are not established by
these browser checks. A shortened browser viewport is not an Android keyboard test.

Observed on 2026-10-22: production client/server build and TypeScript passed;
root suite passed 716 tests with 5 skipped; workspace UX passed 9 tests; canonical
worktree plus review tests passed 14 tests. The browser script passed all three
phone widths and desktop against an isolated production runtime with no model
credentials. Existing build warnings about bundle size and CommonJS import.meta
remain; these checks do not establish local-model task completion.

After integrating newer main changes, two stale Termux source assertions were
updated to check the current ownership gate and rejection of unlisted process
working directories, rather than an obsolete diagnostic sentence. All 13 related
Termux tests passed. No supervisor behavior was changed by this update.
