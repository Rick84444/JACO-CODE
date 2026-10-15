import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  path.join(root, 'src/server/state/memoryStoreV2.ts'),
  path.join(root, 'src/server/plan/planDb.ts'),
];
let passed = 0;
function ok(condition, label) {
  if (!condition) throw new Error(`FAIL ${label}`);
  console.log(`PASS ${label}`);
  passed++;
}
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  ok(!/createRequire\s*\(\s*import\.meta\.url/.test(text), `${path.basename(file)} avoids import.meta createRequire`);
  ok(text.includes("node:sqlite"), `${path.basename(file)} includes node:sqlite backend`);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-sqlite-cjs-'));
const dbPath = path.join(dir, 'runtime.sqlite');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE memory_nodes(id TEXT PRIMARY KEY, content TEXT NOT NULL); CREATE TABLE plans(id TEXT PRIMARY KEY, data TEXT NOT NULL);');
db.prepare('INSERT INTO memory_nodes(id,content) VALUES (?,?)').run('m1','persisted');
db.prepare('INSERT INTO plans(id,data) VALUES (?,?)').run('p1','{"status":"active"}');
ok(db.prepare('SELECT content FROM memory_nodes WHERE id=?').get('m1')?.content === 'persisted', 'node:sqlite memory write/read');
ok(db.prepare('SELECT data FROM plans WHERE id=?').get('p1')?.data === '{"status":"active"}', 'node:sqlite plan write/read');
db.close();
const reopened = new DatabaseSync(dbPath);
ok(reopened.prepare('SELECT content FROM memory_nodes WHERE id=?').get('m1')?.content === 'persisted', 'node:sqlite survives reopen');
reopened.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`sqlite-cjs-0191: PASS (${passed}/7)`);
