import { createHash } from 'node:crypto';

const REPOSITORY_PATH = '/Rick84444/JACO-CODE/';

function required(value, field, max = 1200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`PROOF_QUEST_INVALID_${field.toUpperCase()}`);
  }
  return value.trim();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('PROOF_QUEST_INPUT_REQUIRED');
  }
  const receipt = input.receipt || {};
  const commit = required(receipt.commit, 'commit', 40);
  const command = required(receipt.command, 'command', 400);
  const artifactUrl = required(receipt.artifactUrl, 'artifact_url', 2048);
  if (!/^[0-9a-f]{40}$/i.test(commit) || receipt.exitCode !== 0) {
    throw new Error('PROOF_QUEST_INVALID_RECEIPT');
  }
  let evidenceUrl;
  try { evidenceUrl = new URL(artifactUrl); } catch {
    throw new Error('PROOF_QUEST_INVALID_EVIDENCE_URL');
  }
  if (evidenceUrl.origin !== 'https://github.com' ||
      !evidenceUrl.pathname.startsWith(REPOSITORY_PATH)) {
    throw new Error('PROOF_QUEST_UNTRUSTED_EVIDENCE_URL');
  }
  return {
    problem: required(input.problem, 'problem'),
    testedApproach: required(input.testedApproach, 'tested_approach'),
    alternative: required(input.alternative, 'alternative'),
    observation: required(input.observation, 'observation'),
    limitation: required(input.limitation, 'limitation'),
    receipt: { commit, command, artifactUrl: evidenceUrl.href, exitCode: 0 },
  };
}

function renderPage(quest) {
  const choices = quest.options.map(option =>
    `<button type="button" class="choice" data-choice="${option.id}">${escapeHtml(option.text)}</button>`
  ).join('\n');
  const label = quest.verified ? 'VERIFIED RECEIPT' : 'UNVERIFIED PREVIEW';
  const observationLabel = quest.verified ? 'Observed result' : 'Submitted claim (not verified)';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>JACO CODE | Proof Quest</title>
<style>
:root{color-scheme:dark;font-family:system-ui,sans-serif}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at top,#16452a,#07110d 60%,#030604);color:#effff4}
main{width:min(100%,680px);padding:clamp(24px,5vw,50px);border:1px solid #317247;border-radius:22px;background:#0a1710;box-shadow:0 24px 80px #0009}
.brand{font-size:12px;color:#a2efb6;font-weight:800;letter-spacing:.22em}
.status{margin-top:20px;font-size:12px;color:#b8d4c1}
h1{font-size:clamp(30px,6vw,50px);letter-spacing:-.04em;line-height:1.08}
p{line-height:1.6;color:#c3d6c9}
.choices{display:grid;gap:12px;margin:24px 0}
button{font:inherit;border-radius:12px;cursor:pointer}
.choice{padding:20px;text-align:left;background:#14261a;color:#fff;border:1px solid #397750}
.choice:hover{border-color:#acffbe}
.choice:disabled{opacity:.7;cursor:default}
#reveal{padding:20px;background:#11271a;border-left:3px solid #acffbe;border-radius:10px}
#reveal[hidden],#share[hidden]{display:none}
a{color:#b2ffc6;overflow-wrap:anywhere}
#share{margin-top:16px;padding:13px 18px;background:#acffbe;color:#092010;border:0;font-weight:700}
small{display:block;margin-top:20px;color:#99b6a2}
</style>
</head>
<body>
<main>
<div class="brand">JACO CODE / PROOF QUEST</div>
<div class="status">${label}</div>
<h1>How would you solve this?</h1>
<p>${escapeHtml(quest.problem)}</p>
<div class="choices">${choices}</div>
<section id="reveal" hidden aria-live="polite">
<strong id="verdict"></strong>
<p><strong>${observationLabel}:</strong> ${escapeHtml(quest.observation)}</p>
<p><strong>Limitation:</strong> ${escapeHtml(quest.limitation)}</p>
<p><strong>Test command:</strong> <code>${escapeHtml(quest.receipt.command)}</code></p>
<a href="${escapeHtml(quest.receipt.artifactUrl)}" target="_blank" rel="noopener noreferrer">Inspect supplied evidence</a>
</section>
<button id="share" type="button" hidden>Share this challenge</button>
<small>No cookies. No tracking. No automatic publishing.</small>
</main>
<script>
const winner = ${JSON.stringify(quest.winner)};
const verified = ${JSON.stringify(quest.verified)};
const buttons = [...document.querySelectorAll('.choice')];
buttons.forEach(button => button.addEventListener('click', () => {
  buttons.forEach(choice => { choice.disabled = true; });
  const correct = button.dataset.choice === winner;
  document.getElementById('verdict').textContent = !verified
    ? 'This claim has not been verified.'
    : correct ? 'Your choice matched the verified result.' : 'The verified result favored the other approach.';
  document.getElementById('reveal').hidden = false;
  document.getElementById('share').hidden = !verified;
}));
document.getElementById('share').addEventListener('click', async () => {
  try {
    if (navigator.share) await navigator.share({ title: document.title, url: location.href });
    else if (navigator.clipboard) await navigator.clipboard.writeText(location.href);
  } catch { /* Cancelled by user or unsupported device. */ }
});
</script>
</body>
</html>`;
}

// verifyReceipt is injected by a trusted runtime component. It must independently
// establish that the commit, command and artifact match a real execution record.
// The input's URL, exitCode and commit are not sufficient evidence on their own.
export async function createProofQuest(input, { verifyReceipt } = {}) {
  const data = validate(input);
  const verified = typeof verifyReceipt === 'function' &&
    (await verifyReceipt(data.receipt, data)) === true;
  const id = createHash('sha256')
    .update(JSON.stringify({ problem: data.problem, commit: data.receipt.commit }))
    .digest('hex').slice(0, 16);
  const winner = parseInt(id.slice(0, 2), 16) % 2 === 0 ? 'a' : 'b';
  const other = winner === 'a' ? 'b' : 'a';
  const options = [
    { id: winner, text: data.testedApproach },
    { id: other, text: data.alternative },
  ].sort((a, b) => a.id.localeCompare(b.id));
  const quest = { ...data, id, winner, options, verified };
  return {
    schema: 'jaco.marketing.proof-quest.v1',
    id,
    status: verified ? 'READY_FOR_OPERATOR_REVIEW' : 'PROTOTYPE',
    verified,
    operatorApprovalRequired: true,
    publicationPerformed: false,
    landingHtml: renderPage(quest),
    suggestedPost: verified
      ? `Two approaches to a developer problem: ${data.problem} Which would you choose? Inspect the evidence in JACO Proof Quest.`
      : null,
    evidence: data.receipt,
  };
}

export function proofQuestScripts(verifyReceipt) {
  return {
    'marketing.proofQuest': input => createProofQuest(input, { verifyReceipt }),
  };
}
