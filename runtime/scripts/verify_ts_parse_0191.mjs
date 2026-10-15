import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
let ts;
try { ts = await import('typescript'); } catch {
  const candidate=path.resolve(path.dirname(process.execPath),'..','lib','node_modules','typescript','lib','typescript.js');
  if (!fs.existsSync(candidate)) throw new Error('TypeScript parser unavailable: install dependencies first');
  ts = await import(pathToFileURL(candidate).href);
}
const T=ts.default||ts;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const skip=new Set(['node_modules','dist','.git']); const files=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(skip.has(e.name))continue;const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(/\.(ts|tsx)$/.test(e.name))files.push(p)}}
walk(root); let bad=0;
for(const f of files){const text=fs.readFileSync(f,'utf8');const kind=f.endsWith('.tsx')?T.ScriptKind.TSX:T.ScriptKind.TS;const sf=T.createSourceFile(f,text,T.ScriptTarget.ESNext,true,kind);if(sf.parseDiagnostics.length){bad++;console.error('FAIL',path.relative(root,f),sf.parseDiagnostics.map(d=>d.messageText).join(' | '));}}
console.log(`ts-parse-0191: ${bad?'FAIL':'PASS'} (${files.length-bad}/${files.length})`);if(bad)process.exit(1);
