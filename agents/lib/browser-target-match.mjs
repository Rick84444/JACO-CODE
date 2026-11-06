// Picks the one visible page element a model means by a name. Models quote a link from memory ("Learn more" for a
// page whose link reads "More information..."), so an exact match alone failed with NO_TARGET and the model had no way
// to correct itself. Exact (ignoring case, spacing and a trailing ellipsis) first; then a unique partial match; and when
// nothing fits, the names that ARE on the page come back with the error.
const normal = value => String(value || '').toLowerCase().replace(/\s+/g, ' ').replace(/[\s.…:;,!?]+$/g, '').trim();

export function pickTarget(targets, name) {
  const wanted = normal(name);
  const visible = (Array.isArray(targets) ? targets : []).filter(t => t?.visible && normal(t.text));
  const available = [...new Set(visible.map(t => String(t.text).replace(/\s+/g, ' ').trim().slice(0, 80)))].slice(0, 15);
  if (!wanted) return { error: 'NO_TARGET', available };
  const exact = visible.filter(t => normal(t.text) === wanted);
  if (exact.length === 1) return { target: exact[0], matched: 'exact' };
  if (exact.length > 1) return { error: 'AMBIGUOUS_TARGET', available };
  const partial = visible.filter(t => normal(t.text).includes(wanted) || (normal(t.text).length >= 4 && wanted.includes(normal(t.text))));
  if (partial.length === 1) return { target: partial[0], matched: 'partial' };
  return { error: partial.length ? 'AMBIGUOUS_TARGET' : 'NO_TARGET', available };
}
