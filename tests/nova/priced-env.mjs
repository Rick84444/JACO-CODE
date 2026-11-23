// Cost tests that are not about the price itself run with a fixed operator price and no catalog, so they do not depend on the
// prices this machine happens to have fetched.
import os from 'node:os';
import path from 'node:path';

export const PRICED_ENV = { JACO_STATE_DIR: path.join(os.tmpdir(), 'jaco-test-no-price-catalog'), JACO_AURA_DEFAULT_PRICE_JSON: '{"input":3,"output":15}' };
export const NO_PRICE_ENV = { JACO_STATE_DIR: PRICED_ENV.JACO_STATE_DIR };
Object.assign(process.env, PRICED_ENV);
