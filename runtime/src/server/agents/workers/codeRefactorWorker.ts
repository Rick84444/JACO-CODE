import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { evaluateFilePath } from '../../gate/policyRules.js';

export interface CodeRefactorPayload {
  filePath: string;
  instruction: string;
  originalContent?: string;
  newContent?: string;
}

export interface CodeRefactorResult {
  success: boolean;
  filePath: string;
  syntaxValid: boolean;
  linesChanged: number;
  message: string;
  diagnostics?: string[];
}

const PROJECT_ROOT = process.cwd();

/**
 * Säkerställer att filPath faktiskt hamnar innanför projektroten.
 * Blockerar path traversal (t.ex. '../../etc/passwd').
 */
function resolveSafePath(filePath: string): string {
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  const normalizedRoot = PROJECT_ROOT + path.sep;
  if (resolved !== PROJECT_ROOT && !resolved.startsWith(normalizedRoot)) {
    throw new Error(`Path traversal blockerad: '${filePath}' ligger utanför projektroten.`);
  }
  return resolved;
}

/**
 * Riktig syntaxkontroll via TypeScripts publika compiler-API (transpileModule).
 * Fångar parse-fel (obalanserade block, trasig JSX etc). Detta är en syntax-
 * kontroll, inte en fullständig typkontroll — för det, se qualityAuditorWorker.
 */
function checkSyntax(filePath: string, content: string): { valid: boolean; diagnostics: string[] } {
  const ext = path.extname(filePath).toLowerCase();
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    allowJs: true
  };
  if (ext === '.tsx' || ext === '.jsx') {
    compilerOptions.jsx = ts.JsxEmit.Preserve;
  }

  const result = ts.transpileModule(content, {
    compilerOptions,
    reportDiagnostics: true,
    fileName: filePath
  });

  const diagnostics = (result.diagnostics || []).map((d) => {
    const text = ts.flattenDiagnosticMessageText(d.messageText, '\n');
    if (d.file && d.start !== undefined) {
      const { line } = d.file.getLineAndCharacterOfPosition(d.start);
      return `${text} (rad ${line + 1})`;
    }
    return text;
  });

  return { valid: diagnostics.length === 0, diagnostics };
}

function diffLineCount(original: string, updated: string): number {
  const a = original.split('\n');
  const b = updated.split('\n');
  const max = Math.max(a.length, b.length);
  let changed = 0;
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) changed++;
  }
  return changed;
}

export async function runCodeRefactor(payload: CodeRefactorPayload): Promise<CodeRefactorResult> {
  const { filePath, instruction, newContent } = payload;

  if (!filePath) {
    throw new Error('filePath saknas i payload');
  }
  if (typeof newContent !== 'string' || newContent.length === 0) {
    throw new Error('newContent saknas eller är tom — inget att skriva.');
  }

  // Försvar i djupled: enqueue via /api/jobs/enqueue kringgår approvalGate,
  // så policy valideras här igen innan disk berörs.
  const policyCheck = evaluateFilePath(filePath, 'write');
  if (!policyCheck.allowed) {
    throw new Error(policyCheck.reason || `Åtkomst nekad för '${filePath}'`);
  }

  const absolutePath = resolveSafePath(filePath);

  const originalContent = fs.existsSync(absolutePath)
    ? fs.readFileSync(absolutePath, 'utf-8')
    : (payload.originalContent ?? '');

  const { valid, diagnostics } = checkSyntax(filePath, newContent);
  if (!valid) {
    return {
      success: false,
      filePath,
      syntaxValid: false,
      linesChanged: 0,
      message: `Refaktorering '${instruction}' avbröts: syntaxfel i föreslagen kod.`,
      diagnostics
    };
  }

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, newContent, 'utf-8');

  const linesChanged = diffLineCount(originalContent, newContent);

  return {
    success: true,
    filePath,
    syntaxValid: true,
    linesChanged,
    message: `Refaktorering '${instruction}' genomförd och skriven till ${filePath}.`
  };
}
