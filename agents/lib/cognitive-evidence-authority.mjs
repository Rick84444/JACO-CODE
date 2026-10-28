/**
 * Cognitive Lab review attestation. The controller, not a model, runs the reviewer
 * child and signs the complete machine-observed result. A process with arbitrary
 * filesystem access to the same UID can still forge the key: OS isolation is
 * needed for a production verifier. This is an explicit scoped LAB contract.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const sha256 = data => createHash('sha256').update(data).digest('hex');
const KEY_NAME = '.review-authority.key';
const SCHEMA = 'jaco.cognitive-review-attestation/v1';
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
const canonical = value => JSON.stringify(sorted(value));
const validHex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function authorityKey(root, {create = false} = {}) {
  const file = path.join(root, KEY_NAME);
  try {
    const fd = fs.openSync(file, create ? 'wx' : 'r', 0o600);
    try { if (create) fs.writeSync(fd, randomBytes(32)); }
    finally { fs.closeSync(fd); }
  } catch (error) {
    if (!(create && error.code === 'EEXIST')) throw error;
  }
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || st.size !== 32 || (st.mode & 0o077) !== 0)
    throw new Error('REVIEW_AUTHORITY_KEY_UNSAFE');
  return fs.readFileSync(file);
}

/** Call only from the controller after an actual isolated reviewer process exits. */
export function attestReview(root, {runId, candidate, report, exitCode, stdout, stderr, harnessHash, reviewerFingerprint}) {
  if (typeof runId !== 'string' || !/^[0-9a-f-]{36}$/.test(runId) || !['baseline','hardened'].includes(candidate)) throw new Error('ATTEST_SCOPE_INVALID');
  if (!validHex(harnessHash) || !validHex(reviewerFingerprint) || !validHex(report?.codeHash)) throw new Error('ATTEST_HASH_INVALID');
  if (![0,2].includes(exitCode) || !Array.isArray(report.cases) || report.total !== 8 || report.cases.length !== 8 ||
      report.passed !== report.cases.filter(c => c.passed === true).length || report.accepted !== (report.passed === 8) ||
      (exitCode === 0) !== report.accepted || report.candidate !== candidate)
    throw new Error('ATTEST_REVIEW_NOT_OBSERVED');
  const payload = {schema: SCHEMA, missionId: runId, reviewerAgentId: 'reviewer-agent', reviewerFingerprint,
    candidate, codeHash: report.codeHash, harnessHash, exitCode,
    stdoutHash: sha256(stdout), stderrHash: sha256(stderr), reportHash: sha256(canonical(report)),
    accepted: report.accepted, passed: report.passed, total: report.total};
  const mac = createHmac('sha256', authorityKey(root,{create:true})).update(canonical(payload)).digest('hex');
  return {...payload, mac};
}

export function validateReviewAttestation(root, {runId, candidate, report, attestation, reviewerFingerprint}) {
  if (!attestation || attestation.schema !== SCHEMA || !validHex(attestation.mac)) return false;
  const {mac,...payload} = attestation;
  if (payload.missionId !== runId || payload.candidate !== candidate || payload.codeHash !== report.codeHash ||
      payload.reviewerFingerprint !== reviewerFingerprint || payload.reviewerAgentId !== 'reviewer-agent' ||
      payload.reportHash !== sha256(canonical(report)) || payload.accepted !== true ||
      report.accepted !== true || report.passed !== 8 || report.total !== 8 || payload.exitCode !== 0 ||
      !validHex(payload.harnessHash)) return false;
  try {
    const expected = createHmac('sha256', authorityKey(root)).update(canonical(payload)).digest();
    return timingSafeEqual(expected, Buffer.from(mac, 'hex'));
  } catch { return false; }
}
