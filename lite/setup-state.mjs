// Installer preferences only. Runtime policy, provider credentials and task approvals
// remain owned by their existing stores.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SETUP_SCHEMA = 'jaco.installation/v1';
export const setupFile = project => path.join(project, '.jaco', 'installation.json');

export function validateSetup(input) {
  if (input?.confirmed !== true) throw Error('SETUP_CONFIRMATION_REQUIRED');
  if (!['en', 'sv'].includes(input.language)) throw Error('SETUP_LANGUAGE_INVALID');
  for (const name of ['discoverLocal', 'connectTools', 'runAgent', 'cloudModels']) {
    if (typeof input[name] !== 'boolean') throw Error('SETUP_OPTION_INVALID:' + name);
  }
  return Object.fromEntries(['language', 'discoverLocal', 'connectTools', 'runAgent', 'cloudModels'].map(name => [name, input[name]]));
}

export function readSetup(project, fsImpl = fs) {
  try {
    const file = setupFile(project);
    if (fsImpl.lstatSync(path.dirname(file)).isSymbolicLink()) return null;
    if (fsImpl.lstatSync(file).isSymbolicLink() || fsImpl.statSync(file).size > 8192) return null;
    const state = JSON.parse(fsImpl.readFileSync(file, 'utf8'));
    if (state.schema !== SETUP_SCHEMA || !Number.isFinite(Date.parse(state.acceptedAt))) return null;
    return { schema: SETUP_SCHEMA, acceptedAt: state.acceptedAt, ...validateSetup({ ...state, confirmed: true }) };
  } catch { return null; }
}

export function saveSetup(project, input) {
  const choices = validateSetup(input);
  const root = fs.realpathSync(project);
  const directory = path.join(root, '.jaco');
  if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw Error('SETUP_PATH_UNSAFE');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = setupFile(root);
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw Error('SETUP_PATH_UNSAFE');
  const state = { schema: SETUP_SCHEMA, acceptedAt: new Date().toISOString(), ...choices };
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
  return state;
}

export function installationEnv(env, setup) {
  if (env.JACO_REQUIRE_SETUP !== '1') return { ...env };
  if (!setup) return {
    ...env, JACO_SETUP_PENDING: '1', JACO_PROVIDER_DISCOVERY: '0', JACO_AUTO_START_TOOLS: '0',
    JACO_ALLOW_PAID_MODELS: '0', JACO_CLOUD_ENABLED: 'false', JACO_CONTINUUM_AUTOSTART: '0',
  };
  return {
    ...env, JACO_SETUP_PENDING: '0',
    JACO_PROVIDER_DISCOVERY: setup.discoverLocal ? '1' : '0',
    JACO_AUTO_START_TOOLS: setup.connectTools ? '1' : '0',
  };
}
