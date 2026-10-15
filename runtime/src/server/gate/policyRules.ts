export interface PolicyCheckResult {
  allowed: boolean;
  requiresApproval: boolean;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  reason?: string;
}

const FORBIDDEN_FILE_PATTERNS = [
  /\.env(\..+)?$/i,
  /id_rsa/i,
  /\.pem$/i,
  /\.git\//i,
  /credentials\.json/i,
  /service-account.*\.json/i
];

const HIGH_RISK_COMMANDS = [
  /^rm\s+-rf\s+[\/\*]/i,
  /^git\s+push\s+.*--force/i,
  /^git\s+reset\s+--hard/i,
  /^mkfs/i,
  /^dd\s+if=/i
];

// Workspace-local writes are normal mission execution. Secret-bearing paths are
// still denied above; destructive delete and external distribution remain gated.
export function evaluateFilePath(filePath: string, operation: 'read' | 'write' | 'delete'): PolicyCheckResult {
  const normalized = filePath.replace(/\\/g, '/');

  // Kontrollera om förbjuden fil
  for (const pattern of FORBIDDEN_FILE_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        allowed: false,
        requiresApproval: false,
        riskLevel: 'CRITICAL',
        reason: `Åtkomst nekad: '${filePath}' matchar säkerhetsskyddat mönster.`
      };
    }
  }

  // Om det är delete
  if (operation === 'delete') {
    return {
      allowed: true,
      requiresApproval: true,
      riskLevel: 'HIGH',
      reason: `Filborttagning av '${filePath}' kräver operatörsgodkännande.`
    };
  }

  // Workspace-local writes are allowed by default. Higher-consequence system
  // mutations use the explicit system_patch/deployment gates instead.
  return {
    allowed: true,
    requiresApproval: false,
    riskLevel: 'LOW'
  };
}

export function evaluateCommand(command: string): PolicyCheckResult {
  const trimmed = command.trim();

  for (const dangerous of HIGH_RISK_COMMANDS) {
    if (dangerous.test(trimmed)) {
      return {
        allowed: false,
        requiresApproval: false,
        riskLevel: 'CRITICAL',
        reason: `Kommandot '${trimmed}' är blockerats av säkerhetspolicy (hög destruktionsrisk).`
      };
    }
  }

  // Git push, release eller externa anrop kräver godkännande
  if (/^git\s+push/i.test(trimmed) || /^npm\s+publish/i.test(trimmed)) {
    return {
      allowed: true,
      requiresApproval: true,
      riskLevel: 'HIGH',
      reason: `Externt distributionskommando kräver operatörsgodkännande.`
    };
  }

  return {
    allowed: true,
    requiresApproval: false,
    riskLevel: 'LOW'
  };
}
