#!/usr/bin/env node
// Clean-room check of the JACO Lite download: unpack the zip into an empty temporary folder with the
// system's own unzip tool, start it with the one documented command, and check what a new user would see.
// Writes a receipt next to the zip. A step that cannot run here (no local model) is "skipped", never "ok".
//
//   node tools/verify-lite.mjs [path-to-zip]
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findFreePort } from '../lite/start.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const zipPath = path.resolve(process.argv[2] || (() => {
  const dir = path.join(repoRoot, 'build', 'lite');
  const zips = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.zip')).sort() : [];
  if (!zips.length) throw new Error('no zip in build/lite: run tools/build-lite.mjs first');
  return path.join(dir, zips.at(-1));
})());

const steps = [];
const step = async (name, fn) => {
  const started = Date.now();
  try {
    const r = await fn();
    const status = r?.skipped ? 'skipped' : 'ok';
    steps.push({ name, status, ms: Date.now() - started, evidence: r?.evidence ?? r?.skipped ?? null });
    console.log(`${status === 'ok' ? 'ok     ' : 'skipped'} ${name}${r?.evidence ? `  ${String(r.evidence).slice(0, 140)}` : r?.skipped ? `  (${r.skipped})` : ''}`);
    return r;
  } catch (error) {
    // What the server and the agent logged last: the reason is usually there.
    const tail = file => { try { return fs.readFileSync(path.join(project, '.jaco', file), 'utf8').slice(-700).replace(/s+/g, ' '); } catch { return '(none)'; } };
    const detail = `${String(error.message || error)} || lite.log: ${tail('lite.log')} || nova.log: ${tail('nova.log')}`;
    steps.push({ name, status: 'failed', ms: Date.now() - started, evidence: detail.slice(0, 2400) });
    console.log(`FAILED  ${name}  ${detail.slice(0, 1800)}`);
    return null;
  }
};
const must = (cond, message) => { if (!cond) throw new Error(message); };
const getJson = async (url, init) => { const res = await fetch(url, init); return { res, body: await res.json().catch(() => null) }; };

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-lite-verify-'));
const project = path.join(work, 'my-project');
fs.mkdirSync(project);
fs.writeFileSync(path.join(project, 'hello.txt'), 'a project file\n');
// A tiny real project for the agent: a function, its test, committed in git (Nova works in a git copy).
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0', scripts: { test: 'node --test' } }, null, 2));
fs.writeFileSync(path.join(project, 'math.js'), 'function add(a, b) { return a + b; }\nmodule.exports = { add };\n');
fs.writeFileSync(path.join(project, 'math.test.js'), "const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { add } = require('./math');\ntest('add', () => assert.equal(add(2, 3), 5));\n");
for (const args of [['init'], ['add', '-A'], ['-c', 'user.name=verify', '-c', 'user.email=verify@localhost', 'commit', '-m', 'demo project']]) spawnSync('git', ['-C', project, ...args], { encoding: 'utf8' });
// The agent needs a capable model: a Groq key from the environment or the builder's .env, given to the child only.
const envKey = name => process.env[name] || (() => { try { return new RegExp('^' + name + '=(.+)$', 'm').exec(fs.readFileSync(path.join(repoRoot, '.env'), 'utf8'))?.[1].trim().replace(/^(['"])(.*)\1$/, '$2'); } catch { return null; } })();
// A capable model the agent can plan with: DeepSeek if a key exists (fast, a few cents a run), else Groq (free, but its
// per-minute token limit makes a mission take many minutes). The key is given to the IDE the way a user would.
const cloud = (() => { const d = envKey('DEEPSEEK_API_KEY'); if (d) return { id: 'deepseek', key: d }; const g = envKey('GROQ_API_KEY'); return g ? { id: 'groq', key: g } : null; })();
const groqKey = cloud?.key;
const liteToken = crypto.randomBytes(24).toString('hex');
let child = null;
let installDir = null;
let base = null;
let mockProvider = null;
let mockUrl = null;

try {
  const zipBytes = fs.readFileSync(zipPath);
  const sha256 = crypto.createHash('sha256').update(zipBytes).digest('hex');

  await step('unpack with the system unzip tool into an empty folder', () => {
    // Windows' own bsdtar reads zip; a GNU tar earlier on the PATH (Git Bash) would read "C:" as a host.
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    const tool = spawnSync(process.platform === 'win32' ? tar : 'unzip', process.platform === 'win32' ? ['-xf', zipPath, '-C', work] : ['-q', zipPath, '-d', work], { encoding: 'utf8' });
    must(tool.status === 0, `unpack failed: ${tool.stderr || tool.error}`);
    const top = fs.readdirSync(work).filter(f => f.startsWith('jaco-lite-'));
    must(top.length === 1, `expected one jaco-lite-* folder, found ${top.join(',')}`);
    installDir = path.join(work, top[0]);
    return { evidence: `${top[0]}, ${fs.readdirSync(installDir).length} top-level entries` };
  });
  must(installDir, 'cannot continue without an unpacked folder');

  await step('no .env, key files or source maps in the package', () => {
    const bad = [];
    const walk = (dir, rel) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (next !== 'node_modules') walk(path.join(dir, e.name), next); }
      else if (/^\.env|\.pem$|\.key$|\.map$|secrets?\.json$/i.test(e.name)) bad.push(next);
    } };
    walk(installDir, '');
    must(!bad.length, `unexpected files: ${bad.join(', ')}`);
    return { evidence: 'none outside node_modules' };
  });

  await step('start.mjs --check passes', () => {
    const r = spawnSync(process.execPath, [path.join(installDir, 'start.mjs'), '--check', '--port', '3901', project], { encoding: 'utf8' });
    must(r.status === 0, `exit ${r.status}: ${r.stderr}`);
    return { evidence: r.stdout.split('\n')[0] };
  });

  // Use a deterministic fake OpenAI-compatible LiteRT to verify transport and model
  // selection in the ACTUAL unpacked Lite server, without pretending a mock is real inference.
  await step('start isolated model HTTP fixture for Lite routing smoke test', async () => {
    mockProvider = http.createServer(async (req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.end(JSON.stringify({object:'list',data:[{id:'jaco-lite-mock-probe',object:'model'}]}));
        return;
      }
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        let raw = '';
        for await(const chunk of req) raw += chunk;
        let body;
        try { body=JSON.parse(raw); } catch {}
        if (body?.model !== 'jaco-lite-mock-probe' || !Array.isArray(body.messages)) {
          res.statusCode = 400; res.end(JSON.stringify({error:'INVALID_MOCK_MODEL_CALL'})); return;
        }
        res.end(JSON.stringify({object:'chat.completion',model:'jaco-lite-mock-probe',choices:[
          {index:0,message:{role:'assistant',content:'LITE_DIRECT_ROUTE_OK'},finish_reason:'stop'}]}));
        return;
      }
      res.statusCode=404;res.end(JSON.stringify({error:'NO_MOCK_ROUTE'}));
    });
    await new Promise((resolve,reject)=>{
      mockProvider.once('error',reject);
      mockProvider.listen(0,'127.0.0.1',resolve);
    });
    mockUrl='http://127.0.0.1:' + mockProvider.address().port + '/v1';
    return {evidence:'deterministic local HTTP model fixture listening; not real LLM inference'};
  });

  await step('WhatsApp voice channel: support loads from the package and a voice engine answers', () => {
    const r = spawnSync(process.execPath, [path.join(installDir, 'start.mjs'), '--whatsapp-check'], { encoding: 'utf8', env: { ...process.env, JACO_STATE_DIR: path.join(work, 'state') } });
    must(r.status === 0, `exit ${r.status}: ${r.stdout} ${r.stderr}`);
    must(/WhatsApp support: loads \(ok\)/.test(r.stdout), r.stdout);
    return { evidence: r.stdout.trim().split('\n').join(' | ') };
  });

  const port = await findFreePort(3910);
  let output = '';
  await step('one command starts the IDE and it answers', async () => {
    child = spawn(process.execPath, [path.join(installDir, 'start.mjs'), project, '--no-open', '--port', String(port)], {
      cwd: work, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      // JACO_STATE_DIR keeps the secrets this run stores out of the operator's real ~/.jaco. No model is forced on the agent.
      env: { ...process.env, JACO_LITE_TOKEN: liteToken, JACO_STATE_DIR: path.join(work, 'state'), JACO_LITERT_URL: mockUrl, GROQ_API_KEY: '', DEEPSEEK_API_KEY: '', JACO_PRIMARY_PROVIDER: '' },
    });
    child.stdout.on('data', c => { output += c; });
    child.stderr.on('data', c => { output += c; });
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline && !/IDE:\s+http/.test(output)) {
      if (child.exitCode !== null) throw new Error(`exited ${child.exitCode}: ${output.slice(-500)}`);
      await new Promise(r => setTimeout(r, 300));
    }
    const m = /IDE:\s+(http:\/\/127\.0\.0\.1:\d+)/.exec(output);
    must(m, `no address printed: ${output.slice(-400)}`);
    base = m[1];
    return { evidence: `${base} after ${Math.round((Date.now() - (deadline - 120_000)) / 100) / 10} s` };
  });
  must(base, 'server did not start');

  await step('the IDE page and its script load', async () => {
    const html = await (await fetch(`${base}/`)).text();
    must(/<div id="root"/.test(html), 'index.html has no root element');
    const script = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    must(script, 'no script in index.html');
    const js = await fetch(`${base}${script}`);
    const data = Buffer.from(await js.arrayBuffer());
    const bytes = data.byteLength;
    must(js.status === 200 && bytes > 100_000, `script ${js.status}, ${bytes} bytes`);
    const release = JSON.parse(fs.readFileSync(path.join(installDir, 'release.json'), 'utf8'));
    must(release.workspace === 'cognitive-live/v1', 'the archive does not identify the Cognitive Live Workspace');
    must(script === release.entry && crypto.createHash('sha256').update(data).digest('hex') === release.clientSha256, 'served client does not match the packaged release');
    must(data.includes(Buffer.from('data-cognitive-workspace')), 'the served client is the old editor');
    return { evidence: `${script}, ${(bytes / 1024).toFixed(0)} KB` };
  });

  await step('the packaged Lite runtime serves the actual live event stream', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let reader;
    try {
      const res = await fetch(base+'/api/aura/workbench/live', { signal: controller.signal });
      must(res.ok && res.headers.get('content-type')?.includes('text/event-stream'), 'live stream is not served');
      reader = res.body.getReader(); let text = '';
      while (!text.includes('\n\n')) { const next = await reader.read(); must(!next.done, 'stream closed before its first observation'); text += Buffer.from(next.value).toString(); }
      const json = text.split('\n').find(line => line.startsWith('data: '));
      const packet = JSON.parse(json.slice(6));
      must(packet.schema === 'jaco.cognitive-live/v1' && Array.isArray(packet.events), 'invalid live observation');
      return { evidence: packet.schema+', real packaged runtime, cursor '+packet.cursor };
    } finally { clearTimeout(timer); await reader?.cancel().catch(()=>{}); controller.abort(); }
  });

  await step('automatic connections start bundled MCP without configuration', async () => {
    const { res, body } = await getJson(`${base}/api/aura/workbench/connections`);
    must(res.ok && Array.isArray(body.providers), 'automatic connection receipt unavailable');
    const editor = body.tools?.find(t => t.id === 'editor');
    must(editor?.state === 'CONNECTED' && editor.tools.includes('read_file'), 'bundled Editor MCP did not initialize');
    const call = await getJson(`${base}/api/mcp/call`, { method:'POST', headers:{'content-type':'application/json','x-gateway-token':liteToken}, body:JSON.stringify({ server:'editor', tool:'read_file', arguments:{path:'hello.txt'} }) });
    must(call.res.ok && call.body.success && JSON.stringify(call.body.result).includes('a project file'), 'bundled MCP read tool failed against the actual project');
    return { evidence: { observedAt: body.observedAt, models: body.providers.map(p => ({ id:p.id, state:p.state })), tools: editor.tools } };
  });

  await step('real packaged Gameboard HTTP and JacoEdit MCP share persisted agent mathematics', async () => {
    const url = `${base}/api/aura/workbench/gameboard`;
    const before = await getJson(url);
    must(before.res.ok && before.body?.schema === 'jaco.gameboard-fabric/v1', 'Gameboard API absent in actual packaged runtime');
    must(before.body?.graphSource === 'UNAVAILABLE', 'Lite without SEER must never simulate a live graph');
    must(before.body?.exchange?.revision === 0, 'unexpected nonempty shared Gameboard on new workspace');
    must(Array.isArray(before.body.tools) && Array.isArray(before.body.agents), 'numeric identity registry missing');
    must([...before.body.tools, ...before.body.agents].every(t => Number.isSafeInteger(t.numericId)), 'numeric ID is not JSON-safe');
    const scenario = { goalId:'goal:release-check', missionId:'mission:release-check', steps:[
      { id:'investigate', goalImpact:0.8, verificationGain:0.5, informationGain:0.9,
        confidence:0.75, risk:0.1, effort:0.2 },
      { id:'verify', dependencies:['investigate'], goalImpact:1, verificationGain:1,
        informationGain:0.3, confidence:0.8, risk:0.15, effort:0.3 },
    ] };
    const evaluate = () => getJson(url + '/simulate', { method:'POST',
      headers:{'content-type':'application/json'}, body:JSON.stringify(scenario) });
    const [simulationA, simulationB] = [await evaluate(), await evaluate()];
    must(simulationA.res.ok && simulationA.body.status === 'SIMULATED', 'hypothetical simulation unavailable');
    must(simulationA.body.executed === false && simulationA.body.verified === false,
      'simulation falsely claimed execution or verification');
    must(JSON.stringify(simulationA.body) === JSON.stringify(simulationB.body), 'same scenario produced non-deterministic values');
    must(simulationA.body.result?.terminalProbability === 0.6, 'dependency rollout returned incorrect 0.75 × 0.8');
    must((await getJson(url)).body?.exchange?.revision === 0, 'simulation mutated durable exchange state');

    const scope = 'release:gameboard:' + crypto.randomUUID();
    const post = payload => getJson(url + '/events', {
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),
    });
    const read = () => getJson(url + '/events?scope=' + encodeURIComponent(scope));
    const first = { eventId:'obs-a',scope,actorId:'agent:investigator',expectedRevision:0,
      kind:'OBSERVATION',statement:'Tool reported available',evidenceRefs:[] };
    const initial = await post(first);
    must(initial.res.status === 201 && initial.body?.revision === 1, 'first agent observation did not persist');
    const conflicting = await post({eventId:'obs-b',scope,actorId:'agent:verifier',expectedRevision:1,
      kind:'HYPOTHESIS',statement:'Tool may be unavailable',evidenceRefs:[]});
    must(conflicting.res.status === 201 && conflicting.body?.revision === 2, 'independent hypothesis did not persist');
    const duplicate = await post(first);
    must(duplicate.res.status === 200 && duplicate.body?.replay === true && duplicate.body?.revision === 2,
      'exact event replay was not deduplicated');
    const stale = await post({...first,eventId:'stale-proposal'});
    must(stale.res.status === 409 && /GAMEBOARD_STALE_REVISION/.test(stale.body?.error),
      'stale write was accepted');
    const mcp = await getJson(`${base}/api/mcp/call`, {
      method:'POST',
      headers:{'content-type':'application/json','x-gateway-token':liteToken},
      body:JSON.stringify({server:'editor',tool:'gameboard_publish',mode:'write',arguments:{
        eventId:'proposal-c',scope,actorId:'spoofed-actor',expectedRevision:2,kind:'MOVE_PROPOSAL',
        statement:'Read the tool registry before executing',
        target:'mcp:editor:gameboard_status',
        metrics:{goalImpact:0.8,informationGain:0.9,verificationGain:0.7,confidence:0.8,risk:0.1,effort:0.1},
        evidenceRefs:[],
      }}),
    });
    must(mcp.res.ok && mcp.body?.success === true, 'real bundled JacoEdit gameboard_publish tool did not succeed: '+JSON.stringify(mcp.body).slice(0,230));
    const after = await read();
    must(after.res.ok && after.body.revision === 3 && after.body.entries?.length === 3,
      'agents did not share the same durable Gameboard revision');
    must(after.body.entries[0].actorId === 'agent:investigator'
      && after.body.entries[1].actorId === 'agent:verifier',
      'different agent observations were lost');
    must(after.body.entries[2].kind === 'MOVE_PROPOSAL' && after.body.entries[2].actorId !== 'spoofed-actor',
      'bundled editor allowed impersonation of Workplace agent');
    must(after.body.entries.every(e => e.evidenceStatus === 'UNVERIFIED_CLAIM'),
      'unverified claims were promoted to receipts');
    return { evidence: '2 real agents + attested MCP proposal, 3 durable revisions, deterministic rollout and stale/replay denial' };
  });

  await step('API answers: health, model list, workspace sees the project file', async () => {
    const identity = await getJson(`${base}/api/runtime/identity`);
    must(identity.res.status === 200 && identity.res.headers.get('content-type')?.includes('application/json')
      && identity.body?.success === true && identity.body?.product === 'JACO Autonomus IDE'
      && Number(identity.body?.primaryPort) === port,
      'IDE identity is missing/incorrect; do not count an HTML 200 from the SPA fallback as healthy');
    const models = await getJson(`${base}/api/aura/chat/models`);
    must(models.res.status === 200 && Array.isArray(models.body?.providers), 'model list not served');
    const tree = await getJson(`${base}/api/aura/workbench/files`);
    must(tree.res.ok, 'project file list unavailable');
    return { evidence: `${models.body.providers.length} providers known, actual workbench files HTTP ${tree.res.status}` };
  });

  await step('actual packaged Lite sends default Aura chat to a local model without SEER', async () => {
    const {res,body} = await getJson(`${base}/api/aura/chat`,{
      method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(45_000),
      body:JSON.stringify({message:'Reply with one word: OK',selectedProvider:'seer',interactionMode:'question'})
    });
    must(res.status===200 && body?.success===true && !body.degraded,
      'Lite routed to SEER or failed to use the local provider: '+JSON.stringify(body).slice(0,450));
    must(body.provider==='litert' && body.model==='jaco-lite-mock-probe',
      'JACO selected a non-observed provider/model: '+JSON.stringify(body).slice(0,350));
    must(body.reply==='LITE_DIRECT_ROUTE_OK','Lite did not forward the model response');
    must(body.providerReceipt?.source?.includes('manual-aura-chat'),'Lite omitted the direct provider receipt');
    return {evidence:'actual ZIP + HTTP fixture: default SEER selection maps to direct litert model; no SEER; synthetic generation only'};
  });

  await step('state lives in the project folder and stays out of its git', () => {
    must(fs.existsSync(path.join(project, '.jaco', '.gitignore')), 'no .jaco/.gitignore');
    must(fs.existsSync(path.join(project, '.jaco', 'lite.log')), 'no lite.log');
    return { evidence: '.jaco/.gitignore and lite.log present' };
  });

  const ollama = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(2000) }).then(r => r.json()).catch(() => null);
  const localModels = (ollama?.models || []).map(m => m.name);

  await step('connect a model from nothing but its address (local Ollama)', async () => {
    if (!localModels.length) return { skipped: 'no local Ollama with a model on this computer' };
    const { res, body } = await getJson(`${base}/api/aura/workbench/providers/connect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'http://127.0.0.1:11434' }) });
    must(res.status === 201 && body?.discovery?.state === 'READY', `status ${res.status}, state ${body?.discovery?.state}`);
    return { evidence: `${body.discovery.id}: ${body.discovery.models.length} models, default ${body.discovery.defaultModel}` };
  });

  await step('connect a cloud model by pasting only its key (the way a user does)', async () => {
    if (!groqKey) return { skipped: "no GROQ_API_KEY in the environment or the builder's .env" };
    const { res, body } = await getJson(base + '/api/aura/workbench/providers/key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: groqKey, provider: cloud.id }) });
    must(res.status === 201 && body?.result?.state === 'READY', 'status ' + res.status + ', state ' + body?.result?.state);
    must(!JSON.stringify(body).includes(groqKey), 'the response contains the key');
    return { evidence: body.provider.id + ' ready, default model ' + body.result.defaultModel + ', key stored encrypted in the isolated state folder' };
  });

  await step('the default chat gets a real answer from a connected model (no SEER in Lite)', async () => {
    if (!localModels.length && !groqKey) return { skipped: 'no local Ollama and no cloud key on this computer' };
    const { res, body } = await getJson(`${base}/api/aura/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(240_000),
      body: JSON.stringify({ message: 'Reply with exactly one word: ok', selectedProvider: 'seer', messagesHistory: [{ role: 'user', content: 'Reply with exactly one word: ok' }] }),
    });
    must(res.status === 200 && body?.success === true, `status ${res.status}`);
    must(!body.degraded, `got the status answer, not a model answer: ${String(body.reply).slice(0, 200)}`);
    must(typeof body.reply === 'string' && body.reply.trim(), 'empty reply');
    return { evidence: `${body.modelUsed}: "${body.reply.trim().slice(0, 40)}"` };
  });

  await step("Nova completes a real goal and the project's own tests pass (checked independently)", async () => {
    if (!groqKey) return { skipped: "no GROQ_API_KEY in the environment or the builder's .env: the agent needs a capable model" };
    const goal = 'Add a function mul(a, b) to math.js that returns a * b, and add a test for it to math.test.js. Run the tests.';
    const started = await getJson(base + '/api/aura/workbench/start-goal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal }) });
    must(started.res.status === 201 && started.body?.lite === true, 'start-goal ' + started.res.status + ': ' + JSON.stringify(started.body).slice(0, 200));
    must(started.body.testsRequired === true && started.body.testCommand === 'npm test', "the contract does not require the project's tests");
    const id = started.body.mission.id;
    const novaLog = () => { try { return fs.readFileSync(path.join(project, '.jaco', 'nova.log'), 'utf8').slice(-1200); } catch { return '(no nova.log)'; } };
    let mission = null;
    let blockedSince = null;
    const deadline = Date.now() + 20 * 60_000;
    while (Date.now() < deadline) {
      const r = await getJson(base + '/api/connected/nova/missions/' + id, { headers: { 'x-gateway-token': liteToken } });
      mission = r.body?.mission || r.body;
      if (['DONE', 'CANCELLED', 'AWAITING_VERIFICATION'].includes(mission?.status)) break;
      // BLOCKED is not the end: the runtime resumes an autonomous mission that failed a step (a wrong edit, say) within
      // the contract's budget. Only a mission that stays blocked for a few minutes counts as stuck.
      if (mission?.status === 'BLOCKED') { blockedSince ??= Date.now(); if (Date.now() - blockedSince > 240_000) break; } else blockedSince = null;
      await new Promise(r => setTimeout(r, 4000));
    }
    const steps = (mission?.receipts || []).map((r, i) => (i + 1) + '.' + r.type + ':' + (r.ok ? 'ok' : 'FAIL ' + String(r.error || '').slice(0, 90)) + (r.input?.command ? ' [' + r.input.command + ']' : '')).join(' | ');
    must(['DONE', 'AWAITING_VERIFICATION'].includes(mission?.status), 'mission ended as ' + mission?.status + '. receipts: ' + steps + ' || nova.log: ' + novaLog());
    const receipts = mission.receipts || [];
    const lastWrite = receipts.reduce((last, r, i) => (['repo-write', 'repo-edit'].includes(r.type) ? i : last), -1);
    must(lastWrite >= 0, 'no file was written');
    must(receipts.some((r, i) => i > lastWrite && r.type === 'repo-test' && r.ok && r.verified), 'no passing test run after the last write');
    // Independent of Nova: read the branch it committed on and run the tests ourselves.
    const branch = 'jaco/' + id;
    const shown = spawnSync('git', ['-C', project, 'show', branch + ':math.js'], { encoding: 'utf8' });
    must(shown.status === 0 && /mul/.test(shown.stdout), 'branch ' + branch + ' has no mul in math.js');
    const check = path.join(work, 'check');
    fs.mkdirSync(check);
    const archive = spawnSync('git', ['-C', project, 'archive', branch], { maxBuffer: 50_000_000 });
    must(archive.status === 0, 'git archive failed');
    fs.writeFileSync(path.join(work, 'check.tar'), archive.stdout);
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    must(spawnSync(tar, ['-xf', path.join(work, 'check.tar'), '-C', check]).status === 0, 'could not unpack the branch');
    const ran = spawnSync(process.execPath, ['--test'], { cwd: check, encoding: 'utf8' });
    must(ran.status === 0, 'the tests fail on the agent\'s branch: ' + ran.stdout.slice(-300));
    const tests = Number(/(?:# tests|ℹ tests) (\d+)/.exec(ran.stdout)?.[1]);
    must(tests >= 2, "the agent was to add a test next to the existing one, but " + tests + " test(s) ran");
    let how = 'completed by itself';
    if (mission.status === 'AWAITING_VERIFICATION') {
      // The IDE asks the user to confirm. Only after the checks above, this script acts as that user.
      const d = await getJson(base + '/api/aura/workbench/approvals/' + encodeURIComponent('mission:' + id) + '/decision', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'confirm', note: 'verify-lite: independent checks passed' }) });
      must(d.res.ok, 'could not confirm the mission: ' + JSON.stringify(d.body).slice(0, 200));
      how = 'confirmed by this script acting as the user, after the independent checks';
    }
    return { evidence: branch + ': ' + receipts.length + ' receipts, tests run by us: ' + tests + ' passed, mul present, ' + how };
  });

  const failed = steps.filter(s => s.status === 'failed');
  const receipt = {
    schema: 'jaco.lite-receipt/v1',
    verifiedAt: new Date().toISOString(),
    zip: { file: path.basename(zipPath), bytes: zipBytes.length, sha256 },
    environment: { os: `${os.type()} ${os.release()}`, node: process.versions.node, cleanFolder: true },
    ok: failed.length === 0,
    steps,
  };
  fs.writeFileSync(`${zipPath}.receipt.json`, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`\nreceipt: ${zipPath}.receipt.json  (${receipt.ok ? 'all steps that could run passed' : `${failed.length} failed`}; ${steps.filter(s => s.status === 'skipped').length} skipped)`);
  process.exitCode = receipt.ok ? 0 : 1;
} finally {
  if (mockProvider) { try { mockProvider.closeAllConnections?.(); await new Promise(resolve=>mockProvider.close(resolve)); } catch {} }
  if (child && child.exitCode === null) { child.kill(); await new Promise(r => setTimeout(r, 800)); }
  try { fs.rmSync(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 400 }); } catch { /* temp folder; the OS cleans it */ }
}
