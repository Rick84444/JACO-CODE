import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const checks = [];
const add = (id, claim, passed, observed='') => checks.push({ id, claim, passed: Boolean(passed), observed });
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(root, rel));

const pkg = JSON.parse(read('package.json'));
add('identity.product-name', 'release package is named JACO Autonomus IDE', pkg.name === 'jaco-autonomus-ide', `${pkg.name}@${pkg.version}`);
const currentRelease = exists('CURRENT_RELEASE.json') ? JSON.parse(read('CURRENT_RELEASE.json')) : null;
add('identity.inherited-frozen-baseline', 'release preserves explicit frozen Hands-Off + SEER + Desktop baseline provenance', ['0.19.1-rc1','0.20.0-continuum-rc1','0.22.0'].includes(pkg.version) && currentRelease?.baseProvenance?.file === 'BASE_RELEASE_0.17.1.json' && exists('BASE_RELEASE_0.17.1.json'), `${pkg.version}; ${currentRelease?.baseProvenance?.file || 'no baseline'}`);

const server = read('server.ts');
const seer = read('src/server/seer/seerService.ts');
const live = read('src/server/seer/liveWorkstream.ts');
// The Aura IDE is the only UI since 2026-10-02 (the legacy WebAgentView tab was removed).
const web = read('src/components/JacoAuraComputeIDE.tsx');
const desktop = read('src/server/desktop/desktopHandsOff.ts');
const desktopRouter = read('src/server/desktop/router.ts');
const bridge = read('scripts/windows/jaco-uia-bridge.ps1');
const android = read('src/server/android/handsOffClient.ts');
const plans = read('src/server/android/handsOffPlanRunner.ts');
// The traction engine moved into tractionCore.mjs; traction.ts re-exports it.
const nova = read('src/server/nova/traction.ts') + read('src/server/nova/tractionCore.mjs');

for (const phase of ['IDLE','OBSERVING','PLANNING','EXECUTING','VERIFYING','DEGRADED']) {
  add(`seer.phase.${phase.toLowerCase()}`, `SEER live protocol includes ${phase}`, live.includes(`'${phase}'`), phase);
}
for (const field of ['primaryGoal','subgoal','activeModule','provider','model','cycle','iteration','workers','toolsSkills','blocker','drift','latestVerifiedProgress','nextCycleAt','action','events']) {
  add(`seer.field.${field}`, `SEER live state exposes ${field}`, live.includes(`${field}:`), field);
}
add('seer.sse', 'SEER live event stream is exposed over SSE', server.includes("'/api/seer/live/events'") && server.includes("event: state"), '/api/seer/live/events');
add('seer.ui-working', 'Aura IDE shows the SEER primary goal, SEER phase and the mission list', web.includes('Primary goal') && web.includes('snapshot?.seer?.phase') && web.includes("bottomPanel === 'missions'"), 'JacoAuraComputeIDE.tsx');
add('seer.ui-no-fake-default', 'IDE shows unobserved defaults instead of fabricated work', web.includes("'unobserved'") && web.includes("'NO ACTIVE MISSION'"), 'truthful empty-state labels');

add('android.client', 'canonical Android HandsOffClient is present', exists('src/server/android/handsOffClient.ts'), 'handsOffClient.ts');
add('android.observe-act-observe', 'Android actions verify observed state transition', android.includes('beforeHash !== afterHash') && android.includes('executeVerified'), 'snapshot hashes');
add('android.plan-runner', 'Android Hands-Off plan runner is present', plans.includes('createHandsOffPlanRunner') && plans.includes('OPERATOR_CONFIRMATION_REQUIRED'), 'resume gate');
add('android.native-accessibility', 'native Android Accessibility implementation is included', exists('modules/runtime/native-intelligence-fabric/native/android/app/src/main/java/ai/jaco/nativeengine/HandsOffAccessibilityService.kt'), 'HandsOffAccessibilityService.kt');

add('desktop.client', 'Desktop Hands-Off client is present', exists('src/server/desktop/desktopHandsOff.ts'), 'desktopHandsOff.ts');
add('desktop.router', 'Desktop Hands-Off API is mounted', server.includes("'/api/desktop/hands-off'") && desktopRouter.includes("router.post('/action'"), '/api/desktop/hands-off');
add('desktop.uia', 'Desktop actuation uses Windows UI Automation', bridge.includes('UIAutomationClient') && bridge.includes('InvokePattern') && bridge.includes('ValuePattern'), 'UI Automation patterns');
add('desktop.no-synthetic-input', 'Desktop bridge contains no synthetic keyboard/mouse actuation primitives', !/(SendKeys|keybd_event|mouse_event|SetCursorPos|SendInput)/i.test(bridge), 'no synthetic input primitives');
add('desktop.grant-expiry', 'Desktop grant is expiring and capped', desktop.includes('8 * 60 * 60_000') && desktop.includes('grant cannot exceed 8 hours'), '8 hour max');
add('desktop.process-allowlist', 'Desktop actions require allowed_processes', desktop.includes('allowed_processes') && bridge.includes('Assert-WindowAllowed'), 'process allowlist');
add('desktop.credential-refusal', 'Credential and system-security surfaces are permanently blocked', desktop.includes('BLOCKED_PROCESSES') && desktop.includes('credential or system-security surface'), 'blocked process policy');
add('desktop.secret-human-entry', 'Secrets/OTP/API keys require direct human entry', desktop.includes('secrets and authentication codes require direct human entry'), 'SECRET_TEXT refusal');
add('desktop.secret-redaction', 'Secret-bearing field values are redacted from observations', bridge.includes('[redacted: secret-bearing field]'), 'observation redaction');
add('desktop.verified-transition', 'Desktop receipt verifies before/after UI state transition', desktop.includes('beforeHash !== afterHash') && desktop.includes('verified'), 'snapshot hash delta');
add('desktop.unsupported-truth', 'Unsupported non-Windows desktop path reports UNAVAILABLE', desktop.includes("!this.isSupported() ? 'UNAVAILABLE'"), 'evidenceState');

add('nova.target-lock', 'Nova blocks action without a verified target lock', nova.includes('target lock is not strong enough') && server.includes('TARGET_LOCK_NOT_VERIFIED'), 'Nova gate');
add('nova.android-route', 'Nova can gate Android Hands-Off actions', server.includes("'/api/nova/traction/android-action'"), 'android-action');
add('nova.desktop-route', 'Nova can gate Desktop Hands-Off actions', server.includes("'/api/nova/traction/desktop-action'"), 'desktop-action');
add('hands-off.unified-status', 'Unified Hands-Off status exposes Android + Desktop', server.includes("'/api/hands-off/unified/status'"), 'unified status');

add('contracts.persisted', 'Intuition Contracts are persisted and required by plan runner', exists('src/server/autonomy/intuitionContractStore.ts') && plans.includes('an active signed Intuition Contract is required'), 'persistent contract store');
add('security.no-hardcoded-hf-token', 'No Hugging Face token literal is embedded in server.ts', !/hf_[A-Za-z0-9]{20,}/.test(server), 'environment-only HUGGINGFACE_TOKEN');
add('release.no-hf-env', 'obsolete embedded hf_env runtime is absent', !exists('hf_env'), 'removed');
add('release.no-volatile-state', 'release contains no preloaded action/chat/job runtime state', !exists('.jaco/state/hands-off/action-ledger.jsonl') && !exists('.jaco/state/desktop-hands-off/action-ledger.jsonl'), '.jaco state empty');

const failed = checks.filter(x => !x.passed);
for (const c of checks) console.log(`${c.passed ? 'PASS' : 'FAIL'} ${c.id} — ${c.claim}${c.observed ? ` [${c.observed}]` : ''}`);
console.log(`inherited-frozen-hands-off: ${failed.length ? 'FAIL' : 'PASS'} (${checks.length-failed.length}/${checks.length})`);
if (failed.length) process.exit(1);
