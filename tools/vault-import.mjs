// Run locally as the same OS user and JACO_STATE_DIR as Aura. Never pass credentials as arguments.
import fs from 'node:fs';
import { importVaultText } from '../agents/lib/vault-bulk-import.mjs';
const args = process.argv.slice(2);
if (!args.every(a=>a==='--dry-run') || process.stdin.isTTY) {
  console.error('Usage: node tools/vault-import.mjs [--dry-run] < /path/to/selected-file');
  process.exitCode=2;
} else {
  try {
    const chunks=[]; let size=0;
    for await (const chunk of process.stdin) {
      size+=chunk.length;
      if (size>128*1024) throw Error('VAULT_IMPORT_TOO_LARGE');
      chunks.push(chunk);
    }
    const report=importVaultText(Buffer.concat(chunks).toString('utf8'),{dryRun:args.includes('--dry-run')});
    console.log(JSON.stringify(report,null,2));
    if (report.failed.length||report.pending.length) process.exitCode=1;
  } catch { console.error('VAULT_IMPORT_FAILED'); process.exitCode=2; }
}
