import { normalizeCodingContract } from '../../agents/lib/coding-contract.mjs';

export const SELF_DEVELOPMENT_SCHEMA = 'jaco.self-development/v1';

// Level-5 self-development may improve canonical runtime components. Secret
// files remain denied by the coding-contract defaults; truth comes from tests,
 // receipts and Git history rather than a static protected-source list.
const PROTECTED_SELF_MODIFICATION_PATHS = [];

const SAFE_NPM_SCRIPTS = /^(?:test(?::[A-Za-z0-9_.-]+)?|lint|build|typecheck|check(?::[A-Za-z0-9_.-]+)?)$/;

function normalizeCommand(value) {
  const command = String(value || '').trim();
  if (!command || command.length > 500) throw new Error('SELF_DEVELOPMENT_VERIFICATION_COMMAND_REQUIRED');
  if (/[\r\n;&|><`$]/.test(command)) throw new Error('SELF_DEVELOPMENT_UNSAFE_VERIFICATION_COMMAND');

  const tokens = command.split(/\s+/);
  const unsafePathToken = token => token === '..' || token.startsWith('../') || token.includes('/../') || token.startsWith('/') || /^[A-Za-z]:[\\/]/.test(token);
  if (tokens.some(unsafePathToken)) throw new Error('SELF_DEVELOPMENT_VERIFICATION_PATH_UNSAFE');
  if (tokens[0] === 'npm' && tokens[1] === 'test' && tokens.length === 2) return command;
  if (tokens[0] === 'npm' && tokens[1] === 'run' && SAFE_NPM_SCRIPTS.test(tokens[2] || '') && tokens.length === 3) return command;
  if (tokens[0] === 'node' && tokens[1] === '--check' && tokens.length === 3) return command;
  if (tokens[0] === 'node' && tokens[1] === '--test' && tokens.length >= 2) return command;
  throw new Error('SELF_DEVELOPMENT_VERIFICATION_COMMAND_NOT_ALLOWLISTED');
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value).trim()).filter(Boolean))];
}

export function buildSelfDevelopmentGraph(input = {}) {
  if (input.schema && input.schema !== SELF_DEVELOPMENT_SCHEMA) throw new Error('SELF_DEVELOPMENT_SCHEMA_UNSUPPORTED');

  const mode = input.mode || 'improve';
  if (!['improve', 'stabilize'].includes(mode)) throw new Error('SELF_DEVELOPMENT_MODE_UNSUPPORTED');
  const stabilize = mode === 'stabilize';
  const objective = String(input.objective || '').trim();
  if (!objective || objective.length > 12000) throw new Error('SELF_DEVELOPMENT_OBJECTIVE_REQUIRED');

  const allowed = uniqueStrings(input.scope?.allowed);
  if (!allowed.length) throw new Error('SELF_DEVELOPMENT_SCOPE_REQUIRED');

  const acceptance = uniqueStrings(input.acceptance).slice(0, 50);
  if (!acceptance.length) throw new Error('SELF_DEVELOPMENT_ACCEPTANCE_REQUIRED');

  const commands = uniqueStrings(input.verification?.commands || ['npm test']).map(normalizeCommand);
  if (!commands.length) throw new Error('SELF_DEVELOPMENT_VERIFICATION_COMMAND_REQUIRED');
  const forbidden = uniqueStrings([
    ...(input.scope?.forbidden || []),
    ...PROTECTED_SELF_MODIFICATION_PATHS,
  ]);

  const contract = normalizeCodingContract({
    schema: 'jaco.coding-contract/v1',
    objective,
    scope: { allowed, forbidden },
    services: input.services || [],
    acceptance,
    execution: {
      autonomous: true,
      allow_git_commit: input.execution?.allow_git_commit !== false,
      allow_git_push: input.execution?.allow_git_push !== false,
      allow_git_merge: input.execution?.allow_git_merge !== false,
      require_human_before_destructive_action: false,
    },
    verification: {
      tests_required: true,
      falsifier_required: stabilize || input.verification?.falsifier_required !== false,
      independent_verification: stabilize || input.verification?.independent_verification === true,
      required_stages: input.verification?.required_stages || [],
      receipt_required: true,
      commands,
    },
    budget: input.budget || {},
  });

  return {
    title: String(input.title || 'JACO self-development').trim().slice(0, 300),
    objective,
    policy: {
      schema: SELF_DEVELOPMENT_SCHEMA,
      mode: stabilize ? 'contract-bound-stabilization' : 'contract-bound-code-improvement',
      autonomy: 'closed-loop',
      authority: 'operator-authenticated-seer',
      mutation_scope: allowed,
      protected_paths: PROTECTED_SELF_MODIFICATION_PATHS,
      release: 'verified-autonomous',
      git_push: contract.execution.allow_git_push,
      deploy: true,
      root_authority_mutation: true,
      operator_confirmation_required_for_release: false,
      outgoing_financial_commitment_requires_operator_approval: true,
    },
    nodes: [{
      key: 'code-change',
      title: 'Implement verified code improvement',
      objective,
      contract,
      dependencies: [],
    }],
  };
}

export function selfDevelopmentProtectedPaths() {
  return [...PROTECTED_SELF_MODIFICATION_PATHS];
}
