// The one list of cloud model services JACO recognises (operator 2026-10-09: providers must not be
// hard-coded in several places). Used by URL discovery, by key identification and by the registry that
// turns a stored key into a registered provider. Adding a service is one line here.
//   match     host pattern of the service or its product site
//   keyPrefix how that service's keys start; used to know which service a pasted key belongs to
//   modelEnv/baseEnv  optional environment overrides that were already in use
export const CATALOG = [
  { match: /(^|\.)deepseek\.com$/, id: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY', defaultModel: 'deepseek-flash', modelEnv: 'DEEPSEEK_MODEL', keyPrefix: /^sk-[a-f0-9]{32}$/i },
  { match: /(^|\.)groq\.com$/, id: 'groq', baseUrl: 'https://api.groq.com/openai/v1', apiKeyEnv: 'GROQ_API_KEY', defaultModel: 'openai/gpt-oss-120b', modelEnv: 'GROQ_MODEL', keyPrefix: /^gsk_/ },
  { match: /(^|\.)openai\.com$/, id: 'openai', baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY', modelEnv: 'OPENAI_MODEL', keyPrefix: /^sk-(proj|svcacct|admin)-/ },
  { match: /(^|\.)openrouter\.ai$/, id: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY', defaultModel: 'qwen/qwen3.8-27b:free', modelEnv: 'OPENROUTER_MODEL', keyPrefix: /^sk-or-/ },
  { match: /(^|\.)together\.(xyz|ai)$/, id: 'together', baseUrl: 'https://api.together.xyz/v1', apiKeyEnv: 'TOGETHER_API_KEY', modelEnv: 'TOGETHER_MODEL' },
  { match: /(^|\.)mistral\.ai$/, id: 'mistral', baseUrl: 'https://api.mistral.ai/v1', apiKeyEnv: 'MISTRAL_API_KEY', modelEnv: 'MISTRAL_MODEL' },
  { match: /(^|\.)anthropic\.com$|(^|\.)claude\.(ai|com)$/, id: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKeyEnv: 'ANTHROPIC_API_KEY', keyPrefix: /^sk-ant-/ },
  { match: /(^|\.)(googleapis\.com|ai\.google\.dev|aistudio\.google\.com|gemini\.google\.com)$/, id: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKeyEnv: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL', keyPrefix: /^AIza/ },
  { match: /(^|\.)x\.ai$/, id: 'xai', baseUrl: 'https://api.x.ai/v1', apiKeyEnv: 'XAI_API_KEY', keyPrefix: /^xai-/ },
  { match: /(^|\.)(dashscope[-a-z]*\.aliyuncs\.com|qwen\.ai)$/, id: 'qwen', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', apiKeyEnv: 'QWEN_API_KEY', defaultModel: 'qwen-max', modelEnv: 'QWEN_MODEL', baseEnv: 'QWEN_BASE_URL', keyPrefix: /^sk-[a-f0-9]{32}$/i },
  { match: /(^|\.)huggingface\.co$/, id: 'huggingface', baseUrl: 'https://router.huggingface.co/v1', apiKeyEnv: 'HUGGINGFACE_TOKEN', keyPrefix: /^hf_/ },
];

export const catalogById = id => CATALOG.find(c => c.id === id) || null;

// Services a pasted key can belong to. A key shape that several services share (DeepSeek and Qwen both
// issue "sk-" plus 32 hex characters) returns all of them: the key is never sent to a service the
// operator has not chosen, so the caller asks which one.
export const keyCandidates = key => {
  const value = String(key || '').trim();
  return CATALOG.filter(c => c.keyPrefix && c.keyPrefix.test(value));
};

// The registry entry a catalog service gets when its key exists (env overrides honoured).
export const catalogProvider = (entry, env = process.env) => ({
  id: entry.id,
  kind: 'openai-compatible',
  baseUrl: String((entry.baseEnv && env[entry.baseEnv]) || entry.baseUrl).replace(/\/+$/, ''),
  apiKeyEnv: entry.apiKeyEnv,
  defaultModel: (entry.modelEnv && env[entry.modelEnv]) || entry.defaultModel || '',
});
