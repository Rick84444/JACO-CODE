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
 * Ensures that filePath actually resolves inside the project root.
 * Blocks path traversal (e.g. '../../etc/passwd').
 */
function resolveSafePath(filePath: string): string {
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  const normalizedRoot = PROJECT_ROOT + path.sep;
  if (resolved !== PROJECT_ROOT && !resolved.startsWith(normalizedRoot)) {
    throw new Error(`Path traversal blocked: '${filePath}' is outside the project root.`);
  }
  return resolved;
}

/**
 * Real syntax check via the TypeScript public compiler API (transpileModule).
 * Catches parse errors (unbalanced blocks, broken JSX etc). This is a syntax
 * check, not a full type check; for that, see qualityAuditorWorker.
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
      return `${text} (line ${line + 1})`;
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
    throw new Error('filePath missing from payload');
  }
  if (typeof newContent !== 'string' || newContent.length === 0) {
    throw new Error('newContent is missing or empty — nothing to write.');
  }

  // Defense in depth: enqueue via /api/jobs/enqueue bypasses approvalGate,
  // so policy is validated again here before the disk is touched.
  const policyCheck = evaluateFilePath(filePath, 'write');
  if (!policyCheck.allowed) {
    throw new Error(policyCheck.reason || `Access denied for '${filePath}'`);
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
      message: `Refactoring '${instruction}' aborted: syntax error in proposed code.`,
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
    message: `Refactoring '${instruction}' completed and written to ${filePath}.`
  };
}
