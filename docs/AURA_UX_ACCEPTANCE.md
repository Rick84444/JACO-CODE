# Aura Live Workspace – product requirements and UX acceptance

**Status:** A quality goal, not a measured user rating. This specification applies to the single canonical Aura surface on Windows and Android/Termux. No separate demo GUI may be used as evidence of delivery.

## The core flow that must work

1. Open JACO → the existing project and **one** chat are shown. If the runtime or model is missing, the user gets an understandable state, not an invented READY.
2. Write a goal → the mission gets a persistent ID. Aura may work autonomously according to the chosen policy. A received goal does **not** count as a completed mission.
3. Follow the latest work → real events and their verification status are visible in Live Stage. Errors, uncertain outcomes and disconnection cannot be confused with delivery.
4. Open **Code**, **Preview** or **Evidence** with one click on the computer, or via the phone's clear Work tab and menu. The ongoing chat and unsaved draft persist across every switch.
5. Review a changed file → diff/change status and test receipts are linked to the right mission. The preview isolates unknown HTML. Saving requires that the file version still matches; a conflict error must not overwrite the user's or the agent's changes.
6. Switch project, cancel an operation, restart or lose the network → no old material is shown as current in the new project. If an external outcome is unknown, the runtime must first investigate what really happened.
7. Costs: autonomy starts at level 5, a voluntary reduction must be easy. Connected paid AI APIs use user-chosen spend caps; buying subscriptions, top-ups and payouts need explicit user approval.

## Measurable quality – the operator's 8/10 goal

**In the current development phase the owner is the only UX tester.** Automated CI verification and the human user rating are separate measures. The requirement for five external testers is removed: it does not apply to continuing development, approving the GUI internally or merging a technically verified implementation.

### Step 1: technical tests without operator burden
GitHub Actions verifies builds, navigation, continuity, browser/HTML isolation and tests. Failed CI is a technically blocking error; a passing CI test is **not** an invented user rating.

### Step 2: real operator acceptance
On **their own Windows installation** the operator uses Aura for real missions, including starting, following, reviewing results, correcting a desired change and resuming after an interruption. Afterwards the operator gives an overall rating **1–10** and describes what works or gets in the way. **Goal: the operator's rating ≥ 8/10**, with no P0 blockers. The rating must never be stated as achieved until the operator has explicitly given it.

### Step 3: Android acceptance when a runnable version exists
The same person assesses Android separately, on their real phone, after the installation works. The Windows rating is not evidence for the mobile rating. No external test panel is required for this internal phase.

### Step 4: future external validation
If JACO is later marketed to other users, independent users should be recruited. Such a test gets a separate sample and result. It is **not** a condition for the operator's current acceptance.

### The operator's simple rating template
After completing a real mission the following is enough: **Overall rating 1–10**; **what felt smooth?**; **what got in the way most?**; **would you rather use Aura than your current workspace?**. No invented median values or estimates from the developer.

| Dimension | Test | Stop condition |
|---|---|---|
| Start / onboarding | Connect a local model or use an already connected one; start a mission | No hidden shell steps |
| Mission understanding | Point out the current step, the latest verified action and the next action | No false completion marking |
| Navigation | Move between chat, code, results and evidence on desktop and 393 px mobile | No dead buttons or unreachable views |
| Continuity | Switch view, project, reload and interrupt SSE | Drafts preserved, history deduplicated, no other project's evidence shown as current |
| Code / preview | Change HTML, see the preview, trigger a version conflict and recover | No silent overwrites, no script escape |
| Recovery | Interrupt an external action between execution and receipt | No blind repetition of a non-idempotent action |
| Economy / autonomy | Limit autonomy and try a purchase and an ordinary model call respectively | Spend is stopped without approval, own cloud caps are respected |

## Technical verification before merge

- TypeScript and the production build green, including the assets the frontend actually uses.
- Node regression: stage selection, falsifiable evidence status, stage pin/unpin, project switch isolation, HTML sanitizing, files and CDP read-only.
- Playwright through **the real React interface** at 1440×900 and 393×852: navigation, mission status from a persistent fixture, working copy, file conflict, SSE reconnect, mobile overflow and offline mode. The mock server must not be counted as a user test.
- On the target machine: a real autonomous end-to-end mission with commit, diff, tests, receipts and restart. Document the exact JACO release, SHA, model/provider, OS and pass/fail per test.
- A decision to merge requires green relevant CI checks. A successful mock or merely an approved screenshot is not a product release.

## Known limitations at introduction

Aura Live Stage is a separate development branch until it is integrated with the latest `main`. CDP stills are periodic images, not a video stream; the browser action happens through a separately controlled tool boundary. The current live events lack complete project-scoped history: on project switch, older stage events are hidden until new observations arrive. True per-project history needs a project ID in the stream. Android on a phone, real autonomous execution and user rating are not yet verified.

**Definition of done for the current GUI acceptance:** A real mission works and can be reviewed from Aura on the target machine, relevant CI is green, and the operator gives at least 8/10 with no P0 blockers. Windows and Android are assessed separately when the respective version can run. No external test panel is required.

## PR 13 hardening — 2026-10-24

Verified in the isolated PR worktree, based on `127e72b`:

- Verified routine reads of HTML/images do not replace delivered material.
  Failed reads still surface as failures. Grouped history follows the latest
  occurrence, even when repeated steps are interleaved.
- Switching between mobile conversation and work preserves the material pin.
  Starting inline HTML editing pins the material; the operator explicitly resumes
  following new work. No new planner, event store or browser controller is added.
- Initial file reads are bounded and abort on context change. Missing material
  shows a retry action instead of an indefinite opening message. File-read errors
  stay with the file and clear after recovery, without stale global blockers.
- Mission details and connection/verification details are expandable. Connection
  uncertainty, current step and required decisions remain visible. This gives the
  visual result more room on a phone.

Observed checks: TypeScript and client/server production build passed; root suite
756 passed, 5 skipped; 26 targeted Stage/presence/recovery/refresh tests passed;
9 workspace rendering tests passed. Chromium exercised the production React client
in 19 controlled scenarios, including SSE/store recovery, conflicting edits, mobile
pin retention and missing-file retry. The separate real Chromium/CDP sanitizer
fixture passed 11 controls, including no unauthorized image/CSS request attempts.

These are controlled browser/store tests, not inference or autonomous completion.
No physical Android/Windows installation or owner rating was established. Existing
project-ID gaps in the global event stream, durable visual revision history and
integration with newer main work remain separate acceptance items. PR stays open.
