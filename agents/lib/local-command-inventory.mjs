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
  return {platform,architecture:process.arch,source:'executable entries on local PATH; discovery only',priority,programs:ordered.slice(0,max),capabilities:ordered.slice(0,max).map(commandKnowledge),totalDiscovered:found.size,matched:ordered.length,omitted:Math.max(0,ordered.length-max),partial:partial||String(env.PATH||env.Path||'').split(pp.delimiter).filter(v=>pp.isAbsolute(v)).length>64};
}
export function localCommandHint(options={}){
  const result=discoverLocalCommands({...options,limit:1});
  return {platform:result.platform,available:result.priority,uses:result.priority.map(name=>{const p=commandKnowledge(name);return [name,p.category,p.purpose];}),source:result.source,note:'Use the actual host syntax and installed interpreter. Search shell_info by executable name or purpose for argument examples and the permitted execution route. Discovery is not permission or execution proof; use the existing authorized shell/repo-test/MCP task and its receipt.'};
}
