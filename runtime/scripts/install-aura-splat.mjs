// Explicit opt-in; never run from startup or CI. The supplied head must be rights-cleared.
import {spawnSync} from 'node:child_process';
import {cpSync,copyFileSync,existsSync,mkdtempSync,renameSync,rmSync,statSync,readSync,openSync,closeSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const REV='54dcccf96f3d73aa58474c51c3417bae484e577c';
const args=process.argv.slice(2);
if(args.length!==4 || args[0]!=='--head' || args[2]!=='--license') {
  console.error('Usage: node runtime/scripts/install-aura-splat.mjs --head /path/to/authorized-head.zip --license /path/to/rights-notice.txt');
  process.exit(2);
}
const head=resolve(args[1]), notice=resolve(args[3]);
const runtime=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const target=join(runtime,'public','aura-splat');
if(existsSync(target)) throw new Error('Already installed. Remove the existing local aura-splat directory explicitly before reinstalling.');
const size=statSync(head).size;
if(!statSync(head).isFile() || size<4 || size>256*1024*1024) throw new Error('Invalid head ZIP size');
const magic=Buffer.alloc(4),fd=openSync(head,'r');
try{readSync(fd,magic,0,4,0);}finally{closeSync(fd);}
if(!magic.equals(Buffer.from([0x50,0x4b,0x03,0x04]))) throw new Error('Expected a compatible nonempty ZIP, not a photograph.');
if(!statSync(notice).isFile() || statSync(notice).size<1 || statSync(notice).size>1024*1024) throw new Error('Missing local rights notice.');
// The notice is provided by the operator. This script cannot independently verify its legal validity.
const scratch=mkdtempSync(join(tmpdir(),'jaco-avatarz-'));
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
  npmRun(['ci','--ignore-scripts','--no-audit','--no-fund']);
  npmRun(['exec','--offline','--','vite','build','--config','vite.browser.config.ts']);
  const build=join(scratch,'dist-browser');
  if(!existsSync(join(build,'avatarz.js'))) throw new Error('Avatarz browser build missing');
  stage=mkdtempSync(join(runtime,'.aura-splat-stage-'));
  cpSync(build,stage,{recursive:true});
  copyFileSync(head,join(stage,'head.zip'));
  copyFileSync(notice,join(stage,'HEAD-LICENSE.txt'));
  copyFileSync(join(scratch,'LICENSE'),join(stage,'AVATARZ-LICENSE.txt'));
  copyFileSync(join(scratch,'package-lock.json'),join(stage,'upstream-package-lock.json'));
  cpSync(join(scratch,'LICENSES'),join(stage,'LICENSES'),{recursive:true});
  writeFileSync(join(stage,'PROVENANCE.txt'),'Avatarz source: '+REV+'\nOperator supplied head; redistribution rights and dependency notices must be independently reviewed.\n');
  renameSync(stage,target);stage=undefined;
  console.log('Local experimental bundle installed. Rebuild the runtime client if using a production build. Actual renderer and device validation still required.');
} finally {
  if(stage)rmSync(stage,{recursive:true,force:true});
  rmSync(scratch,{recursive:true,force:true});
}
