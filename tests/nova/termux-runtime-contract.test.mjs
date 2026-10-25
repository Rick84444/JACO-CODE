import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const runtime=path.join(root,'runtime');

test('Termux build avoids native server bundling while desktop keeps esbuild',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(runtime,'package.json'),'utf8'));
  assert.equal(pkg.scripts['build:client'],'vite build');
  assert.match(pkg.scripts['build:server'],/^esbuild server\.ts /);
  assert.equal(pkg.scripts['build'],'npm run build:client && npm run build:server');
  assert.equal(pkg.scripts['build:termux'],'npm run build:client');
  assert.doesNotMatch(pkg.scripts['build:termux'],/esbuild/);
});

test('Termux runner prefers current server.ts via tsx over stale dist server artifact',()=>{
  const source=fs.readFileSync(path.join(runtime,'run_termux_node.sh'),'utf8');
  assert.match(source,/NODE_PLATFORM=.*process\.platform/);
  assert.match(source,/IS_TERMUX_ANDROID=true/);
  assert.match(source,/npm run build:termux/);
  assert.match(source,/exec node --import tsx server\.ts/);
  const androidBlock=source.slice(
    source.indexOf('# Termux\/Android source runtime'.replace('\\/','/')),
    source.indexOf('resolve_server_target()')
  );
  assert.match(androidBlock,/dist\/index\.html/);
  assert.doesNotMatch(androidBlock,/dist\/server\.(cjs|mjs|js)/);
});

test('desktop packaged server remains available as the production build contract',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(runtime,'package.json'),'utf8'));
  assert.equal(pkg.scripts.start,'node dist/server.cjs');
  assert.match(pkg.scripts['build:server'],/--format=cjs/);
});


test('Termux activation lets Workplace own SEER and Durable Nova against canonical Core',()=>{
  const install=fs.readFileSync(path.join(runtime,'termux/install-activation.sh'),'utf8');
  const ctl=fs.readFileSync(path.join(runtime,'bin/jacoctl'),'utf8');
  const workplace=fs.readFileSync(path.join(runtime,'termux/services/jaco-workplace/run'),'utf8');
  const nova=fs.readFileSync(path.join(runtime,'termux/services/jaco-nova/run'),'utf8');

  assert.match(install,/for svc in jaco-sentinel jaco-core jaco-workplace jaco-nova/);
  assert.match(install,/ensure_export JACO_RUNTIME_URL "http:\/\/127\.0\.0\.1:3000"/);
  assert.match(install,/ensure_export SEER_URL "http:\/\/127\.0\.0\.1:2997"/);
  assert.match(install,/ensure_export JACO_WORKPLACE_URL "http:\/\/127\.0\.0\.1:2995"/);
  assert.match(install,/set_export JACO_ROOT "\$ROOT"/);
  assert.doesNotMatch(install,/ensure_export JACO_ROOT "\$ROOT"/);
  assert.match(install,/SHARED_TOKEN=.*JACO_GATEWAY_TOKEN/);
  assert.match(install,/runtime\.env/);
  assert.match(install,/chmod 600 "\$ENV_FILE"/);
  assert.match(install,/service-daemon/);
  assert.match(install,/supervise\/ok/);
  assert.match(install,/install_entrypoint jaco "\$PREFIX\/bin\/sh"/);
  assert.match(install,/install_entrypoint jacoctl "\$PREFIX\/bin\/bash"/);
  assert.match(install,/install_entrypoint jaco-tunnel "\$PREFIX\/bin\/bash"/);
  assert.doesNotMatch(install,/ln -sf "\$ROOT\/bin\/jaco"/);
  assert.doesNotMatch(install,/chmod \+x "\$ROOT\/bin\/jacoctl"/);
  assert.match(install,/ln -s "\$PREFIX\/share\/termux-services\/svlogger" "\$SVDIR\/\$svc\/log\/run"/);
  assert.match(ctl,/WORKPLACE_SERVICE=.*jaco-workplace/);
  assert.match(ctl,/svc_up "\$WORKPLACE_SERVICE"/);
  assert.match(ctl,/svc_down "\$NOVA_SERVICE"/);
  assert.doesNotMatch(ctl,/svc_up "\$NOVA_SERVICE"/);
  assert.match(workplace,/workplace-server\.mjs/);
  assert.match(workplace,/JACO_WORKPLACE_SUPERVISE_MODEL=.*1/);
  assert.match(workplace,/JACO_WORKPLACE_SUPERVISE_SEER=.*1/);
  assert.match(workplace,/JACO_WORKPLACE_SUPERVISE_NOVA=.*1/);
  assert.match(install,/ensure_export JACO_WORKPLACE_SUPERVISE_MODEL "1"/);
  assert.match(install,/ensure_export JACO_WORKPLACE_SUPERVISE_SEER "1"/);
  assert.match(workplace,/JACO_WORKPLACE_REQUIRED=.*1/);
  assert.doesNotMatch(workplace,/CANONICAL_RUNTIME|\$HOME\/jaco-code\/runtime/);
  assert.match(workplace,/\[ -f "\$ENV_FILE" \] && \[ -n/);
  assert.match(workplace,/JACO_ROOT_INVALID/);
  assert.match(workplace,/gateway\/src\/workplace\/workplace-server\.mjs/);
  assert.match(workplace,/PREFIX=.*\/data\/data\/com\.termux\/files\/usr/);
  assert.match(workplace,/exec "\$PREFIX\/bin\/node" --experimental-sqlite/);
  assert.match(workplace,/TMPDIR=.*\$PREFIX\/tmp/);
  assert.match(nova,/agents\/hands-off-agent\.mjs/);
  assert.match(nova,/JACO_GATEWAY_TOKEN is required for supervised Durable Nova/);
  assert.match(nova,/export SEER_TOKEN=.*JACO_GATEWAY_TOKEN/);
  assert.match(ctl,/wait_supervised/);
  assert.match(ctl,/service-daemon/);
  assert.match(ctl,/waiting for MODEL → SEER → BRAIN → NOVA/);
  assert.match(ctl,/overall=.*provider=.*model=.*seer=.*nova=/);
  assert.match(ctl,/wait_workplace_running/);
  assert.match(ctl,/core_truth_ready/);
  assert.match(ctl,/Canonical Sentinel\/Core\/Workplace ownership failed/);
  assert.match(ctl,/svc_stable/);
  assert.match(ctl,/prepare_core_owner/);
  assert.match(ctl,/cleanup_stale_core_processes/);
  // Assert the ownership gate, not wording that changes with release diagnostics.
  assert.match(ctl,/if http_ok "\$CORE_URL\/api\/runtime\/identity" && ! core_truth_ready; then/);
  assert.match(ctl,/readlink "\$proc\/cwd"/);
  assert.match(ctl,/if \[\[ "\$cwd" != "\$JACO_ROOT" \]\]; then/);
  const cwdStart=ctl.indexOf('if [[ "$cwd" != "$JACO_ROOT" ]]; then');
  const cwdGate=ctl.slice(cwdStart,ctl.indexOf('cmd="$(tr',cwdStart));
  assert.match(cwdGate,/case "\$cwd" in/);
  assert.match(cwdGate,/\*\) continue ;;/);
  assert.match(ctl,/wait_service_down/);
  assert.match(ctl,/Workplace did not stop cleanly; refusing overlapping restart/);
  assert.match(ctl,/Core did not stop cleanly; refusing overlapping restart/);
  assert.match(ctl,/\[\[ "\$pid" == "\$BASHPID" \|\| "\$pid" == "\$supervised" \]\]/);
  assert.doesNotMatch(ctl,/killall node/);
});

test('Aura runtime truth cannot hide a blocked durable Nova mission',()=>{
  const server=fs.readFileSync(path.join(runtime,'server.ts'),'utf8');
  assert.match(server,/mission\?\.status === 'BLOCKED'/);
  assert.match(server,/Durable Nova mission is BLOCKED and requires operator resolution/);
  assert.match(server,/primaryGoal: mission\?\.goal \|\| live\.primaryGoal/);
});


test('cloud-stack delegates Termux lifecycle to canonical jaco supervisor',()=>{
  const cloud=fs.readFileSync(path.join(root,'scripts/cloud-stack.sh'),'utf8');
  assert.match(cloud,/is_termux\(\)/);
  assert.match(cloud,/termux_jaco activate/);
  assert.match(cloud,/termux_jaco status/);
  assert.match(cloud,/termux_jaco deactivate/);
  assert.match(cloud,/Termux detected: delegating stack activation to canonical jaco supervisor/);
  assert.match(cloud,/skipping cloud npm bootstrap/);
  const upBlock=cloud.slice(cloud.indexOf('up() {'),cloud.indexOf('# --- VS Code tunnel'));
  assert.match(upBlock,/if is_termux; then[\s\S]*termux_jaco activate[\s\S]*return/);
  assert.doesNotMatch(upBlock,/if is_termux; then[\s\S]*detach .*workplace/);
});


test('Termux runtime rebuilds Aura when frontend source hash changes',()=>{
  const runner=fs.readFileSync(path.join(runtime,'run_termux_node.sh'),'utf8');
  assert.match(runner,/termux_frontend_source_hash/);
  assert.match(runner,/\.jaco-ui-source\.sha256/);
  assert.match(runner,/Aura frontend source changed since the last Termux build/);
  assert.match(runner,/build_termux_frontend/);
  assert.match(runner,/npm run build:termux/);
  assert.match(runner,/CURRENT_UI_HASH/);
  assert.match(runner,/BUILT_UI_HASH/);
});

test('Termux activation repairs repository-root imports before touching runit service definitions',()=>{
  const install=fs.readFileSync(path.join(runtime,'termux/install-activation.sh'),'utf8');
  const rootDeps=install.indexOf('JACO_ROOT_LOCKFILE_MISSING');
  const restore=install.indexOf('npm ci --ignore-scripts --omit=optional --no-audit --no-fund');
  const smoke=install.indexOf("await import('./agents/lib/provider-env-import.mjs')");
  const serviceReplace=install.indexOf('rm -rf "$SVDIR/$svc"');
  assert(rootDeps>=0 && restore>rootDeps && smoke>restore);
  assert(serviceReplace>smoke, 'runit definitions must not be replaced before the root import passes');
  assert.match(install,/JACO_ROOT_IMPORT_FAILED/);
  const workspace=fs.readFileSync(path.join(root,'gateway/src/workplace/workplace-server.mjs'),'utf8');
  assert(workspace.includes("import 'dotenv/config'"));
});

test('fatal asynchronous Core startup error exits instead of leaving a non-listening runit PID',async()=>{
  const source=fs.readFileSync(path.join(runtime,'server.ts'),'utf8');
  const marker='\\nstartServer().catch(';
  const i=source.lastIndexOf(marker);
  assert(i>0,'Core must explicitly handle fatal startServer promise rejection');
  const {runInNewContext}=await import('node:vm');
  const exits=[];
  const messages=[];
  const statement=source.slice(i).trim();
  const finished=runInNewContext(statement,{
    startServer:async()=>{throw new Error('LEDGER_LOCKED: test holder');},
    console:{error:(...values)=>messages.push(values.join(' '))},
    process:{exit:code=>exits.push(code)}
  });
  await finished;
  assert.deepEqual(exits,[1]);
  assert.match(messages.join('\\n'),/LEDGER_LOCKED/);
  assert.match(messages.join('\\n'),/FATAL startup failed/);
});
