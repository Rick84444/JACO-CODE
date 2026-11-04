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
 * Defense in depth: git always runs via execFile with an argument array (never
 * a shell string), but we still block shell-dangerous characters in free-text
 * fields (commit message, branch name) so they can never be misread downstream.
 */
function sanitizeArg(value: string, label: string): string {
  if (/[;&|`$<>\n\r]/.test(value)) {
    throw new Error(`${label} contains disallowed characters.`);
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
    throw new Error(`git ${args.join(' ')} failed: ${err?.stderr || err?.message}`);
  }
}

export async function runGitOps(payload: GitOpsPayload): Promise<GitOpsResult> {
  const { action, message, branchName, files } = payload;

  switch (action) {
    case 'status': {
      const output = await runGit(['status', '--porcelain=v1', '--branch']);
      return { success: true, action, output: output || 'No changes.' };
    }

    case 'diff': {
      const output = await runGit(['diff', '--stat']);
      return { success: true, action, output: output || 'No differences.' };
    }

    case 'branch': {
      if (!branchName) throw new Error('branchName is required for action=branch');
      sanitizeArg(branchName, 'branchName');

      const policyCheck = evaluateCommand(`git checkout -b ${branchName}`);
      if (!policyCheck.allowed) throw new Error(policyCheck.reason);

      await runGit(['checkout', '-b', branchName]);
      const hash = await runGit(['rev-parse', 'HEAD']);
      return { success: true, action, output: `New branch '${branchName}' created and checked out.`, hash };
    }

    case 'commit': {
      if (!message) throw new Error('message is required for action=commit');
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
        return { success: false, action, output: 'Nothing to commit — no changes in the working tree.' };
      }

      await runGit(['commit', '-m', message]);
      const hash = await runGit(['rev-parse', 'HEAD']);
      return { success: true, action, output: `Commit created: "${message}"`, hash };
    }

    default:
      throw new Error(`Unknown git action: '${action}'`);
  }
}
