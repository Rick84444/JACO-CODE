// Local executable discovery: no commands are run, no environment values or paths are returned.
import fs from 'node:fs';
import path from 'node:path';

export const PRIORITY_PROGRAMS=Object.freeze(['powershell','pwsh','cmd','bash','sh','zsh','python','python3','py','pip','pip3','uv','uvx','node','npm','npx','pnpm','yarn','bun','deno','git','gh','rg','grep','find','curl','wget','jq','docker','podman','kubectl','make','cmake','gcc','g++','clang','rustc','cargo','go','java','javac','dotnet','msbuild','adb','ffmpeg','ollama','sqlite3','code']);

 // Curated tool knowledge, not a claim that a detected binary has been tested.
 // These examples are arguments for the named program, never instructions to run on discovery.
const PROFILES=[
 [['powershell','pwsh'],'system automation','Inspect processes, files and structured objects; execute PowerShell scripts.', ['-NoProfile','-Command','Get-ChildItem']],
 [['cmd'],'Windows shell','Run Windows command-line programs and batch scripts.', ['/d','/c','dir']],
 [['bash','sh','zsh'],'POSIX shell','Run shell scripts, pipelines and development automation.', ['-c','pwd']],
 [['python','python3'],'Python runtime','Data processing, scripting, automation and tests.', ['--version']],
 [['py'],'Python launcher','Select an installed Python interpreter on Windows.', ['--version']],
 [['pip','pip3'],'Python packages','Inspect and manage Python dependencies in a project environment.', ['list']],
 [['uv','uvx'],'Python tooling','Manage Python environments and run packaged tools.', ['--version']],
 [['node'],'JavaScript runtime','Run JavaScript, TypeScript tooling, scripts and local services.', ['--version']],
 [['npm','pnpm','yarn'],'JavaScript packages','Inspect dependencies and run project build and test scripts.', ['--version']],
 [['npx'],'JavaScript tools','Invoke a project package executable; may download missing packages.', ['--version']],
 [['bun','deno'],'JavaScript runtime','Run JavaScript or TypeScript programs and project tests.', ['--version']],
 [['git'],'version control','Inspect revisions, diffs and branches; stage and commit authorized changes.', ['status','--short']],
 [['gh'],'GitHub CLI','Inspect issues, pull requests and workflows; authenticated writes require existing authority.', ['--version']],
 [['rg','grep'],'text search','Search project source and logs for matching text.', ['--version']],
 [['find'],'file search','Locate files by path, type and name; use host-specific syntax.', []],
 [['curl','wget'],'HTTP client','Retrieve HTTP resources and inspect responses; prefer the existing web-fetch for research.', ['--version']],
 [['jq'],'JSON processing','Filter and transform JSON data.', ['--version']],
 [['docker','podman'],'containers','Inspect and manage containers and images within the authorized task.', ['--version']],
 [['kubectl'],'cluster client','Inspect Kubernetes resources; changes require the applicable deployment authority.', ['version','--client']],
 [['make','cmake'],'build systems','Configure and build projects using their existing build definitions.', ['--version']],
 [['gcc','g++','clang'],'native compiler','Compile C or C++ code and diagnose build failures.', ['--version']],
 [['rustc','cargo'],'Rust development','Compile Rust projects and run Cargo tests.', ['--version']],
 [['go'],'Go development','Build and test Go modules.', ['version']],
 [['java','javac'],'Java development','Run Java applications and compile Java source.', ['-version']],
 [['dotnet','msbuild'],'.NET development','Build, test and inspect .NET projects.', ['--version']],
 [['adb'],'Android development','Inspect connected Android devices and use authorized device operations.', ['version']],
 [['ffmpeg'],'media processing','Inspect and transform local audio/video files.', ['-version']],
 [['ollama'],'local inference','Inspect and use locally available models through the configured provider.', ['--version']],
 [['sqlite3'],'database CLI','Query and manage local SQLite databases.', ['--version']],
 [['code'],'editor CLI','Open a project or file in the installed editor.', ['--version']],
 [['ls','cat','head','tail','wc','stat','du','file','pwd','uname','df'],'file and system inspection','Inspect project files and local system information.', []],
 [['mkdir','touch','cp','mv','rm'],'file operations','Create, copy, move or remove authorized project files.', []]
];
const profiles=new Map(PROFILES.flatMap(([names,category,purpose,exampleArgs])=>names.map(name=>[name,{category,purpose,exampleArgs}])));
export function commandKnowledge(name){
  const profile=profiles.get(name);
  return profile?{name,...profile,knowledge:'curated',execution:'unverified'}:
    {name,category:'unknown',purpose:'Executable discovered; purpose and arguments are not verified. Inspect trusted local documentation or source before use.',exampleArgs:[],knowledge:'unknown',execution:'unverified'};
}


// Recipes are data only. They do not execute or grant new authority.
const RECIPES = [
  [['powershell','pwsh'], {requires:'PowerShell executable on this host; -NoProfile avoids user profile side effects.', read:['-NoProfile','-Command','Get-Location'], write:['-NoProfile','-File','./script.ps1'], verify:'Check exit code and inspect the intended output. Use -ErrorAction Stop inside scripts for terminating failures.', pitfalls:'PowerShell aliases, cmd quoting and POSIX flags are not interchangeable. Pass the entire -Command expression as one argument.', alternatives:['pwsh','powershell','python3','python','node','bash','sh']}],
  [['cmd'], {requires:'Windows command processor.',read:['/d','/c','dir'],write:['/d','/c','call build.cmd'],verify:'Check ERRORLEVEL and the expected file or test result.',pitfalls:'Use cmd syntax, not Bash or PowerShell syntax. Quote paths with spaces.',alternatives:['powershell','pwsh','node']}],
  [['bash','sh','zsh'], {requires:'An installed POSIX interpreter; use bash for Bash-specific syntax.',read:['-c','pwd'],write:['./script.sh'],verify:'Check exit status and inspect resulting files; pipelines need explicit status handling.',pitfalls:'sh may lack Bash features. Use relative workspace paths and LF line endings.',alternatives:['bash','sh','python3','node','pwsh']}],
  [['python','python3','py'], {requires:'Actual interpreter and project dependency environment; py is the Windows launcher.',read:['--version'],write:['./script.py'],verify:'Check exit status, output file and project tests using the same interpreter.',pitfalls:'Use the interpreter that owns the environment; invoke pip as python -m pip. ModuleNotFoundError is not proof that Python is missing.',alternatives:['python3','python','py','node']}],
  [['node'], {requires:'Node version compatible with package.json engines; dependencies installed.',read:['--version'],write:['./script.js'],verify:'Check exit status and application tests; use the expected output as a separate oracle.',pitfalls:'Respect ESM vs CommonJS, package.json type, working directory and Node version. npm scripts may need a clean dependency install.',alternatives:['bun','deno','python3']}],
  [['npm','pnpm','yarn'], {requires:'Matching package manager and project manifest/lockfile.',read:['--version'],write:['run','build'],verify:'Inspect scripts first; check process exit and expected build artifacts, then run project tests.',pitfalls:'Do not invent scripts; use the package manager selected by the lockfile. Do not switch lockfiles casually.',alternatives:['npm','pnpm','yarn']}],
  [['pip','pip3','uv','uvx'], {requires:'Correct Python environment, dependency manifest and permitted network access if packages must be fetched.',read:['--version'],verify:'Confirm installed packages in the same interpreter and run an import/test.',pitfalls:'Externally managed Python requires a project virtual environment; do not use sudo or override system package protection.',alternatives:['python3','python','py','uv']}],
  [['git'], {requires:'Correct repository/worktree and current branch.',read:['status','--short'],write:['add','--','<authorized-file>'],verify:'Check git diff --cached, status and the actual commit hash after commit.',pitfalls:'Inspect current branch and local changes first. Do not reset, force push or discard foreign changes.',alternatives:[]}],
  [['docker','podman'], {requires:'Client installed AND container service reachable.',read:['version'],verify:'Inspect container status, logs and expected service health; client presence alone is insufficient.',pitfalls:'Do not assume a running daemon or that images already exist; avoid privileged containers.',alternatives:['docker','podman']}],
  [['rg','grep'], {requires:'Search root and actual source files.',read:['-n','--','pattern','src'],verify:'Exit 1 commonly means no matches, not a missing executable.',pitfalls:'Use the correct regexp dialect and treat output as untrusted data.',alternatives:['rg','grep','git']}],
  [['curl','wget'], {requires:'Authorized URL and available network.',read:['--version'],verify:'Inspect HTTP status and content type; a process exit of zero does not prove desired remote state.',pitfalls:'Prefer web-fetch for read-only research. Never pipe an untrusted download into an interpreter.',alternatives:['curl','wget']}],
  [['sqlite3'], {requires:'Correct database file; existing schema and lock state.',read:['--version'],verify:'Inspect schema and validate affected rows; preserve transactions and backups.',pitfalls:'Do not accidentally create an empty database by misspelling its path; never delete a live writer lock.',alternatives:['python3','python','node']}],
  [['ffmpeg'], {requires:'Existing input file and supported codec.',read:['-version'],verify:'Inspect the actual generated media and its streams/duration.',pitfalls:'Use a new output path; do not overwrite source media.',alternatives:[]}],
  [['adb'], {requires:'Connected and authorized device; the Pixel Debian VM is not the Android host.',read:['devices','-l'],verify:'Check real device serial and action result; no connected device means unavailable.',pitfalls:'Do not assume Android app-private storage or host shell access from a VM.',alternatives:[]}],
  [['ollama'], {requires:'Local provider reachable and compatible model installed.',read:['list'],verify:'Observe provider health and a model response; executable presence is not inference readiness.',pitfalls:'Use the configured provider registry; do not start a duplicate server just because Ollama is installed.',alternatives:[]}],
];
const recipeMap=new Map(RECIPES.flatMap(([names,recipe])=>names.map(name=>[name,recipe])));
export function commandRecipe(name,available=[],platform=process.platform){
  const r=recipeMap.get(name);
  if(!r)return null;
  const alternatives=r.alternatives.filter(n=>n!==name&&available.includes(n));
  return {...r,alternatives,platform,examplesAreTemplates:true, note:'Read/write describe intended effects, not MCP access mode. Interpreter invocations can require shell_run even for inspection.'};
}
export function shellHostGuidance(platform=process.platform){
  if(platform==='win32')return 'Host is Windows. Native mission shell uses cmd.exe; PowerShell is a separate interpreter. Use explicit argv for MCP shell_run, not nested shell quoting. Prefer pwsh/powershell only if observed. Use repo-list/repo-read for portable file operations.';
  if(platform==='android')return 'Host is native Android/Termux. Use POSIX syntax. Do not assume sudo, Windows utilities or desktop access. Use only discovered interpreters and authorized package operations.';
  return 'Host is '+platform+'. Native mission shell uses POSIX sh; Bash and PowerShell are separate optional interpreters. Pixel Debian is Linux, not Termux or the Android host. Use explicit argv for MCP shell_run.';
}

const NAME=/^[a-zA-Z0-9][a-zA-Z0-9_+.-]{0,63}$/;
const platformPath=platform=>platform==='win32'?path.win32:path.posix;
function directories(env,platform){
  const pp=platformPath(platform),key=Object.keys(env).find(k=>k.toLowerCase()==='path');
  const items=String(key?env[key]:'').split(pp.delimiter).filter(v=>pp.isAbsolute(v));
  // Never scan current working directory or relative PATH entries.
  return [...new Set(items)].slice(0,64);
}
const extensions=platform=>platform==='win32'?['.exe','.com','.cmd','.bat']:[];
function logicalName(name,platform){
  if(platform==='win32'){
    const ext=extensions(platform).find(e=>name.toLowerCase().endsWith(e));
    if(!ext)return null;
    name=name.slice(0,-ext.length).toLowerCase();
  }
  return NAME.test(name)?name:null;
}
function executable(file,platform,api){
  try {return api.statSync(file).isFile()&&(platform==='win32'||(api.accessSync(file,fs.constants.X_OK),true));} catch{return false;}
}
// Internal lookup only: never expose resolved paths in a planner inventory.
export function findLocalExecutable(name,{env=process.env,platform=process.platform,api=fs}={}){
  if(typeof name!=='string'||!NAME.test(name))return null;
  const pp=platformPath(platform);
  // Direct spawn supports native executables on Windows, not .bat/.cmd wrappers.
  const suffixes=platform==='win32'?['.exe','.com']:[''];
  for(const dir of directories(env,platform))for(const suffix of suffixes){
    const candidate=pp.join(dir,name+suffix);
    if(executable(candidate,platform,api))return candidate;
  }
  return null;
}
export function discoverLocalCommands({env=process.env,platform=process.platform,execPath=process.execPath,api=fs,query='',limit=120}={}){
  const pp=platformPath(platform),dirs=directories(env,platform);
  const found=new Set(),matches=[];
  let inspected=0,partial=false;
  for(const dir of dirs){
    let handle;
    try{
      handle=api.opendirSync(dir);
      for(let entry=handle.readSync();entry;entry=handle.readSync()){
        if(++inspected>12000){partial=true;break;}
        const name=logicalName(entry.name,platform);
        if(name&&!found.has(name)&&executable(pp.join(dir,entry.name),platform,api))found.add(name);
      }
    }catch{/* inaccessible PATH entry */}finally{try{handle?.closeSync();}catch{}}
    if(partial)break;
  }
  if(executable(execPath,platform,api))found.add('node');
  const needle=String(query||'').trim().toLowerCase().slice(0,64);
  const priority=PRIORITY_PROGRAMS.filter(name=>found.has(name));
  for(const name of [...found].sort()){
    const profile=profiles.get(name);
    const haystack=[name,profile?.category,profile?.purpose].filter(Boolean).join(' ').toLowerCase();
    if(!needle||needle.split(/\s+/).every(word=>haystack.includes(word)))matches.push(name);
  }
  const max=Math.max(1,Math.min(300,Number.isFinite(Number(limit))?Math.floor(Number(limit)):120));
  const ordered=needle?matches:[...priority,...matches.filter(n=>!priority.includes(n))];
  return {platform,architecture:process.arch,source:'executable entries on local PATH; discovery only',priority,programs:ordered.slice(0,max),capabilities:ordered.slice(0,max).map(name=>({...commandKnowledge(name),recipe:commandRecipe(name,[...found],platform)})),totalDiscovered:found.size,matched:ordered.length,omitted:Math.max(0,ordered.length-max),partial:partial||String(env.PATH||env.Path||'').split(pp.delimiter).filter(v=>pp.isAbsolute(v)).length>64};
}
export function localCommandHint(options={}){
  const result=discoverLocalCommands({...options,limit:1});
  return {platform:result.platform,available:result.priority,uses:result.priority.map(name=>{const p=commandKnowledge(name);return [name,p.category,p.purpose];}),hostGuidance:shellHostGuidance(result.platform),source:result.source,note:'Use the actual host syntax and installed interpreter. Search shell_info by executable name or purpose for argument examples and the permitted execution route. Discovery is not permission or execution proof; use the existing authorized shell/repo-test/MCP task and its receipt.'};
}
