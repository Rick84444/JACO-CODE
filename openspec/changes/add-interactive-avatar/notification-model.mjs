// Synthetic discrete-event experiment; not an observation of the production runtime.
export function deduplicate(ids) { return [...new Set(ids)]; }
export function measure(expected, actual) {
  const counts = new Map();
  for (const id of actual) counts.set(id, (counts.get(id) ?? 0) + 1);
  const wanted = new Set(expected);
  let duplicates = 0, unexpected = 0, missed = 0;
  for (const [id, count] of counts) {
    duplicates += Math.max(0, count - 1);
    if (!wanted.has(id)) unexpected += count;
  }
  for (const id of wanted) if (!counts.has(id)) missed++;
  return {duplicates, unexpected, missed};
}
export function experiment(seed = 42, trials = 1000, consumer = deduplicate) {
  if (!Number.isSafeInteger(trials) || trials < 1) throw new RangeError('trials');
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('seed');
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const result = {trials, deliveries: 0, baselineDuplicates: 0, deduplicatedDuplicates: 0, missed: 0, unexpected: 0};
  for (let i = 0; i < trials; i++) {
    const expected = [], incoming = [];
    for (let j = 0; j < 20; j++) {
      const id = `${i}:${j}`;
      expected.push(id);
      const copies = 1 + (random() < .25 ? 1 : 0) + (random() < .1 ? 1 : 0);
      for (let k = 0; k < copies; k++) incoming.push(id);
    }
    const baseline = measure(expected, incoming);
    const observed = measure(expected, consumer([...incoming]));
    result.deliveries += incoming.length;
    result.baselineDuplicates += baseline.duplicates;
    result.deduplicatedDuplicates += observed.duplicates;
    result.missed += observed.missed;
    result.unexpected += observed.unexpected;
  }
  return result;
}
