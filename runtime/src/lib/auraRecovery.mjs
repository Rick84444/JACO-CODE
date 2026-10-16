// Drafts are scoped to the server's project root and this browser tab. They are
// never submitted automatically. Preserve the original hash for conflict checks.
const keyFor = root => `jaco:workspace-drafts:v1:${root}`;

export function readWorkspaceDrafts(storage, root) {
  const empty = { input: '', documents: {}, drafts: {} };
  if (!root) return empty;
  const raw = storage.getItem(keyFor(root));
  if (!raw) return empty;
  const value = JSON.parse(raw);
  if (value?.version !== 1 || value.root !== root || typeof value.input !== 'string' || !Array.isArray(value.files)) throw new Error('DRAFT_FORMAT_INVALID');
  for (const entry of value.files) {
    const file = entry?.file;
    if (!file || typeof file.path !== 'string' || typeof file.hash !== 'string' || !file.hash || typeof file.content !== 'string' || typeof entry.draft !== 'string') throw new Error('DRAFT_FORMAT_INVALID');
    // Define own properties even for a file named __proto__.
    Object.defineProperty(empty.documents, file.path, { value: file, enumerable: true, writable: true, configurable: true });
    Object.defineProperty(empty.drafts, file.path, { value: entry.draft, enumerable: true, writable: true, configurable: true });
  }
  return { ...empty, input: value.input };
}

export function writeWorkspaceDrafts(storage, root, input, drafts, documents) {
  if (!root) return;
  if (Object.keys(drafts).some(path => !documents[path]?.hash)) throw new Error('DRAFT_BASE_MISSING');
  const files = Object.entries(drafts).filter(([path, draft]) => documents[path] && draft !== documents[path].content)
    .map(([path, draft]) => ({ draft, file: documents[path] }));
  if (!input && !files.length) storage.removeItem(keyFor(root));
  else storage.setItem(keyFor(root), JSON.stringify({ version: 1, root, input, files }));
}

export function timestampChatMessages(messages, now = new Date().toISOString()) {
  return messages.map(message => message.at ? message : { ...message, at: now });
}
