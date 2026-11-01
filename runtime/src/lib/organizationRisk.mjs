// Client-side preview only. The runtime's decide() remains authoritative.
export function wouldCompleteTrifecta(currentKeys, permissionCatalog, proposedKey) {
  const exposure = new Set();
  for (const key of new Set([...(currentKeys || []), proposedKey])) {
    for (const kind of permissionCatalog?.[key]?.exposure || []) exposure.add(kind);
  }
  return exposure.has('untrusted') && exposure.has('private') && exposure.has('external');
}
