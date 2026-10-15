import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, execSync, spawn } from 'node:child_process';
import net from 'node:net';
import { processBirth } from './local-stack.mjs';
import { isPathAllowed, canListContractPath, validateCodingTask } from './coding-contract.mjs';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');

export const DEFAULT_PROTECTED_BRANCHES = ['master', 'main'];

export function createCodingWorkspace({ root = process.cwd(), protectedBranches: protectedList = (process.env.JACO_PROTECTED_BRANCHES || DEFAULT_PROTECTED_BRANCHES.join(',')).split(',') } = {}) {
  // A missing coding root (e.g. the jaco-nova worktree was deleted) used to throw at import and take
  // the whole Nova daemon down. Now only code tasks fail, with a reason the planner and operator see.
  let workspaceRoot;
  try { workspaceRoot = fs.realpathSync(path.resolve(root)); }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const missing = path.resolve(root);
    return { root: missing, missing: true, async execute() { throw new Error(`CODING_ROOT_MISSING:${missing}`); } };
  }
  const protectedBranches = new Set(protectedList.map(v => String(v).trim()).filter(Boolean));
  const resolvePath = relative => {
    const absolute = path.resolve(workspaceRoot, relative);
    if (absolute !== workspaceRoot && !absolute.startsWith(workspaceRoot + path.sep)) throw new Error('CODING_WORKSPACE_ESCAPE');
    // Lexical scope alone does not constrain junctions, symlinks or hardlinks.
    let current = workspaceRoot;
    for (const part of path.relative(workspaceRoot, absolute).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      let stat;
      try { stat = fs.lstatSync(current); } catch (error) { if (error.code === 'ENOENT') break; throw error; }
      if (stat.isSymbolicLink()) throw new Error('CODING_LINK_DENIED');
      if (stat.isFile() && stat.nlink > 1) throw new Error('CODING_HARDLINK_DENIED');
    }
    return absolute;
  };
  // Write to a temp file, fsync, re-check the path, then rename over the target.
  const atomicWrite = (relative, absolute, content) => {
    const temp = `${absolute}.${crypto.randomUUID()}.tmp`;
    let fd;
    try {
      fd = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(fd, content, 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      resolvePath(relative);
      fs.renameSync(temp, absolute);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  };
  const git = args => execFileSync('git', args, { cwd: workspaceRoot, encoding: 'utf8', windowsHide: true, timeout: 60_000 }).trim();
  const gitOptional = args => { try { return git(args); } catch { return ''; } };
  // Node's test-runner marker can suppress nested `node --test` execution entirely.
  // Verification children must run as independent processes, including inside integration tests.
  const safeEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT' && !/TOKEN|SECRET|API_KEY|PASSWORD|PRIVATE/i.test(key)));
  const serviceDir = path.join(workspaceRoot, '.jaco', 'services');
  const serviceFile = id => path.join(serviceDir, `${id}.json`);
  const readService = id => { const file=resolvePath(path.relative(workspaceRoot,serviceFile(id)));return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : null; };
  const owns = record => {
    if (!record || !Number.isInteger(record.pid) || record.pid < 1) return false;
    try { process.kill(record.pid,0); } catch { return false; }
    if (process.platform === 'win32') return Boolean(record.birth && processBirth(record.pid) === record.birth);
    // Linux process start tick prevents a reused PID from being treated as ours.
    try { return record.birth === fs.readFileSync(`/proc/${record.pid}/stat`,'utf8').split(') ')[1].split(' ')[19]; } catch { return false; }
  };
  const birth = pid => process.platform === 'win32' ? processBirth(pid) : fs.readFileSync(`/proc/${pid}/stat`,'utf8').split(') ')[1].split(' ')[19];
  const sourceFingerprint = contract => {
    const hash=crypto.createHash('sha256');let files=0,bytes=0;
    const walk=relative=>{for(const entry of fs.readdirSync(resolvePath(relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      const candidate=path.posix.join(relative,entry.name);
      if(candidate==='.jaco/services'||entry.isSymbolicLink())continue;
      if(entry.isDirectory()){if(canListContractPath(contract,candidate))walk(candidate);}
      else if(entry.isFile()&&isPathAllowed(contract,candidate)){const absolute=resolvePath(candidate),stat=fs.statSync(absolute);files++;bytes+=stat.size;if(files>2000||bytes>32*1024*1024)throw new Error('SERVICE_SOURCE_INVENTORY_LIMIT');hash.update(candidate);hash.update(fs.readFileSync(absolute));}
    }};walk('.');return hash.digest('hex');
  };
  const serviceStatus = async (record, spec) => {
    if (!owns(record)) return {ok:false,verified:false,state:'STOPPED',error:'SERVICE_PROCESS_NOT_OWNED'};
    try {
      const response = await fetch(record.url+spec.healthPath,{signal:AbortSignal.timeout(2000)});
      const body = await response.text();
      const matched = response.status === 200 && body.includes(spec.identity);
      return {ok:matched,verified:matched,state:matched?'READY':'UNHEALTHY',pid:record.pid,url:record.url,serviceId:spec.id,identity:spec.identity,status:response.status,sha256:sha(body),...(matched?{}:{error:'SERVICE_IDENTITY_MISMATCH'})};
    } catch { return {ok:false,verified:false,state:'STARTING',pid:record.pid,url:record.url,error:'SERVICE_NOT_READY'}; }
  };
  const service = async (data, contract) => {
    const spec=contract.services.find(s=>s.id===data.id);const existing=readService(data.id);
    if(!['win32','linux'].includes(process.platform))throw new Error('SERVICE_PLATFORM_UNSUPPORTED');
    if (data.action==='status') {
      if(owns(existing)&&existing.entry!==spec.entry)return {ok:false,verified:false,state:'STALE',error:'SERVICE_ENTRY_CHANGED'};
      if(owns(existing)&&existing.sourceSha256!==sourceFingerprint(contract))return {ok:false,verified:false,state:'STALE',error:'SERVICE_SOURCE_CHANGED'};
      return serviceStatus(existing,spec);
    }
    if (data.action==='stop') {
      if (!owns(existing)) return {ok:true,verified:true,state:'STOPPED',serviceId:spec.id};
      process.kill(existing.pid,'SIGTERM');
      for(let i=0;i<40;i++) {if(!owns(existing))return {ok:true,verified:true,state:'STOPPED',serviceId:spec.id,pid:existing.pid};await new Promise(r=>setTimeout(r,100));}
      return {ok:false,verified:false,state:'STOPPING',error:'SERVICE_STOP_TIMEOUT'};
    }
    const absolute=resolvePath(spec.entry);const entrySha256=sha(fs.readFileSync(absolute)),sourceSha256=sourceFingerprint(contract);
    let record=existing;
    if (owns(record) && (record.entry!==spec.entry||record.entrySha256!==entrySha256||record.sourceSha256!==sourceSha256)) throw new Error('SERVICE_SOURCE_CHANGED:stop the owned service before restarting');
    if (!owns(record)) {
      // Protect operational records against repository junctions and aliases too.
      resolvePath('.jaco/services');fs.mkdirSync(serviceDir,{recursive:true});
      const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(error=>error?reject(error):resolve(port));});});
      const childEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE)$/i.test(key)));
      Object.assign(childEnv,{PORT:String(port),HOST:'127.0.0.1',JACO_SERVICE_ID:spec.identity});
      const out=fs.openSync(resolvePath(`.jaco/services/${spec.id}.out.log`),'a'),err=fs.openSync(resolvePath(`.jaco/services/${spec.id}.err.log`),'a');
      const child=spawn(process.execPath,[absolute],{cwd:workspaceRoot,env:childEnv,windowsHide:true,detached:true,stdio:['ignore',out,err]});fs.closeSync(out);fs.closeSync(err);
      await new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',resolve);});child.unref();
      record={pid:child.pid,birth:birth(child.pid),url:`http://127.0.0.1:${port}`,entry:spec.entry,entrySha256,sourceSha256,serviceId:spec.id,createdAt:new Date().toISOString()};
      // Store ownership before readiness. Retry reuses this process after executor restart.
      atomicWrite(path.relative(workspaceRoot,serviceFile(spec.id)),serviceFile(spec.id),JSON.stringify(record));
    }
    for(let i=0;i<30;i++){const status=await serviceStatus(record,spec);if(status.state==='READY')return {...status,entrySha256,sourceSha256};if(status.state==='STOPPED')return status;await new Promise(r=>setTimeout(r,100));}
    return {ok:false,verified:false,state:'UNHEALTHY',pid:record.pid,url:record.url,error:'SERVICE_START_TIMEOUT'};
  };

  return {
    root: workspaceRoot,
    inspect(contract) {
      const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true })
        .filter(e => !e.isSymbolicLink() && (e.isDirectory() ? canListContractPath(contract, e.name) : isPathAllowed(contract, e.name)))
        .slice(0, 100).map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));
      return { root: workspaceRoot, inventoryPath: '.', entries, scope: contract.scope,
        revision: `${gitOptional(['rev-parse','HEAD']) || 'uncommitted'}:${sourceFingerprint(contract)}`,
        services: (contract.services||[]).map(s=>({ ...s, recorded:readService(s.id) })),
        pathRule: 'Use concrete directory paths for repo-list and file paths for repo-read. Never pass scope globs as filesystem paths.' };
    },
    async execute(task, contract, { actor = 'nova', receipts = [] } = {}) {
      const checked = validateCodingTask(task, contract, receipts);
      const data = checked.data || {};
      switch (checked.type) {
        case 'repo-service': return service(data,contract);
        case 'repo-list': {
          const absolute = resolvePath(data.path);
          const entries = fs.readdirSync(absolute, { withFileTypes: true })
            .filter(entry => !entry.isSymbolicLink() && (entry.isDirectory() ? canListContractPath(contract, path.posix.join(data.path, entry.name)) : isPathAllowed(contract, path.posix.join(data.path, entry.name))))
            .slice(0, 500).map(entry => ({ name: entry.name, type: entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : 'other' }));
          return { ok: true, verified: true, path: data.path, entries };
        }
        case 'repo-read': {
          const absolute = resolvePath(data.path);
          const stat = fs.statSync(absolute);
          if (!stat.isFile() || stat.size > 512_000) throw new Error('CODING_READ_FILE_INVALID');
          const content = fs.readFileSync(absolute, 'utf8');
          return { ok: true, verified: true, path: data.path, bytes: Buffer.byteLength(content), sha256: sha(content), content };
        }
        case 'repo-write': {
          const absolute = resolvePath(data.path);
          fs.mkdirSync(path.dirname(absolute), { recursive: true });
          resolvePath(data.path);
          const before = fs.existsSync(absolute) ? fs.readFileSync(absolute) : null;
          atomicWrite(data.path, absolute, data.content);
          const after = fs.readFileSync(absolute);
          return { ok: true, verified: true, path: data.path, bytes: after.length, beforeSha256: before ? sha(before) : null, afterSha256: sha(after), implementationActor: actor };
        }
        // Exact text replacement (operator 2026-10-03, as Claude's Edit tool): the planner names the text
        // to change instead of rewriting the whole file, so lines it never saw cannot be lost.
        case 'repo-edit': {
          const absolute = resolvePath(data.path);
          const stat = fs.statSync(absolute);
          if (!stat.isFile() || stat.size > 512_000) throw new Error('CODING_EDIT_FILE_INVALID');
          const before = fs.readFileSync(absolute, 'utf8');
          // Models write \n; Windows files often have \r\n. The edit keeps the file's own line endings.
          const crlf = before.includes('\r\n');
          const old = crlf && !before.includes(data.old) ? data.old.replace(/\r?\n/g, '\r\n') : data.old;
          const replacement = crlf && old !== data.old ? data.new.replace(/\r?\n/g, '\r\n') : data.new;
          const count = before.split(old).length - 1;
          if (count === 0) throw new Error('CODING_EDIT_OLD_NOT_FOUND');
          if (count > 1 && !data.replaceAll) throw new Error(`CODING_EDIT_OLD_NOT_UNIQUE:${count}`);
          const content = data.replaceAll ? before.split(old).join(replacement) : before.replace(old, () => replacement);
          atomicWrite(data.path, absolute, content);
          const after = fs.readFileSync(absolute);
          return { ok: true, verified: true, path: data.path, replacements: data.replaceAll ? count : 1, bytes: after.length, beforeSha256: sha(before), afterSha256: sha(after), implementationActor: actor };
        }
        case 'repo-test': {
          try {
            const output = execSync(data.command, { cwd: workspaceRoot, encoding: 'utf8', timeout: Math.min(Number(data.timeout || 120_000), 300_000), windowsHide: true, env: safeEnv(), stdio: ['ignore','pipe','pipe'] });
            return { ok: true, verified: true, command: data.command, kind: data.kind || 'test', output: output.slice(-20_000), verificationActor: actor };
          } catch (error) {
            return { ok: false, verified: false, command: data.command, kind: data.kind || 'test', error: error.message, stderr: String(error.stderr || '').slice(-20_000), verificationActor: actor };
          }
        }
        case 'git-status': return { ok: true, verified: true, output: git(['status','--short']) };
        case 'git-diff': return { ok: true, verified: true, output: git(['diff','--no-ext-diff','--minimal']).slice(-50_000) };
        case 'git-commit': {
          const changed = [...new Set([
            ...git(['diff','--name-only']).split(/\r?\n/),
            ...git(['diff','--cached','--name-only']).split(/\r?\n/),
            ...git(['ls-files','--others','--exclude-standard']).split(/\r?\n/),
          ].map(v => v.trim()).filter(Boolean))];
          const scoped = changed.filter(file => isPathAllowed(contract, file));
          if (!scoped.length) throw new Error('CODING_GIT_NOTHING_IN_SCOPE');
          git(['add','--',...scoped]);
          const staged = git(['diff','--cached','--name-only']).split(/\r?\n/).map(v => v.trim()).filter(Boolean);
          const commitFiles = staged.filter(file => scoped.includes(file));
          if (!commitFiles.length) throw new Error('CODING_GIT_NOTHING_STAGED_IN_SCOPE');
          execFileSync('git', ['commit','-m',data.message,'--',...commitFiles], { cwd: workspaceRoot, encoding: 'utf8', windowsHide: true, timeout: 60_000, env: safeEnv(), stdio: ['ignore','pipe','pipe'] });
          const commit = git(['rev-parse','HEAD']);
          const tree = git(['rev-parse',`${commit}^{tree}`]);
          const remainingChanges = git(['status','--short']);
          return { ok: true, verified: true, commit, tree, files: commitFiles, remainingChanges, implementationActor: actor };
        }
        case 'git-push': {
          const branch = git(['rev-parse','--abbrev-ref','HEAD']);
          if (!branch || branch === 'HEAD') throw new Error('CODING_GIT_PUSH_DETACHED_HEAD');
          // `git config` exits non-zero when the key is unset (no upstream yet).
          const remote = gitOptional(['config',`branch.${branch}.remote`]) || 'origin';
          const mergeRef = gitOptional(['config',`branch.${branch}.merge`]) || `refs/heads/${branch}`;
          const remoteBranch = mergeRef.replace(/^refs\/heads\//, '');
          // Protected branches only change through a PR with green CI (agents/nova-deliver.mjs).
          if (protectedBranches.has(branch) || protectedBranches.has(remoteBranch)) throw new Error(`CODING_GIT_PUSH_PROTECTED_BRANCH:${remoteBranch}`);
          const head = git(['rev-parse','HEAD']);
          execFileSync('git', ['push',remote,`HEAD:${remoteBranch}`], { cwd: workspaceRoot, encoding: 'utf8', windowsHide: true, timeout: 120_000, env: safeEnv(), stdio: ['ignore','pipe','pipe'] });
          const remoteLine = execFileSync('git', ['ls-remote','--heads',remote,`refs/heads/${remoteBranch}`], { cwd: workspaceRoot, encoding: 'utf8', windowsHide: true, timeout: 60_000, env: safeEnv() }).trim();
          const remoteHead = remoteLine.split(/\s+/)[0] || null;
          if (remoteHead !== head) throw new Error('CODING_GIT_PUSH_NOT_VERIFIED');
          return { ok: true, verified: true, remote, branch: remoteBranch, head, remoteHead, implementationActor: actor };
        }
        case 'git-merge': {
          const ref = data.ref;
          const current = git(['rev-parse','--abbrev-ref','HEAD']);
          if (protectedBranches.has(current)) throw new Error(`CODING_GIT_MERGE_PROTECTED_BRANCH:${current}`);
          const files = git(['diff','--name-only',`HEAD...${ref}`]).split(/\r?\n/).map(v => v.trim()).filter(Boolean);
          const denied = files.filter(file => !isPathAllowed(contract, file));
          if (denied.length) throw new Error(`CODING_GIT_MERGE_SCOPE_DENIED:${denied.slice(0,10).join(',')}`);
          const before = git(['rev-parse','HEAD']);
          try {
            execFileSync('git', ['merge','--no-edit',ref], { cwd: workspaceRoot, encoding: 'utf8', windowsHide: true, timeout: 120_000, env: safeEnv(), stdio: ['ignore','pipe','pipe'] });
          } catch (error) {
            try { execFileSync('git', ['merge','--abort'], { cwd: workspaceRoot, encoding: 'utf8', windowsHide: true, timeout: 30_000, env: safeEnv(), stdio: ['ignore','pipe','pipe'] }); } catch {}
            throw error;
          }
          const head = git(['rev-parse','HEAD']);
          return { ok: true, verified: true, ref, before, head, files, changed: before !== head, implementationActor: actor };
        }
        default: throw new Error(`CODING_TASK_UNSUPPORTED:${checked.type}`);
      }
    },
  };
}

