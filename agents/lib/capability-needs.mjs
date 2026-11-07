// What a step of the plan needs, in words the operator can follow: a skill, web research, the browser, an account
// somewhere, an API, code and files, a payment or wallet. Read from the step's own goal, so the plan shows its needs
// before anything runs. Needs that leave the computer or touch money are marked as needing the operator's approval.
// It describes; it never grants. The mission contract and the operator's approvals stay the authority.
const RULES = [
  { kind: 'research', label: { sv: 'Undersökning på webben', en: 'Web research' }, match: /\b(research|undersök\w*|sök\w*|trend\w*|jämför\w*|marknad\w*|analys\w*|search|compare|market)\b/i },
  { kind: 'browser', label: { sv: 'Webbläsaren', en: 'The browser' }, match: /\b(öppna|klicka|webbsida|sajten?|browser|click|open the|on the page|sign ?up)\b/i },
  { kind: 'account', label: { sv: 'Konto eller medlemskap', en: 'An account or membership' }, approval: true, match: /\b(konto\w*|medlemskap\w*|registrer\w*|account|membership|sign ?up|register)\b/i },
  { kind: 'api', label: { sv: 'Koppling till en tjänst (API)', en: 'A connection to a service (API)' }, approval: true, match: /\b(api|koppla in|integrer\w*|webhook|connect to|integrate)\b/i },
  { kind: 'code', label: { sv: 'Kod och filer', en: 'Code and files' }, match: /\b(bygg\w*|skapa en? (sida|fil|app|webbsida)|kod\w*|fil\w*|html|app|build|code|file|page|website)\b/i },
  { kind: 'publish', label: { sv: 'Publicering', en: 'Publishing' }, approval: true, match: /\b(publicer\w*|lägg ut|posta|inlägg|publish|post on|deploy)\b/i },
  { kind: 'payment', label: { sv: 'Betalning eller plånbok', en: 'A payment or wallet' }, approval: true, match: /\b(betal\w*|pris\w*|inkomst\w*|intäkt\w*|sälj\w*|wallet|plånbok|stripe|payment|price|income|revenue|sell)\b/i },
  { kind: 'helpers', label: { sv: 'Hjälpagenter', en: 'Helper agents' }, match: /\b(hjälpagent\w*|underagent\w*|helper agents?|sub-?agents?|parallel\w*)\b/i },
];

// Skills that fit a step, by the words of their description.
const SKILL_HINTS = [
  { id: 'build-web-page', match: /\b(webbsida|landningssida|hemsida|sida för|web ?page|website|landing page)\b/i },
  { id: 'fix-a-bug', match: /\b(bugg|fel i|rätta|fix|bug|broken|error)\b/i },
  { id: 'web-research', match: /\b(research|undersök\w*|trend\w*|jämför\w*|search|compare)\b/i },
];

export function needsFor(text, { skills = [], language = 'en' } = {}) {
  const s = String(text || '');
  const needs = RULES.filter(r => r.match.test(s)).map(r => ({ kind: r.kind, label: r.label[language] || r.label.en, approval: Boolean(r.approval) }));
  const available = new Set(skills.map(k => k.id || k));
  for (const hint of SKILL_HINTS) {
    if (hint.match.test(s) && (!available.size || available.has(hint.id))) needs.push({ kind: 'skill', id: hint.id, label: (language === 'sv' ? 'Skill: ' : 'Skill: ') + hint.id, approval: false });
  }
  return needs;
}
