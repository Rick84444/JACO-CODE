// The browser libraries have one owner: agents/lib in the JACO repository. The package carries copies made at pack time,
// so a fix lands in JACO and in this package together and the two cannot drift.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '..', '..', '..', 'agents', 'lib');
const target = path.resolve(here, '..', 'lib');
const FILES = ['browser-input.mjs', 'browser-scope.mjs', 'browser-target-match.mjs'];

if (!fs.existsSync(source)) {
  // Installed from npm: the copies are already in lib/.
  if (FILES.every(f => fs.existsSync(path.join(target, f)))) process.exit(0);
  console.error('jaco-browser-mcp: agents/lib not found and lib/ is incomplete');
  process.exit(1);
}
fs.mkdirSync(target, { recursive: true });
for (const file of FILES) {
  const text = fs.readFileSync(path.join(source, file), 'utf8');
  fs.writeFileSync(path.join(target, file), `// Copied from agents/lib/${file} in github.com/Rick84444/JACO-CODE. Edit it there.\n${text}`);
}
console.log(`jaco-browser-mcp: synced ${FILES.length} files from agents/lib`);
