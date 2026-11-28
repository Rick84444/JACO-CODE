// Explicit opt-in; never run from startup or CI. The supplied head is a likeness of a real person and must be
// rights-cleared. It is installed OUTSIDE public/ (runtime/local/aura-splat) and served only to the local operator.
import {spawnSync} from 'node:child_process';
import {cpSync,copyFileSync,existsSync,mkdirSync,mkdtempSync,renameSync,rmSync,statSync,readSync,readFileSync,openSync,closeSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AURA_SPLAT_USAGE,AURA_SPLAT_CONFIRM_FLAG,auraSplatDir,parseInstallArgs,provenanceText,sha256File,validateHeadZipHeader,validateRightsNotice} from '../src/lib/auraSplatInstall.mjs';
const REV='54dcccf96f3d73aa58474c51c3417bae484e577c';
let parsed;
try { parsed=parseInstallArgs(process.argv.slice(2)); }
catch(error) {
  console.error(error.message==='AURA_SPLAT_RIGHTS_CONFIRMATION_REQUIRED'
    ? 'Refusing to install: a photoreal head is a real person\'s likeness. Pass '+AURA_SPLAT_CONFIRM_FLAG+' only if you hold the rights to use it.\n'+AURA_SPLAT_USAGE
    : AURA_SPLAT_USAGE);
  process.exit(2);
}
const head=resolve(parsed.head), notice=resolve(parsed.notice);
const runtime=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const target=auraSplatDir(runtime);
if(existsSync(target)) throw new Error('Already installed. Remove the existing local aura-splat directory explicitly before reinstalling.');
if(!statSync(head).isFile()) throw new Error('Invalid head ZIP');
const magic=Buffer.alloc(4),fd=openSync(head,'r');
try{readSync(fd,magic,0,4,0);}finally{closeSync(fd);}
validateHeadZipHeader(magic,statSync(head).size);
if(!statSync(notice).isFile()) throw new Error('Missing local rights notice.');
// The notice is provided by the operator. This script checks that it is real text, not that it is legally valid.
validateRightsNotice(readFileSync(notice));
const headSha256=await sha256File(head), noticeSha256=await sha256File(notice);
const scratch=mkdtempSync(join(tmpdir(),'jaco-avatarz-'));
mkdirSync(dirname(target),{recursive:true,mode:0o700});
let stage;
function run(command,argv,cwd){
  const result=spawnSync(command,argv,{cwd,stdio:'inherit',shell:false});
  if(result.error || result.status!==0) throw new Error(command+' failed: '+(result.error?.message??result.status));
}
try {
  run('git',['init'],scratch);
  run('git',['fetch','--depth=1','https://github.com/payner35/avatarz.git',REV],scratch);
  run('git',['checkout','--detach','FETCH_HEAD'],scratch);
  const check=spawnSync('git',['rev-parse','HEAD'],{cwd:scratch,encoding:'utf8'});
  if(check.status!==0 || check.stdout.trim()!==REV) throw new Error('Upstream revision mismatch');
  // Invoke npm through the actual npm CLI on Windows when running from npm; otherwise use the
  // explicit cmd launcher with static arguments only (no operator-provided values enter the shell).
  const npm=process.platform==='win32'?'npm.cmd':'npm';
  function npmRun(argv){
    if(process.platform==='win32') {
      const result=spawnSync('cmd.exe',['/d','/s','/c',npm,...argv],{cwd:scratch,stdio:'inherit'});
      if(result.error || result.status!==0) throw new Error('npm failed');
    } else run(npm,argv,scratch);
  }
  // `--ignore-scripts` stops dependency install scripts; the build below still runs the upstream project's own
  // Vite configuration and plugins from this pinned revision, which no one has reviewed on the operator's behalf.
  npmRun(['ci','--ignore-scripts','--no-audit','--no-fund']);
  npmRun(['exec','--offline','--','vite','build','--config','vite.browser.config.ts']);
  const build=join(scratch,'dist-browser');
  if(!existsSync(join(build,'avatarz.js'))) throw new Error('Avatarz browser build missing');
  // Staged next to the target so the final rename stays on one filesystem and is atomic.
  stage=mkdtempSync(join(dirname(target),'.stage-'));
  cpSync(build,stage,{recursive:true});
  copyFileSync(head,join(stage,'head.zip'));
  copyFileSync(notice,join(stage,'HEAD-LICENSE.txt'));
  copyFileSync(join(scratch,'LICENSE'),join(stage,'AVATARZ-LICENSE.txt'));
  copyFileSync(join(scratch,'package-lock.json'),join(stage,'upstream-package-lock.json'));
  cpSync(join(scratch,'LICENSES'),join(stage,'LICENSES'),{recursive:true});
  writeFileSync(join(stage,'PROVENANCE.txt'),provenanceText({rev:REV,headSha256,noticeSha256,at:new Date().toISOString()}));
  renameSync(stage,target);stage=undefined;
  console.log('Local experimental bundle installed at '+target+'.');
  console.log('It is served only to the local operator UI at /aura-splat (not to remote IDE sessions, proxies or other hosts) and is never committed or part of the client build.');
  console.log('Actual renderer and device validation still required.');
} finally {
  if(stage)rmSync(stage,{recursive:true,force:true});
  rmSync(scratch,{recursive:true,force:true});
}
