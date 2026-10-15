import { execFile } from 'child_process';
import { promisify } from 'util';
import { evaluateCommand } from '../../gate/policyRules.js';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = process.cwd();

export interface GitOpsPayload {
  action: 'status' | 'commit' | 'branch' | 'diff';
  message?: string;
  branchName?: string;
  files?: string[];
}

export interface GitOpsResult {
  success: boolean;
  action: string;
  output: string;
  hash?: string;
}

/**
 * Försvar i djupled: git körs alltid via execFile med argument-array (aldrig
 * en shell-sträng), men vi blockerar ändå skal-farliga tecken i fritext-fält
 * (commit-meddelande, branchnamn) så de aldrig kan misstolkas nedströms.
 */
function sanitizeArg(value: string, label: string): string {
  if (/[;&|`$<>\n\r]/.test(value)) {
    throw new Error(`${label} innehåller otillåtna tecken.`);
  }
  return value;
}

async function runGit(args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd: PROJECT_ROOT,
      timeout: 15000
    });
    return stdout.trim() || stderr.trim();
  } catch (err: any) {
    throw new Error(`git ${args.join(' ')} misslyckades: ${err?.stderr || err?.message}`);
  }
}

export async function runGitOps(payload: GitOpsPayload): Promise<GitOpsResult> {
  const { action, message, branchName, files } = payload;

  switch (action) {
    case 'status': {
      const output = await runGit(['status', '--porcelain=v1', '--branch']);
      return { success: true, action, output: output || 'Inga ändringar.' };
    }

    case 'diff': {
      const output = await runGit(['diff', '--stat']);
      return { success: true, action, output: output || 'Inga skillnader.' };
    }

    case 'branch': {
      if (!branchName) throw new Error('branchName krävs för action=branch');
      sanitizeArg(branchName, 'branchName');

      const policyCheck = evaluateCommand(`git checkout -b ${branchName}`);
      if (!policyCheck.allowed) throw new Error(policyCheck.reason);

      await runGit(['checkout', '-b', branchName]);
      const hash = await runGit(['rev-parse', 'HEAD']);
      return { success: true, action, output: `Ny branch '${branchName}' skapad och utcheckad.`, hash };
    }

    case 'commit': {
      if (!message) throw new Error('message krävs för action=commit');
      sanitizeArg(message, 'message');

      const policyCheck = evaluateCommand(`git commit -m ${message}`);
      if (!policyCheck.allowed) throw new Error(policyCheck.reason);

      if (files && files.length > 0) {
        for (const f of files) sanitizeArg(f, 'files');
        await runGit(['add', ...files]);
      } else {
        await runGit(['add', '-A']);
      }

      const staged = await runGit(['diff', '--cached', '--name-only']);
      if (!staged) {
        return { success: false, action, output: 'Inget att committa — inga ändringar i arbetskatalogen.' };
      }

      await runGit(['commit', '-m', message]);
      const hash = await runGit(['rev-parse', 'HEAD']);
      return { success: true, action, output: `Commit skapad: "${message}"`, hash };
    }

    default:
      throw new Error(`Okänd git-action: '${action}'`);
  }
}
