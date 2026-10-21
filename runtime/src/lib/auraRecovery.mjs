// Drafts are scoped to the server's project root and the local browser profile.
// Nothing is uploaded automatically. Preserve source hashes for conflict checks.
const keyFor = root => `jaco:workspace-drafts:v1:${root}`;
const validRoot = root => typeof root === 'string' && root.length > 0 && root.length <= 2000;
const validRelativePath = path => typeof path === 'string' && path.length > 0 && path.length <= 400 &&
  !/^(?:[a-z]:|[\\/])/i.test(path) && !/(^|[\\/])\.\.?([\\/]|$)/.test(path) && !/[\x00-\x1f]/.test(path);
const MAX_ARCHIVE = 3_000_000;
const MAX_FILES = 24;

export function readWorkspaceDrafts(storage, root) {
  const empty = { input: '', documents: {}, drafts: {} };
  if (!root) return empty;
  if (!validRoot(root)) throw new Error('DRAFT_ROOT_INVALID');
  const raw = storage.getItem(keyFor(root));
  if (!raw) return empty;
  if(raw.length > MAX_ARCHIVE) throw new Error('DRAFT_ARCHIVE_TOO_LARGE');
  const value = JSON.parse(raw);
  if (value?.version !== 1 || value.root !== root || typeof value.input !== 'string' || !Array.isArray(value.files) || value.files.length > MAX_FILES) throw new Error('DRAFT_FORMAT_INVALID');
  for (const entry of value.files) {
    const file = entry?.file;
    if (!file || !validRelativePath(file.path) || typeof file.hash !== 'string' || !file.hash || typeof file.content !== 'string' || typeof entry.draft !== 'string' || file.content.length > MAX_ARCHIVE || entry.draft.length > MAX_ARCHIVE) throw new Error('DRAFT_FORMAT_INVALID');
    // Define own properties even for a file named __proto__.
    Object.defineProperty(empty.documents, file.path, { value: file, enumerable: true, writable: true, configurable: true });
    Object.defineProperty(empty.drafts, file.path, { value: entry.draft, enumerable: true, writable: true, configurable: true });
  }
  return { ...empty, input: value.input };
}

export function writeWorkspaceDrafts(storage, root, input, drafts, documents) {
  if (!root) return;
  if (!validRoot(root)) throw new Error('DRAFT_ROOT_INVALID');
  if (Object.keys(drafts).length > MAX_FILES) throw new Error('DRAFT_FILES_LIMIT');
  if (Object.keys(drafts).some(path => !validRelativePath(path) || !documents[path]?.hash)) throw new Error('DRAFT_BASE_MISSING');
  const files = Object.entries(drafts).filter(([path, draft]) => documents[path] && draft !== documents[path].content)
    .map(([path, draft]) => ({ draft, file: documents[path] }));
  if (!input && !files.length) { storage.removeItem(keyFor(root)); return; }
  const archive=JSON.stringify({ version: 1, root, input, files });
  if(archive.length > MAX_ARCHIVE) throw new Error('DRAFT_ARCHIVE_TOO_LARGE');
  storage.setItem(keyFor(root),archive);
}

export function timestampChatMessages(messages, now = new Date().toISOString()) {
  return messages.map(message => message.at ? message : { ...message, at: now });
}
