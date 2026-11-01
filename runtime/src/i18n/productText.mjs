import { LEGACY_PRODUCT_LABELS, SWEDISH_MESSAGES } from './productMessages.mjs';

const own = (table, key) => Object.hasOwn(table, key) ? table[key] : undefined;
const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const templates = [...Object.entries(LEGACY_PRODUCT_LABELS), ...Object.keys(SWEDISH_MESSAGES).map(key => [key, key])]
  .filter(([source]) => /\{\d+\}/.test(source))
  .sort(([a], [b]) => b.replace(/\{\d+\}/g, '').length - a.replace(/\{\d+\}/g, '').length)
  .map(([source, english]) => {
    const slots = [];
    const parts = source.split(/(\{\d+\})/).map(part => {
      if (!/^\{\d+\}$/.test(part)) return escapePattern(part);
      slots.push(Number(part.slice(1, -1)));
      return '([\\s\\S]*?)';
    });
    return { pattern: new RegExp('^' + parts.join('') + '$'), english, slots };
  });
const recent = new Map();

/** Format product copy without translating API identifiers, user messages or model prompts. */
export function productText(message, language = 'en', values = []) {
  if (typeof message !== 'string') return '';
  const cacheKey = language + ':' + message;
  if (!values.length && recent.has(cacheKey)) return recent.get(cacheKey);
  let english = own(LEGACY_PRODUCT_LABELS, message) || message;
  let parameters = values;
  // Legacy server messages may already contain their parameters. Match only
  // registered product templates; arbitrary text and model replies are preserved.
  if (!values.length && english === message && !own(SWEDISH_MESSAGES, message) && message.length < 16000) {
    for (const template of templates) {
      const match = template.pattern.exec(message);
      if (!match) continue;
      english = template.english;
      parameters = [];
      template.slots.forEach((slot, index) => { parameters[slot] = match[index + 1]; });
      break;
    }
  }
  const text = language === 'sv' ? own(SWEDISH_MESSAGES, english) || english : english;
  const result = text.replace(/\{(\d+)\}/g, (placeholder, index) =>
    Number(index) < parameters.length ? String(parameters[Number(index)] ?? '') : placeholder);
  if (!values.length) {
    if (recent.size >= 512) recent.delete(recent.keys().next().value);
    recent.set(cacheKey, result);
  }
  return result;
}
