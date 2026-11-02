import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  LMStudioMissionContract,
  LMStudioMode,
  LMStudioPendingApproval,
  LMStudioIntegrationError
} from './schemas';

export class LMStudioPolicyGate {
  private static DEFAULT_ALLOWLIST_COMMANDS = [
    'npm run lint',
    'tsc --noEmit',
    'npx vitest run',
    'npm test',
    'npm run test',
    'npm run build'
  ];

  private static DEFAULT_DENIED_PATHS = [
    '.env',
    '.env.local',
    '.env.production',
    'node_modules',
    '.git',
    'dist'
  ];

  private static HIGH_RISK_COMMAND_PATTERNS = [
    /rm\s+-rf/,
    /git\s+push/,
    /git\s+reset/,
    /git\s+clean/,
    /npm\s+publish/,
    /sudo/,
    /chmod/,
    /chown/,
    /drop\s+database/i,
    /truncate/i
  ];

  /**
   * Resolves canonical real path protecting against symlink bypass and path traversal.
   */
  public static resolveCanonicalPath(baseWorkspace: string, targetSubPath: string): {
    valid: boolean;
    canonicalPath: string;
    canonicalWorkspace: string;
    error?: string;
  } {
    try {
      const canonicalWorkspace = fs.realpathSync(path.resolve(baseWorkspace));
      const targetAbs = path.resolve(canonicalWorkspace, targetSubPath);

      if (!targetAbs.startsWith(canonicalWorkspace)) {
        return {
          valid: false,
          canonicalPath: targetAbs,
          canonicalWorkspace,
          error: `Path traversal blocked: ${targetSubPath} is outside workspace ${canonicalWorkspace}`
        };
      }

      if (fs.existsSync(targetAbs)) {
        const canonicalTarget = fs.realpathSync(targetAbs);
        if (!canonicalTarget.startsWith(canonicalWorkspace)) {
          return {
            valid: false,
            canonicalPath: canonicalTarget,
            canonicalWorkspace,
            error: `Symlink bypass blocked: ${targetSubPath} points outside the workspace`
          };
        }
        return { valid: true, canonicalPath: canonicalTarget, canonicalWorkspace };
      }

      return { valid: true, canonicalPath: targetAbs, canonicalWorkspace };
    } catch (err: any) {
      return {
        valid: false,
        canonicalPath: targetSubPath,
        canonicalWorkspace: baseWorkspace,
        error: `Could not verify canonical path: ${err?.message || err}`
      };
    }
  }

  /**
   * Validates a mission contract against workspace boundaries, policies, and allowlists.
   */
  public static validateMissionContract(
    contract: LMStudioMissionContract,
    pluginEnabled: boolean
  ): { valid: boolean; errors: LMStudioIntegrationError[] } {
    const errors: LMStudioIntegrationError[] = [];

    if (!pluginEnabled) {
      errors.push({
        code: 'PLUGIN_DISABLED',
        message: 'The LM Studio Runtime Adapter plugin is disabled by default. Enable it in settings.',
        category: 'configuration',
        retryable: false
      });
      return { valid: false, errors };
    }

    if (!contract.workspacePath) {
      errors.push({
        code: 'MISSING_WORKSPACE',
        message: 'Workspace path is missing or cannot be verified.',
        category: 'configuration',
        retryable: false
      });
    } else if (!fs.existsSync(contract.workspacePath)) {
      errors.push({
        code: 'INVALID_WORKSPACE',
        message: `The specified workspace folder does not exist: ${contract.workspacePath}`,
        category: 'configuration',
        retryable: false
      });
    }

    if (contract.workspacePath) {
      const canonical = this.resolveCanonicalPath(contract.workspacePath, '');
      if (!canonical.valid) {
        errors.push({
          code: 'PATH_TRAVERSAL_RISK',
          message: canonical.error || 'Path traversal detected in workspace.',
          category: 'permission',
          retryable: false
        });
      }
    }

    const denied = [...this.DEFAULT_DENIED_PATHS, ...(contract.deniedPaths || [])];
    if (contract.allowedPaths) {
      for (const p of contract.allowedPaths) {
        if (denied.some((d) => p.includes(d))) {
          errors.push({
            code: 'DENIED_PATH_REQUESTED',
            message: `Requested path (${p}) matches the deny list (${denied.join(', ')})`,
            category: 'policy',
            retryable: false
          });
        }
      }
    }

    if (contract.allowedCommands && contract.allowedCommands.length > 0) {
      for (const cmd of contract.allowedCommands) {
        if (!this.isCommandAllowed(cmd, contract.allowedCommands)) {
          errors.push({
            code: 'COMMAND_NOT_ALLOWLISTED',
            message: `Command not in allowlist: ${cmd}`,
            category: 'policy',
            retryable: false
          });
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  public static isCommandAllowed(command: string, customAllowlist?: string[]): boolean {
    const cleanCmd = command.trim();
    const allowlist = customAllowlist && customAllowlist.length > 0
      ? customAllowlist
      : this.DEFAULT_ALLOWLIST_COMMANDS;

    if (this.HIGH_RISK_COMMAND_PATTERNS.some((pattern) => pattern.test(cleanCmd))) {
      return false;
    }

    return allowlist.some((allowed) => cleanCmd === allowed || cleanCmd.startsWith(allowed + ' '));
  }

  public static requiresOperatorApproval(
    mode: LMStudioMode,
    actionType: string,
    targetFiles: string[],
    command?: string
  ): { approvalNeeded: boolean; riskClass: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; reason: string } {
    if (mode === 'advisor' && (actionType === 'patch.apply' || actionType === 'file.delete')) {
      return {
        approvalNeeded: true,
        riskClass: 'HIGH',
        reason: 'Advisor mode does not allow direct file writes without operator approval.'
      };
    }

    if (actionType === 'file.delete') {
      return {
        approvalNeeded: true,
        riskClass: 'HIGH',
        reason: 'Deleting files always requires operator approval.'
      };
    }

    if (targetFiles.some((f) => f.includes('.env') || f.includes('secret') || f.includes('key'))) {
      return {
        approvalNeeded: true,
        riskClass: 'CRITICAL',
        reason: 'Changes to configuration files containing secrets require explicit approval.'
      };
    }

    if (command) {
      if (this.HIGH_RISK_COMMAND_PATTERNS.some((p) => p.test(command))) {
        return {
          approvalNeeded: true,
          riskClass: 'CRITICAL',
          reason: `High-risk command (${command}) stopped by the safety gate.`
        };
      }
      if (command.includes('npm install') || command.includes('npm add')) {
        return {
          approvalNeeded: true,
          riskClass: 'MEDIUM',
          reason: 'Package installation requires operator approval.'
        };
      }
    }

    return {
      approvalNeeded: false,
      riskClass: 'LOW',
      reason: 'Low-risk action approved by automatic contract.'
    };
  }

  public static computeActionHash(missionId: string, actionId: string, actionPayload: object): string {
    const raw = `${missionId}:${actionId}:${JSON.stringify(actionPayload)}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  public static maskSecrets(text: string): string {
    if (!text) return text;
    return text
      .replace(/(Bearer\s+)[A-Za-z0-9_\-\.]{8,}/gi, '$1[MASKED_TOKEN]')
      .replace(/(sk-[A-Za-z0-9_\-]{16,})/gi, 'sk-[MASKED_KEY]')
      .replace(/(GEMINI_API_KEY=)[^\s&]+/gi, '$1[MASKED_KEY]')
      .replace(/(OPENAI_API_KEY=)[^\s&]+/gi, '$1[MASKED_KEY]')
      .replace(/("apiKey"\s*:\s*")[^"]+(")/gi, '$1[MASKED_KEY]$2');
  }
}
