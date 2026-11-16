// Keep the runtime's public-file scan identical to the root repository CI gate.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepositorySecrets, summarizeSecretAudit } from '../../agents/lib/repo-secret-scan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const result = scanRepositorySecrets({ root });
console.log(summarizeSecretAudit(result));
if (!result.ok) process.exitCode = 1;
