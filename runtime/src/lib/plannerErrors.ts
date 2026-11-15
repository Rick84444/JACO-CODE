// Readable text for why a model could not become the agent's planner. Returns null for other errors.
export function plannerErrorText(message: string): string | null {
  const code = String(message || '');
  if (!code.startsWith('PLANNER_') && code !== 'PAID_PROVIDER_DISABLED') return null;
  if (code.includes('PAID_PROVIDER_DISABLED')) return 'Paid models are turned off for the agent (JACO_ALLOW_PAID_MODELS=0). Remove that setting from .env and restart, or choose a local model.';
  if (code.includes('PLANNER_ENV_PRIMARY_AUTHORITATIVE')) return "The agent's model is locked by JACO_PRIMARY_PROVIDER in the environment.";
  if (code.includes('PLANNER_KEY_MISSING')) return 'This provider has no API key.';
  if (code.includes('PLANNER_MODEL_NO_TOOLS')) return 'The model can chat but cannot use tools, so the agent cannot plan with it. It can still be used in the conversation.';
  if (code.includes('PLANNER_MODEL_NOT_TEXT')) return 'The model is not a text model and cannot plan.';
  if (code.includes('PLANNER_MODEL_UNKNOWN')) return 'The provider does not list that model. Check the name or choose another.';
  if (code.startsWith('PLANNER_MODEL_TEXT_PROBE_FAILED')) return 'The model did not answer the test prompt, so the choice was not saved. Check that the provider is running.';
  return null;
}
