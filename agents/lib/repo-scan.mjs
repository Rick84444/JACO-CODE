// Repo security scan, the first paid JACO service (operator decision 2026-10-02).
// A customer names a public GitHub repository; the scan reports leaked credentials in the current files
// and dependencies with published vulnerabilities (OSV.dev). It is deterministic: no model decides what
// is found. Found secrets are masked in the report, which never contains a full credential.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REPO_URL = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/;
// Order ids: a Stripe checkout session (cs_…) or a Skyfire token id (sky_<jti>).
export const ORDER_ID = /^(?:cs_(?:live|test)_[A-Za-z0-9]{10,200}|sky_[A-Za-z0-9-]{8,200}|x4_[0-9a-f]{32})$/;

export function parseRepoUrl(url) {
  const m = String(url || '').trim().match(REPO_URL);
  if (!m || m[2] === '.' || m[2] === '..') throw new Error('REPO_URL_INVALID: expected https://github.com/<owner>/<repo>');
  return { owner: m[1], repo: m[2], url: `https://github.com/${m[1]}/${m[2]}` };
}

// [kind, severity, regex]. Every pattern needs a distinctive prefix, so ordinary code does not match.
export const SECRET_PATTERNS = [
  ['private-key', 'critical', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/],
  ['aws-access-key', 'critical', /(?<![A-Z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Z0-9])/],
  ['stripe-live-key', 'critical', /(?<![A-Za-z0-9])(?:sk|rk)_live_[A-Za-z0-9]{16,}/],
  ['github-token', 'critical', /(?<![A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
  ['openai-key', 'high', /(?<![A-Za-z0-9])sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/],
  ['anthropic-key', 'high', /(?<![A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{32,}/],
  ['google-api-key', 'high', /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{35}/],
  ['slack-token', 'high', /(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}/],
  ['sendgrid-key', 'high', /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/],
  ['npm-token', 'high', /(?<![A-Za-z0-9])npm_[A-Za-z0-9]{36}/],
  ['huggingface-token', 'high', /(?<![A-Za-z0-9])hf_[A-Za-z0-9]{30,}/],
  ['stripe-test-key', 'low', /(?<![A-Za-z0-9])(?:sk|rk)_test_[A-Za-z0-9]{16,}/],
];

const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', '.next', 'target', '__pycache__']);
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_REPO_BYTES = 300 * 1024 * 1024;

export const mask = s => `${s.slice(0, 4)}${'*'.repeat(Math.max(4, Math.min(12, s.length - 4)))}`;

export function scanTextForSecrets(text, file) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const [kind, severity, re] of SECRET_PATTERNS) {
      const m = line.match(re);
      if (m) findings.push({ kind, severity, file, line: i + 1, preview: mask(m[0]) });
    }
  });
  return findings;
}

function walk(root, out = [], rel = '') {
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(root, out, r); }
    else if (e.isFile()) out.push(r);
  }
  return out;
}

// Dependencies pinned in lockfiles, as OSV queries.
export function collectDependencies(root, files) {
  const deps = [];
  for (const f of files) {
    const base = path.basename(f);
    try {
      if (base === 'package-lock.json') {
        const lock = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
        for (const [key, info] of Object.entries(lock.packages || {})) {
          if (!key || !info?.version || info.link) continue;
          deps.push({ ecosystem: 'npm', name: key.split('node_modules/').pop(), version: info.version, file: f });
        }
      } else if (/^requirements.*\.txt$/.test(base)) {
        for (const line of fs.readFileSync(path.join(root, f), 'utf8').split(/\r?\n/)) {
          const m = line.trim().match(/^([A-Za-z0-9._-]+)==([A-Za-z0-9._+!-]+)/);
          if (m) deps.push({ ecosystem: 'PyPI', name: m[1], version: m[2], file: f });
        }
      }
    } catch { /* unreadable lockfile: reported as not analysed below */ }
  }
  const seen = new Set();
  return deps.filter(d => { const k = `${d.ecosystem}:${d.name}@${d.version}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export async function queryOsv(deps, fetchImpl = fetch) {
  const vulnerable = [];
  for (let i = 0; i < deps.length; i += 500) {
    const batch = deps.slice(i, i + 500);
    const res = await fetchImpl('https://api.osv.dev/v1/querybatch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ queries: batch.map(d => ({ package: { ecosystem: d.ecosystem, name: d.name }, version: d.version })) }),
    });
    if (!res.ok) throw new Error(`OSV_HTTP_${res.status}`);
    const data = await res.json();
    (data.results || []).forEach((r, j) => { if (r?.vulns?.length) vulnerable.push({ ...batch[j], vulnIds: r.vulns.map(v => v.id) }); });
  }
  // Summaries for the first 40 advisories, so the report says what each one is.
  const details = {};
  for (const id of [...new Set(vulnerable.flatMap(v => v.vulnIds))].slice(0, 40)) {
    try {
      const v = await (await fetchImpl(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15_000) })).json();
      details[id] = { summary: v.summary || null, severity: v.database_specific?.severity || null };
    } catch { details[id] = { summary: null, severity: null }; }
  }
  return { vulnerable, details };
}

export async function scanRepo(url, { fetchImpl = fetch, cloneImpl = null, workDir = null } = {}) {
  const repo = parseRepoUrl(url);
  const dir = workDir || fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-repo-scan-'));
  const started = Date.now();
  try {
    if (cloneImpl) cloneImpl(repo.url, dir);
    else {
      try {
        execFileSync('git', ['clone', '--depth', '1', '--single-branch', '--no-tags', repo.url, dir], {
          timeout: 180_000, stdio: 'pipe', windowsHide: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_LFS_SKIP_SMUDGE: '1', GIT_ASKPASS: 'echo' },
        });
      } catch { throw new Error('REPO_NOT_REACHABLE: the repository is not public or does not exist'); }
    }
    const files = walk(dir);
    let bytes = 0;
    const secrets = [];
    for (const f of files) {
      const full = path.join(dir, f);
      const size = fs.statSync(full).size;
      bytes += size;
      if (bytes > MAX_REPO_BYTES) throw new Error('REPO_TOO_LARGE');
      if (size > MAX_FILE_BYTES) continue;
      const buf = fs.readFileSync(full);
      if (buf.includes(0)) continue; // binary
      secrets.push(...scanTextForSecrets(buf.toString('utf8'), f));
    }
    const deps = collectDependencies(dir, files);
    let dependencies = { analysed: deps.length, vulnerable: [], details: {}, error: null };
    try { Object.assign(dependencies, await queryOsv(deps, fetchImpl)); } catch (e) { dependencies.error = String(e.message || e); }
    return {
      repo: repo.url, scannedAt: new Date().toISOString(), durationMs: Date.now() - started,
      filesScanned: files.length, secrets, dependencies,
      scope: 'Current files on the default branch (not git history). Secrets: credential formats with distinctive prefixes. Dependencies: npm package-lock.json and pinned requirements*.txt, checked against OSV.dev.',
    };
  } finally {
    if (!workDir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function renderReportHtml(report, { order = null } = {}) {
  const sev = { critical: 0, high: 1, low: 2 };
  const secrets = [...report.secrets].sort((a, b) => sev[a.severity] - sev[b.severity]);
  const vuln = report.dependencies.vulnerable;
  const verdict = secrets.some(s => s.severity !== 'low') ? 'Action needed: credentials are exposed in the repository.'
    : vuln.length ? 'Action recommended: dependencies with published vulnerabilities.' : 'No exposed credentials or known vulnerable dependencies were found in the scanned scope.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Repo security scan · ${esc(report.repo)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:32px auto;padding:0 16px;color:#1b1f24;background:#fff}h1{font-size:22px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}.critical{color:#b00020;font-weight:600}.high{color:#c25400;font-weight:600}.low{color:#555}.box{border:1px solid #ddd;border-radius:6px;padding:12px;margin:16px 0}code{font-size:12px}@media(prefers-color-scheme:dark){body{background:#111;color:#e6e6e6}td,th,.box{border-color:#333}}</style></head><body>
<h1>Repo security scan</h1>
<p><b>${esc(report.repo)}</b><br>Scanned ${esc(report.scannedAt.replace('T', ' ').slice(0, 19))} UTC · ${report.filesScanned} files${order ? ` · order <code>${esc(order.slice(0, 18))}…</code>` : ''}</p>
<div class="box"><b>${esc(verdict)}</b><br>${secrets.length} credential finding(s) · ${vuln.length} vulnerable dependency version(s) of ${report.dependencies.analysed} analysed</div>
<h2>Exposed credentials</h2>
${secrets.length ? `<table><tr><th>Severity</th><th>Type</th><th>File</th><th>Line</th><th>Value (masked)</th></tr>${secrets.map(s => `<tr><td class="${s.severity}">${s.severity}</td><td>${esc(s.kind)}</td><td><code>${esc(s.file)}</code></td><td>${s.line}</td><td><code>${esc(s.preview)}</code></td></tr>`).join('')}</table>
<p>Revoke and rotate each exposed credential at its provider first; deleting it from the file is not enough, because it stays in git history.</p>` : '<p>None found.</p>'}
<h2>Vulnerable dependencies</h2>
${report.dependencies.error ? `<p>The vulnerability database could not be queried (${esc(report.dependencies.error)}); this part was not analysed.</p>` : vuln.length ? `<table><tr><th>Package</th><th>Version</th><th>Advisories</th><th>Lockfile</th></tr>${vuln.map(v => `<tr><td>${esc(v.ecosystem)}: <b>${esc(v.name)}</b></td><td>${esc(v.version)}</td><td>${v.vulnIds.map(id => `<a href="https://osv.dev/vulnerability/${encodeURIComponent(id)}">${esc(id)}</a>${report.dependencies.details[id]?.summary ? ` – ${esc(report.dependencies.details[id].summary)}` : ''}`).join('<br>')}</td><td><code>${esc(v.file)}</code></td></tr>`).join('')}</table>` : `<p>None found among ${report.dependencies.analysed} pinned dependency version(s).</p>`}
<h2>Scope and limits</h2><p>${esc(report.scope)} A clean result means nothing was found in this scope, not that the repository is secure.</p>
<p style="color:#777;font-size:12px">JACO Autonomous IDE · automated scan</p></body></html>`;
}

// Order-bound task: both the repository and the Stripe checkout session (the order) must appear in the
// mission goal, so a planner can only scan what was paid for. Shared by the runtime and Nova's plan check.
export function validateRepoScanTask(task, goal = '') {
  const data = task?.data || {};
  const repo = parseRepoUrl(data.url);
  const order = String(data.order || '');
  if (!ORDER_ID.test(order)) throw new Error('REPO_SCAN_ORDER_INVALID');
  if (!String(goal).includes(order)) throw new Error('REPO_SCAN_ORDER_NOT_IN_GOAL');
  if (!String(goal).toLowerCase().includes(`github.com/${repo.owner}/${repo.repo}`.toLowerCase())) throw new Error('REPO_SCAN_REPO_NOT_IN_GOAL');
  return { ...task, data: { url: repo.url, order } };
}

export function reportDir(env = process.env) {
  return env.JACO_REPO_SCAN_DIR || path.join(env.JACO_WORKSPACE_ROOT || process.cwd(), '.jaco', 'repo-scan');
}

// Nova's executor for the task: scan, store the report under the order id, return a verified receipt.
export async function runRepoScanTask(data, { env = process.env, scan = scanRepo } = {}) {
  const order = String(data?.order || '');
  if (!ORDER_ID.test(order)) return { ok: false, verified: false, error: 'REPO_SCAN_ORDER_INVALID' };
  try {
    const report = await scan(data.url);
    const dir = reportDir(env);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${order}.json`), JSON.stringify({ order, ...report }, null, 2));
    fs.writeFileSync(path.join(dir, `${order}.html`), renderReportHtml(report, { order }));
    const base = String(env.JACO_GATEWAY_PUBLIC_URL || '').replace(/\/+$/, '');
    return {
      ok: true, verified: fs.existsSync(path.join(dir, `${order}.html`)),
      repo: report.repo, order, secrets: report.secrets.length, vulnerableDependencies: report.dependencies.vulnerable.length,
      url: base ? `${base}/scan/${order}` : null,
    };
  } catch (error) {
    return { ok: false, verified: false, error: String(error?.message || error).slice(0, 300) };
  }
}
