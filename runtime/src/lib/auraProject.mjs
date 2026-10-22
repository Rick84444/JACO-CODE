// Helpers for validating, labelling and switching the IDE project root.

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/;
const NUL = '\0';

export function isAbsoluteProjectPath(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (value.includes(NUL)) return false;
  if (WINDOWS_DRIVE_PATH.test(trimmed)) return true;
  if (trimmed.startsWith('\\\\')) return true;
  if (trimmed.startsWith('/')) return true;
  return false;
}

export function projectLabel(root) {
  if (typeof root !== 'string') return 'No project';
  const segments = root.split(/[\\/]+/).filter(segment => segment.length > 0);
  if (!segments.length) return 'No project';
  return segments[segments.length - 1];
}

export function canSwitchProject(drafts, documents = null) {
  if (drafts === null || typeof drafts !== 'object' || Array.isArray(drafts)) return false;
  if (!documents) return Object.keys(drafts).length === 0;
  return Object.entries(drafts).every(([path, draft]) =>
    Object.prototype.hasOwnProperty.call(documents, path) &&
    documents[path]?.content === draft);
}
