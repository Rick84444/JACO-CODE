import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AURA_RUN_MODES, initialAuraRunMode, normalizeAuraRunMode, normalizeAuraChatMode, normalizeAuraMissionMode } from '../../runtime/src/lib/auraRunModes.mjs';
import { cognitiveActivationPreview } from '../../runtime/src/lib/auraCognitiveActivation.mjs';
import { buildAuraSeerPrompts } from '../../agents/lib/aura-seer-chat.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = path => fs.readFileSync(root + '/' + path,'utf8');

test('Manual and Planning cannot create a mission; Full Autonomous never represents a grant', () => {
  assert.deepEqual(Object.keys(AURA_RUN_MODES), ['manual', 'planning', 'autonomous']);
  assert.equal(AURA_RUN_MODES.manual.createsMission, false);
  assert.equal(AURA_RUN_MODES.planning.createsMission, false);
  assert.equal(AURA_RUN_MODES.autonomous.createsMission, true);
  assert.equal(AURA_RUN_MODES.planning.interactionMode, 'planning');
  assert.equal(normalizeAuraRunMode('autonomous').executionMode, 'autonomous');
  assert.throws(() => normalizeAuraRunMode('unlimited'), /AURA_RUN_MODE_UNKNOWN/);
  assert.equal(initialAuraRunMode('autonomous'), 'manual', 'autonomous must require explicit selection per session');
  assert.equal(initialAuraRunMode('planning'), 'planning');
  assert.equal(initialAuraRunMode(null), 'manual');
  assert.equal(normalizeAuraChatMode('planning'), 'planning');
  assert.equal(normalizeAuraChatMode('question'), 'question');
  assert.equal(normalizeAuraChatMode(undefined), 'action', 'old API clients retain their behavior');
  assert.throws(() => normalizeAuraChatMode('autonomous'), /AURA_CHAT_MODE_UNKNOWN/);
  assert.equal(normalizeAuraMissionMode(undefined), 'legacy');
  assert.equal(normalizeAuraMissionMode('autonomous'), 'autonomous');
  assert.throws(() => normalizeAuraMissionMode('override-all'), /AURA_MISSION_MODE_INVALID/);
});

test('Knowledge activation only includes verified evidence and ACTIVE skill metadata', () => {
  const requests = [];
  const result = cognitiveActivationPreview('fix retry bug', {
    knowledge: {search: (query,opts) => {
      requests.push(['knowledge',query,opts]);
      return [
        {id:'old',purpose:'failed fix',verificationStatus:'STALE',evidenceRefs:['e1']},
        {id:'draft',purpose:'maybe useful',verificationStatus:'UNVERIFIED',evidenceRefs:['e2']},
        {id:'empty',purpose:'unsupported claim',verificationStatus:'VERIFIED',evidenceRefs:[]},
        {id:'confirmed',purpose:'bounded retries',kind:'design',confidence:0.96,verificationStatus:'VERIFIED',evidenceRefs:['receipt-verified']},
      ];
    }},
    skills: {search:(query,opts) => {
      requests.push(['skills',query,opts]);
      return [
        {id:'experimental',status:'CANDIDATE',name:'Unapproved'},
        {id:'retry-v2',status:'ACTIVE',name:'Safe retry',description:'Retries with bounds',version:'1.2.0'},
      ];
    }},
  });
  assert.deepEqual(requests.map(r=>r[0]),['knowledge','skills']);
  assert.equal(result.schema,'jaco.aura.cognitive-activation/v1');
  assert.deepEqual(result.knowledge.map(x=>x.id),['confirmed']);
  assert.deepEqual(result.skills.map(x=>x.id),['retry-v2']);
  assert.equal(result.skills[0].activation,'DISCOVERED_NOT_AUTHORIZED');
  assert.ok(result.skills[0].requires.includes('step_permission'));
  assert.equal(result.permission,'NO_GRANT_PER_STEP_POLICY_REQUIRED');
  assert.ok(!JSON.stringify(result).includes('failed fix'));
  assert.ok(!JSON.stringify(result).includes('experimental'));
});

test('Malformed, empty and unavailable knowledge never become verified or executable', () => {
  assert.deepEqual(cognitiveActivationPreview(''),cognitiveActivationPreview('     '));
  const result = cognitiveActivationPreview('do something', {
    knowledge:{search(){throw Error('KNOWLEDGE_DOWN');}},
    skills:{search(){throw Error('SKILL_INDEX_DOWN');}},
  });
  assert.deepEqual(result.knowledge,[]);
  assert.deepEqual(result.skills,[]);
  assert.equal(result.permission,'NO_GRANT_PER_STEP_POLICY_REQUIRED');
});

test('Planning system instruction survives a completely full RAG budget on all tool rounds', () => {
  const huge = Array.from({length: 8}, (_,i)=>({source:'file-'+i,content:'x'.repeat(6000)}));
  const planning = buildAuraSeerPrompts({message:'Create a rollout plan', chatMode:'planning', ragContext:huge});
  const manual = buildAuraSeerPrompts({message:'Create a rollout plan', chatMode:'manual', ragContext:huge});
  assert.match(planning.system,/RUN_MODE: PLANNING/);
  assert.match(planning.system,/skapa inte uppdrag/);
  assert.match(manual.system,/RUN_MODE: MANUAL/);
  assert.doesNotMatch(manual.system,/RUN_MODE: PLANNING/);
  assert.equal(planning.user.includes('SOURCE: file-7'),false,'late context is truncated in this reproduction');
  assert.ok(planning.system.length > 1000,'system instruction is not truncated with RAG');
});

test('The current GUI has a single compact label, inline build flow and no popup on autonomous selection', () => {
  const gui = read('runtime/src/components/AuraChatPanel.tsx');
  const css = read('runtime/src/cognitive-workspace.css');
  const parent = read('runtime/src/components/JacoAuraComputeIDE.tsx');
  const backend = read('runtime/server.ts');
  assert.match(gui,/data-testid="jaco-run-mode-toggle"/);
  assert.match(gui,/data-run-mode=\{runMode\}/);
  assert.match(gui,/showModePicker &&/);
  assert.match(gui,/jaco-autonomous-active/);
  assert.match(gui,/data-testid="jaco-build-agent-toggle"/);
  assert.match(gui,/data-testid="jaco-build-agent-panel"/);
  assert.match(gui,/data-testid="jaco-build-agent-submit"/);
  assert.match(gui,/x-jaco-operator-token/);
  assert.match(gui,/reportsTo:'aura'/);
  assert.match(gui,/Build Agent is a local UI action in every mode/);
  assert.match(gui,/return composeMode==='goal'\?goal\(\):ask\(\)/);
  assert.doesNotMatch(gui,/window\.confirm\(tr\([\s\S]{0,160}Full Autonomous/);
  assert.match(css,/@keyframes jaco-autonomous-pulse/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(parent,/executionMode \? \{ executionMode \}/);
  assert.match(backend,/normalizedInteractionMode === 'planning'/);
  assert.match(backend,/planningMode \? '' : userMsg/);
  assert.match(backend,/chatMode: planningMode \? 'planning' : questionMode \? 'manual' : 'action'/);
  assert.doesNotMatch(backend,/jaco:\/\/run-mode\/planning/);
  assert.match(backend,/cognitiveActivationPreview/);
  assert.match(backend,/normalizeAuraMissionMode\(req.body\?\.executionMode\)/);
  assert.match(backend,/app.get\('\/api\/aura\/chat\/cognitive-activation'/);
});

test('The Build Agent operator action uses the existing dedicated organization authentication route', () => {
  const gui = read('runtime/src/components/AuraChatPanel.tsx');
  const org = read('runtime/src/server/connected/agentOrganization.mjs');
  assert.match(gui,/fetch\('\/api\/aura\/organization\/agents'/);
  assert.match(gui,/kind:'local',providerId:'ollama',model:''/);
  assert.match(gui,/type="password" autoComplete="off"/);
  assert.match(org,/router\.post\('\/agents', handle\(req => \(\{ agent: organization\.createAgent/);
  assert.match(org,/requireMutationAuth\(req, res, next\)/);
  assert.doesNotMatch(gui,/eval\(|new Function|localStorage\.setItem\('agentKey'/);
});
