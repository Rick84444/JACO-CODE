import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = process.cwd();

export interface QualityAuditPayload {
  scope: 'full' | 'fast' | 'security_only';
  targetDir?: string;
}

export interface QualityFinding {
  file: string;
  line?: number;
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  message: string;
}

export interface QualityAuditResult {
  score: number;
  criticalIssuesCount: number;
  warningsCount: number;
  findings: QualityFinding[];
}

// tsc --noEmit skriver rader i formatet: "file.ts(rad,kol): error TSxxxx: meddelande"
const TS_DIAGNOSTIC_RE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/;

/**
 * Riktig typkontroll: kör den faktiska tsc-binären (samma som `npm run lint`
 * redan använder i det här repot) mot hela projektet enligt tsconfig.json.
 */
async function runTypeCheck(): Promise<QualityFinding[]> {
  const findings: QualityFinding[] = [];
  try {
    await execFileAsync('npx', ['tsc', '--noEmit'], {
      cwd: PROJECT_ROOT,
      timeout: 120000,
      maxBuffer: 20 * 1024 * 1024
    });
    // tsc returnerade 0 — inga diagnostikrader att parsa.
  } catch (err: any) {
    const output: string = err?.stdout || err?.message || '';
    for (const rawLine of output.split('\n')) {
      const match = TS_DIAGNOSTIC_RE.exec(rawLine.trim());
      if (match) {
        const [, file, lineNum, , level, code, message] = match;
        findings.push({
          file: path.relative(PROJECT_ROOT, path.resolve(PROJECT_ROOT, file)),
          line: parseInt(lineNum, 10),
          severity: level === 'error' ? 'CRITICAL' : 'WARN',
          message: `${code}: ${message}`
        });
      }
    }
    if (findings.length === 0) {
      // tsc misslyckades av annan anledning än typfel (saknad tsconfig,
      // timeout, saknade node_modules etc) — rapportera det ärligt.
      findings.push({
        file: 'tsc',
        severity: 'CRITICAL',
        message: `Typkontroll kunde inte köras eller avslutades oväntat: ${output.slice(0, 500) || 'okänt fel'}`
      });
    }
  }
  return findings;
}

const SECURITY_PATTERNS: Array<{ re: RegExp; message: string }> = [
  { re: /eval\s*\(/, message: 'Direkt evaluering av strängkod — potentiell kodinjektionsrisk.' },
  { re: /new\s+Function\s*\(/, message: 'Dynamisk funktionskonstruktion från sträng — potentiell kodinjektionsrisk.' },
  { re: /exec(?:Sync)?\s*\(\s*[`'"][^`'"]*\$\{/, message: 'Skalkommando byggt med strängmall/interpolering — risk för shell-injektion.' },
  { re: /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{12,}['"]/i, message: 'Möjlig hårdkodad hemlighet i källkod.' }
];

// OBS: mönstren ovan får inte skriva ut sina egna träffsträngar i klartext i
// meddelandet — annars flaggar scannern sin egen källkod (självreferens).

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.jaco', 'workspace']);

function walkSourceFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkSourceFiles(full));
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Enkel, beroendefri säkerhetsscan (repot har ingen eslint-plugin för det
 * ändamålet installerad). Mönsterbaserad, inte en fullständig SAST-motor —
 * flaggar de vanligaste uppenbara riskerna för mänsklig granskning.
 */
async function runSecurityScan(targetDir: string): Promise<QualityFinding[]> {
  const findings: QualityFinding[] = [];
  const files = walkSourceFiles(targetDir);

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    content.split('\n').forEach((lineText, idx) => {
      for (const pattern of SECURITY_PATTERNS) {
        if (pattern.re.test(lineText)) {
          findings.push({
            file: path.relative(PROJECT_ROOT, file),
            line: idx + 1,
            severity: 'CRITICAL',
            message: pattern.message
          });
        }
      }
    });
  }

  return findings;
}

export async function runQualityAudit(payload: QualityAuditPayload): Promise<QualityAuditResult> {
  const scope = payload.scope || 'fast';
  const targetDir = payload.targetDir
    ? path.resolve(PROJECT_ROOT, payload.targetDir)
    : PROJECT_ROOT;

  let findings: QualityFinding[];

  if (scope === 'security_only') {
    findings = await runSecurityScan(targetDir);
  } else if (scope === 'full') {
    findings = (await runTypeCheck()).concat(await runSecurityScan(targetDir));
  } else {
    findings = await runTypeCheck();
  }

  const criticalIssuesCount = findings.filter((f) => f.severity === 'CRITICAL').length;
  const warningsCount = findings.filter((f) => f.severity === 'WARN').length;
  const score = Math.max(0, 100 - criticalIssuesCount * 5 - warningsCount * 1);

  return {
    score,
    criticalIssuesCount,
    warningsCount,
    findings: findings.slice(0, 200)
  };
}
