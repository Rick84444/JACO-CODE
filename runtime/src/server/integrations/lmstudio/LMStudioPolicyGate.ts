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
          error: `Sökvägsöverskridande blockerat: ${targetSubPath} ligger utanför workspace ${canonicalWorkspace}`
        };
      }

      if (fs.existsSync(targetAbs)) {
        const canonicalTarget = fs.realpathSync(targetAbs);
        if (!canonicalTarget.startsWith(canonicalWorkspace)) {
          return {
            valid: false,
            canonicalPath: canonicalTarget,
            canonicalWorkspace,
            error: `Symlink-bypass blockerat: ${targetSubPath} pekar utanför workspace`
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
        error: `Kunde inte verifiera kanonisk sökväg: ${err?.message || err}`
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
        message: 'LM Studio Runtime Adapter plugin är avstängt som standard. Aktivera i inställningarna.',
        category: 'configuration',
        retryable: false
      });
      return { valid: false, errors };
    }

    if (!contract.workspacePath) {
      errors.push({
        code: 'MISSING_WORKSPACE',
        message: 'Workspace-sökväg saknas eller kan inte verifieras.',
        category: 'configuration',
        retryable: false
      });
    } else if (!fs.existsSync(contract.workspacePath)) {
      errors.push({
        code: 'INVALID_WORKSPACE',
        message: `Angiven workspace-mapp finns inte: ${contract.workspacePath}`,
        category: 'configuration',
        retryable: false
      });
    }

    if (contract.workspacePath) {
      const canonical = this.resolveCanonicalPath(contract.workspacePath, '');
      if (!canonical.valid) {
        errors.push({
          code: 'PATH_TRAVERSAL_RISK',
          message: canonical.error || 'Path traversal upptäckt i workspace.',
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
            message: `Begärd sökväg (${p}) matchar spärrad lista (${denied.join(', ')})`,
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
            message: `Kommando ej i allowlist: ${cmd}`,
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
        reason: 'Advisor-läge tillåter inte direkt filskrivning utan operatörsgodkännande.'
      };
    }

    if (actionType === 'file.delete') {
      return {
        approvalNeeded: true,
        riskClass: 'HIGH',
        reason: 'Borttagning av filer kräver alltid operatörsgodkännande.'
      };
    }

    if (targetFiles.some((f) => f.includes('.env') || f.includes('secret') || f.includes('key'))) {
      return {
        approvalNeeded: true,
        riskClass: 'CRITICAL',
        reason: 'Ändringar i konfigurationsfiler med hemligheter kräver explicit godkännande.'
      };
    }

    if (command) {
      if (this.HIGH_RISK_COMMAND_PATTERNS.some((p) => p.test(command))) {
        return {
          approvalNeeded: true,
          riskClass: 'CRITICAL',
          reason: `Högrisk-kommando (${command}) stoppat av safety-gate.`
        };
      }
      if (command.includes('npm install') || command.includes('npm add')) {
        return {
          approvalNeeded: true,
          riskClass: 'MEDIUM',
          reason: 'Paketinstallation kräver operatörsgodkännande.'
        };
      }
    }

    return {
      approvalNeeded: false,
      riskClass: 'LOW',
      reason: 'Lågriskåtgärd godkänd av automatiskt kontrakt.'
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
