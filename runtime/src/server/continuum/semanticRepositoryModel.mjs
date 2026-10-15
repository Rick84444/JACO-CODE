import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { atomicWriteJson, readJson, nowIso, sha256, canonicalJson, deepClone } from './util.mjs';

// The production server is bundled as CJS; resolve from its real filename there.
const require=createRequire(typeof __filename === 'string' ? __filename : import.meta.url);let ts=null;try{ts=require('typescript');}catch{}
const DEFAULT_EXCLUDES = new Set(['.git','node_modules','.jaco','dist','build','coverage','.next','.cache']);
const TEXT_EXTENSIONS = new Set(['.js','.mjs','.cjs','.ts','.tsx','.jsx','.json','.md','.yml','.yaml','.ps1','.sh','.cmd']);
const AST_EXTENSIONS = new Set(['.js','.mjs','.cjs','.ts','.tsx','.jsx']);
const OWNER_RULES = [
  [/gateway\/src\/workplace\//i,'Workplace'],
  [/gateway\/src\/seer/i,'SEER'],
  [/novaMissionControl/i,'Durable Nova'],
  [/src\/server\/continuum\//i,'Continuum'],
  [/src\/server\/relay\/modelRelay/i,'ModelRelay'],
  [/desktop-agentos/i,'Desktop AgentOS'],
  [/serra-desktop-agent/i,'Serra'],
  [/gateway\/src\/a2a|\/a2a/i,'A2A'],
];
const CONCEPT_RULES = [
  ['AUTH',/(auth|authorization|bearer|credential|token)/i],
  ['EVIDENCE',/(evidence|receipt|verify|verification|integrity)/i],
  ['KNOWLEDGE',/(knowledge|memory|lesson|pattern|invariant)/i],
  ['HYPOTHESIS',/(hypothesis|falsif|experiment|candidate)/i],
  ['EXECUTION',/(execute|execution|lease|scheduler|mission|commitment)/i],
  ['MODEL_ROUTING',/(modelrouter|providerregistry|provider|ollama|openai|gemini|anthropic)/i],
  ['DESKTOP',/(desktop|windows uia|remote desktop|serra)/i],
  ['WORKPLACE',/(workplace|handoff|agent registration|heartbeat)/i],
  ['SEER',/(seer|strategic|prediction|belief)/i],
  ['NOVA',/(nova|durable mission)/i],
  ['A2A',/(a2a|agent-to-agent)/i],
  ['FINANCIAL',/(economic|revenue|stripe|payment|mandate|spend|cost)/i],
  ['TEST',/(test|spec|assert|regression|fixture)/i],
  ['REPOSITORY',/(repository|dependency|import|export|symbol|semantic)/i],
];

function normalizePath(value){return String(value).replace(/\\/g,'/');}
function uniq(values){return [...new Set(values.filter(Boolean))];}
function matchAll(text,regex,index=1,limit=500){const out=[];for(const match of text.matchAll(regex)){out.push(match[index]);if(out.length>=limit)break;}return out;}
function regexImports(text){return uniq([...matchAll(text,/\bimport\s+(?:[^'"()]+?\s+from\s+)?['"]([^'"]+)['"]/g),...matchAll(text,/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g),...matchAll(text,/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)]);}
function regexSymbols(text){return uniq([...matchAll(text,/\bexport\s+(?:default\s+)?(?:async\s+)?(?:class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/g),...matchAll(text,/\bexport\s*\{\s*([^}]+)\}/g).flatMap(group=>String(group).split(',').map(x=>x.trim().split(/\s+as\s+/i).at(-1)))]).slice(0,500);}
function extractRoutes(text){const out=[];for(const match of text.matchAll(/\b(?:router|app)\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)){out.push({method:match[1].toUpperCase(),path:match[2]});if(out.length>=300)break;}return out;}
function conceptsFor(filePath,text){const hay=`${filePath}\n${text.slice(0,120000)}`;return CONCEPT_RULES.filter(([,regex])=>regex.test(hay)).map(([name])=>name);}
function ownersFor(filePath){return OWNER_RULES.filter(([regex])=>regex.test(filePath)).map(([,owner])=>owner);}
function resolveLocalImport(fromPath,specifier,fileSet){if(!specifier.startsWith('.'))return null;const base=normalizePath(path.posix.normalize(path.posix.join(path.posix.dirname(fromPath),specifier)));const candidates=[base,`${base}.js`,`${base}.mjs`,`${base}.cjs`,`${base}.ts`,`${base}.tsx`,`${base}.jsx`,`${base}/index.js`,`${base}/index.mjs`,`${base}/index.ts`,`${base}/index.tsx`];return candidates.find(candidate=>fileSet.has(candidate))||null;}
function hasModifier(node,kind){return Boolean(node.modifiers?.some(modifier=>modifier.kind===kind));}
function astAnalysis(text,filePath){
  const ext=path.extname(filePath).toLowerCase();if(!ts||!AST_EXTENSIONS.has(ext))return null;
  const scriptKind=ext==='.tsx'?ts.ScriptKind.TSX:ext==='.ts'?ts.ScriptKind.TS:ext==='.jsx'?ts.ScriptKind.JSX:ts.ScriptKind.JS;
  const source=ts.createSourceFile(filePath,text,ts.ScriptTarget.Latest,true,scriptKind);const imports=[];const symbols=[];const exports=[];
  const addName=(node,exported=false)=>{const name=node?.name?.text;if(name){symbols.push(name);if(exported)exports.push(name);}};
  for(const statement of source.statements){
    if(ts.isImportDeclaration(statement)&&ts.isStringLiteral(statement.moduleSpecifier))imports.push(statement.moduleSpecifier.text);
    if(ts.isExportDeclaration(statement)&&statement.moduleSpecifier&&ts.isStringLiteral(statement.moduleSpecifier))imports.push(statement.moduleSpecifier.text);
    const exported=hasModifier(statement,ts.SyntaxKind.ExportKeyword)||hasModifier(statement,ts.SyntaxKind.DefaultKeyword);
    if(ts.isFunctionDeclaration(statement)||ts.isClassDeclaration(statement)||ts.isInterfaceDeclaration(statement)||ts.isTypeAliasDeclaration(statement)||ts.isEnumDeclaration(statement))addName(statement,exported);
    if(ts.isVariableStatement(statement)){for(const declaration of statement.declarationList.declarations){if(ts.isIdentifier(declaration.name)){symbols.push(declaration.name.text);if(exported)exports.push(declaration.name.text);}}}
    if(ts.isExportDeclaration(statement)&&statement.exportClause&&ts.isNamedExports(statement.exportClause)){for(const element of statement.exportClause.elements)exports.push(element.name.text);}
  }
  return {parser:'typescript-ast',imports:uniq(imports),symbols:uniq(symbols).slice(0,1000),exports:uniq(exports).slice(0,500),parseDiagnostics:source.parseDiagnostics?.length||0};
}

export class SemanticRepositoryModel {
  constructor({workspaceRoot,stateRoot,events,evidence=null}){this.workspaceRoot=path.resolve(workspaceRoot);this.file=path.join(stateRoot,'semantic-repository.json');this.events=events;this.evidence=evidence;this.state=readJson(this.file,{schema:'jaco.semantic-repository.v1',status:'EMPTY',files:[],edges:[],concepts:{},owners:{},updatedAt:null});}

  scan({maxFiles=5000,maxFileBytes=768*1024,actor='repository-intelligence'}={}){
    maxFiles=Math.max(1,Math.min(20000,Number(maxFiles)||5000));maxFileBytes=Math.max(1024,Math.min(4*1024*1024,Number(maxFileBytes)||768*1024));
    const discovered=[];let candidateTextFiles=0,skippedLargeFiles=0,hitFileLimit=false;
    const walk=dir=>{
      const entries=fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name));
      for(const entry of entries){
        if(discovered.length>=maxFiles){hitFileLimit=true;return;}
        if(DEFAULT_EXCLUDES.has(entry.name))continue;
        const absolute=path.join(dir,entry.name);const relative=normalizePath(path.relative(this.workspaceRoot,absolute));
        if(entry.isDirectory()){walk(absolute);if(hitFileLimit)return;continue;}
        if(!entry.isFile()||!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))continue;
        candidateTextFiles+=1;const stat=fs.statSync(absolute);if(stat.size>maxFileBytes){skippedLargeFiles+=1;continue;}
        const text=fs.readFileSync(absolute,'utf8');const ast=astAnalysis(text,relative);const fallbackExports=regexSymbols(text);
        discovered.push({path:relative,extension:path.extname(entry.name).toLowerCase(),bytes:stat.size,sha256:sha256(text),parser:ast?.parser||'deterministic-regex-fallback',parseDiagnostics:ast?.parseDiagnostics??null,imports:uniq([...(ast?.imports||[]),...regexImports(text)]),symbols:ast?.symbols?.length?ast.symbols:fallbackExports,exports:ast?.exports?.length?ast.exports:fallbackExports,routes:extractRoutes(text),concepts:conceptsFor(relative,text),owners:ownersFor(relative),isTest:/(^|\/)(test|tests|__tests__|spec)(\/|\.)|\.(test|spec)\./i.test(relative)});
      }
    };
    walk(this.workspaceRoot);
    const fileSet=new Set(discovered.map(item=>item.path));const edges=[];for(const item of discovered){for(const specifier of item.imports){const target=resolveLocalImport(item.path,specifier,fileSet);if(target)edges.push({from:item.path,to:target,type:'IMPORTS'});}}
    edges.sort((a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to));
    const concepts={};const owners={};for(const item of discovered){for(const concept of item.concepts)(concepts[concept]??=[]).push(item.path);for(const owner of item.owners)(owners[owner]??=[]).push(item.path);}
    const astFiles=discovered.filter(item=>item.parser==='typescript-ast').length;const partial=hitFileLimit||skippedLargeFiles>0;const status=partial?'PARTIAL':'SCANNED';
    const summary={fileCount:discovered.length,candidateTextFiles,edgeCount:edges.length,testFileCount:discovered.filter(x=>x.isTest).length,conceptCount:Object.keys(concepts).length,ownerCount:Object.keys(owners).length,astFileCount:astFiles,fallbackFileCount:discovered.length-astFiles,parseDiagnosticCount:discovered.reduce((sum,item)=>sum+Number(item.parseDiagnostics||0),0),skippedLargeFiles,hitFileLimit,maxFiles,maxFileBytes,complete:!partial};
    const structural={status,limits:{maxFiles,maxFileBytes},files:discovered.map(({path,sha256,bytes,imports,symbols,exports})=>({path,sha256,bytes,imports,symbols,exports})),edges};const snapshotHash=`sha256:${sha256(canonicalJson(structural))}`;let evidenceRef=null;
    if(this.evidence){const evidence=this.evidence.record({kind:'repository-snapshot',claim:`${status==='SCANNED'?'Complete':'Partial'} deterministic repository scan captured ${summary.fileCount} files, ${summary.edgeCount} local dependency edges and ${summary.astFileCount} AST-parsed source files.`,source:'semantic-repository-model',data:{snapshotHash,status,summary},verified:true,verificationMethod:'deterministic_file_hash_ast_and_import_scan'},actor);evidenceRef=evidence.id;}
    this.state={schema:'jaco.semantic-repository.v1',status,workspaceRoot:this.workspaceRoot,snapshotHash,summary,files:discovered,edges,concepts,owners,evidenceRef,updatedAt:nowIso()};atomicWriteJson(this.file,this.state);this.events.append({stream:'repository',type:'repository.semantic_snapshot_created',actor,data:{snapshotHash,status,summary,evidenceRef}});return this.snapshot();
  }

  snapshot(){return deepClone(this.state);}
  query(input,{limit=25}={}){const terms=String(input||'').toLowerCase().split(/\s+/).filter(Boolean);if(!terms.length)return [];return this.state.files.map(file=>{const hay=JSON.stringify([file.path,file.symbols,file.exports,file.routes,file.concepts,file.owners,file.imports]).toLowerCase();const score=terms.reduce((sum,term)=>sum+(hay.includes(term)?1:0),0)+(file.concepts.some(c=>terms.includes(c.toLowerCase()))?2:0);return {score,file};}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.file.path.localeCompare(b.file.path)).slice(0,Math.min(100,Number(limit)||25)).map(x=>deepClone(x.file));}
  dependencies(filePath){const target=normalizePath(filePath);return {imports:this.state.edges.filter(edge=>edge.from===target).map(edge=>edge.to),importedBy:this.state.edges.filter(edge=>edge.to===target).map(edge=>edge.from)};}
  concept(name){return (this.state.concepts[String(name||'').toUpperCase()]||[]).map(file=>deepClone(this.state.files.find(item=>item.path===file))).filter(Boolean);}
}
