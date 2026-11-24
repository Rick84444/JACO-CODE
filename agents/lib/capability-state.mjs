// Shared reader for the existing operator capability file. No grants are
// issued here. First install defaults to on; damage after initialization
// must not silently resurrect explicitly disabled capabilities.
import fs from 'node:fs';

export const CAPABILITY_SCHEMA = 'jaco.capabilities/v1';
export const capabilityMarker = file => file + '.initialized';
const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/;
const empty = status => ({status, disabledTasks:[], disabledSkills:[], updatedAt:null});
const validIds = value => Array.isArray(value) && value.every(v => typeof v === 'string' && id.test(v));

export function readCapabilityState(file) {
  try {
    const saved = JSON.parse(fs.readFileSync(file,'utf8'));
    if (saved?.schema !== CAPABILITY_SCHEMA || !validIds(saved.disabledTasks)
        || (saved.disabledSkills !== undefined && !validIds(saved.disabledSkills))) return empty('INVALID');
    return {status:'READY', disabledTasks:[...new Set(saved.disabledTasks)],
      disabledSkills:[...new Set(saved.disabledSkills || [])], updatedAt:saved.updatedAt || null};
  } catch(error) {
    if (error?.code !== 'ENOENT') return empty('INVALID');
    // Do not interpret a failed marker lookup (permissions/I/O) as absence.
    try { fs.statSync(capabilityMarker(file)); return empty('INVALID'); }
    catch(markerError) { return empty(markerError?.code === 'ENOENT' ? 'DEFAULT' : 'INVALID'); }
  }
}

export function markCapabilityInitialized(file) {
  // A marker is not a permission store. It distinguishes deleted state from a
  // genuinely unconfigured installation. Create before replacing the policy.
  try { fs.writeFileSync(capabilityMarker(file),'initialized\n',{flag:'wx',mode:0o600}); }
  catch(error) { if (error?.code !== 'EEXIST') throw error; }
}
