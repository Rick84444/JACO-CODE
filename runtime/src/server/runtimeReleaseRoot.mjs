import path from 'node:path';

// Frontend identity belongs to the installed runtime, never the launch directory.
export function runtimeReleaseRoot({ override, moduleFile }) {
  if (override) return path.resolve(override);
  const directory = path.dirname(moduleFile);
  return path.basename(directory) === 'dist' ? path.dirname(directory) : directory;
}
