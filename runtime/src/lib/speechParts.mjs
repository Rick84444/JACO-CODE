// Splits a reply into parts Aura speaks one after another: whole sentences, short ones joined up to about
// 220 characters, very long ones cut at a comma or space. The first part is kept short so speech starts fast.
const MAX = 220, FIRST = 140;

/** @param {string} text @returns {string[]} */
export function speechParts(text) {
  // Spoken text has no code, link targets or web addresses (she read whole source URLs aloud, 2026-11-25).
  const clean = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]*\)/g, '$1')
    .replace(/\(?\s*(?:källa|source)\s*:\s*(?:https?:\/\/|www\.)[^\s)]+\s*\)?/gi, ' ')
    .replace(/(?:https?:\/\/|www\.)[^\s)\]]+/g, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/[*_#>`]+/g, '').replace(/\s+([.,;:!?])/g, '$1').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?…]+(?:[.!?…]+["')\]]*|$)/g)?.map(s => s.trim()).filter(Boolean) || [clean];
  const pieces = [];
  for (const sentence of sentences) {
    let rest = sentence;
    while (rest.length > MAX) {
      const window = rest.slice(0, MAX);
      const cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(' '));
      const at = cut > MAX / 3 ? cut + 1 : MAX;
      pieces.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) pieces.push(rest);
  }
  const parts = [];
  for (const piece of pieces) {
    const last = parts.length - 1;
    const limit = last === 0 ? FIRST : MAX;
    if (last >= 0 && parts[last].length + 1 + piece.length <= limit) parts[last] += ' ' + piece;
    else parts.push(piece);
  }
  return parts;
}
