// Local executable discovery: no commands are run, no environment values or paths are returned.
import fs from 'node:fs';
import path from 'node:path';

export const PRIORITY_PROGRAMS=Object.freeze(['powershell','pwsh','cmd','bash','sh','zsh','python','python3','py','pip','pip3','uv','uvx','node','npm','npx','pnpm','yarn','bun','deno','git','gh','rg','grep','find','curl','wget','jq','docker','podman','kubectl','make','cmake','gcc','g++','clang','rustc','cargo','go','java','javac','dotnet','msbuild','adb','ffmpeg','ollama','sqlite3','code']);
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
  for(const name of [...found].sort())if(!needle||name.toLowerCase().includes(needle))matches.push(name);
  const max=Math.max(1,Math.min(300,Number.isFinite(Number(limit))?Math.floor(Number(limit)):120));
  const ordered=needle?matches:[...priority,...matches.filter(n=>!priority.includes(n))];
  return {platform,architecture:process.arch,source:'executable entries on local PATH; discovery only',priority,programs:ordered.slice(0,max),totalDiscovered:found.size,matched:ordered.length,omitted:Math.max(0,ordered.length-max),partial:partial||String(env.PATH||env.Path||'').split(pp.delimiter).filter(v=>pp.isAbsolute(v)).length>64};
}
export function localCommandHint(options={}){
  const result=discoverLocalCommands({...options,limit:1});
  return {platform:result.platform,available:result.priority,source:result.source,note:'Use the actual host syntax and installed interpreter. Other commands can be searched using shell_info with query. Discovery is not permission or execution proof; use the existing authorized shell/repo-test/MCP task and its receipt.'};
}
