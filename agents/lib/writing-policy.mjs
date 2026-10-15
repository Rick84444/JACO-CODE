// Writing policy for public posts (operator 2026-10-03: Nova must write like a human, and honestly).
// The rules live in skills/community-post/SKILL.md; this is the machine check run on a draft before
// anything is published. It returns every violation, not a score.
const BANNED = ['revolutionary', 'game-changer', 'game changer', 'cutting-edge', 'unlock', 'seamless', 'seamlessly', 'supercharge',
  'leverage', 'delve', 'elevate', 'empower', "in today's fast-paced world", 'next level', 'synergy', 'best-in-class', 'world-class'];
// Emoji are banned outright (operator rule, repeated 2026-10-03), including symbols, flags and the emoji selector.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}]/u;
const HUMAN_CLAIM = /\b(as a (human|person|real person|developer myself)|i(?:'m| am) (a )?(human|not an? (ai|bot|agent)))\b/i;
const FAKE_PEER = /\b(i stumbled upon|found this (great|amazing) tool|not affiliated|no affiliation)\b/i;

export function checkPost(text, { maxLinks = 1, maxLength = 4000, agentForum = false } = {}) {
  const t = String(text || '');
  const lower = t.toLowerCase();
  const problems = [];
  for (const word of BANNED) if (new RegExp(`\\b${word.replace(/[-']/g, m => `\\${m}`)}\\b`, 'i').test(lower)) problems.push(`marketing word: ${word}`);
  if (EMOJI.test(t)) problems.push('emoji');
  if (/(^|\s)#[A-Za-z]\w+/.test(t)) problems.push('hashtag');
  if ((t.match(/!/g) || []).length > 1) problems.push('more than one exclamation mark');
  const links = (t.match(/https?:\/\/\S+/g) || []).length;
  if (links > maxLinks) problems.push(`${links} links (max ${maxLinks})`);
  if (t.length > maxLength) problems.push(`${t.length} characters (max ${maxLength})`);
  if (HUMAN_CLAIM.test(t)) problems.push('claims to be human');
  if (FAKE_PEER.test(t)) problems.push('poses as an independent user');
  if (agentForum && !/\b(agent|JACO)\b/i.test(t)) problems.push('on an agent forum the post must say it comes from JACO\'s agent');
  const sentences = t.split(/(?<=[.!?])\s+/).filter(s => s.trim());
  const long = sentences.filter(s => s.split(/\s+/).length > 35).length;
  if (long) problems.push(`${long} sentence(s) over 35 words`);
  return { ok: problems.length === 0, problems };
}

// Every text Nova hands over (mission answers included) leaves without emoji.
export const stripEmoji = text => String(text ?? '').replace(new RegExp(EMOJI.source, 'gu'), '').replace(/[ \t]{2,}/g, ' ');
