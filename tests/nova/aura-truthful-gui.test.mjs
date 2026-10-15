import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const runtimeRoot = path.join(root, 'runtime');
const read = file => fs.readFileSync(file, 'utf8');

test('Aura Workbench is runtime-driven and does not consume legacy Aura state', () => {
  const source = read(path.join(runtimeRoot, 'src/components/JacoAuraComputeIDE.tsx'));
  assert.match(source, /fetch\('\/api\/aura\/workbench'/);
  assert.match(source, /fetch\('\/api\/aura\/workbench\/files'/);
  assert.match(source, /\/api\/aura\/workbench\/file\?path=/);
  assert.match(source, /\/api\/aura\/workbench\/providers/);
  assert.match(source, /\/api\/aura\/workbench\/start-goal/);
  assert.match(source, /\/api\/aura\/workbench\/approvals/);
  assert.match(source, /Approval Center/);
  assert.match(source, /<CognitiveWorkspace/);
  assert.match(source, /useCognitiveLive/);
  assert.doesNotMatch(source, /\/api\/aura\/state/);
  assert.doesNotMatch(source, /\/api\/aura\/podar/);
  assert.doesNotMatch(source, /runtime-truth/);
  assert.doesNotMatch(source, /mockData|INITIAL_MODELS|INITIAL_TELEMETRY/);
  assert.doesNotMatch(source, /status:\s*['"]READY['"]/);
  assert.doesNotMatch(source, /status:\s*['"]ONLINE['"]/);
  assert.doesNotMatch(source, /Git: clean|Memory synchronized|Tests: 4\/4|6\/6/);
  assert.doesNotMatch(source, /apiKey\s*:/);
});
test('canonical Aura is a writable IDE workspace rather than a read-only dashboard', () => {
  const source = read(path.join(runtimeRoot, 'src/components/JacoAuraComputeIDE.tsx'));
  const editor = read(path.join(runtimeRoot, 'src/components/AuraCodeEditor.tsx'));
  const chat = read(path.join(runtimeRoot, 'src/components/AuraChatPanel.tsx'));
  const palette = read(path.join(runtimeRoot, 'src/components/AuraCommandPalette.tsx'));
  const tree = read(path.join(runtimeRoot, 'src/components/AuraRepositoryTree.tsx'));
  const registry = read(path.join(runtimeRoot, 'src/lib/auraToolRegistry.ts'));

  assert.match(source, /<AuraCodeEditor/);
  assert.match(source, /<AuraChatPanel/);
  assert.match(source, /<AuraCommandPalette/);
  assert.match(source, /<AuraRepositoryTree/);
  assert.match(source, /New file/);
  assert.match(source, /Confirm delete/);
  assert.match(source, /file\/rename/);
  assert.match(source, /file\/delete/);
  assert.match(source, /Source Control/);
  assert.match(source, />\s*Fetch\s*</);
  assert.match(source, />\s*Pull\s*</);
  assert.match(source, /Live agent tools/);
  assert.match(source, /AuraIntegrationsPanel/);
  assert.match(source, /Git MCP sources/);
  assert.match(source, /mcp\/import-git/);
  assert.match(source, /TERMINAL/);
  assert.match(source, /PROBLEMS/);
  assert.match(source, /OUTPUT/);
  assert.match(source, /EVIDENCE/);
  assert.doesNotMatch(source, /READ ONLY/);
  assert.doesNotMatch(source, /Canonical Start Prompt/);

  assert.match(editor, /@monaco-editor\/react/);
  assert.match(editor, /expectedHash: file\.hash/);
  assert.match(editor, /Ctrl\/Cmd\+S/);
  assert.match(chat, /\/api\/aura\/chat/);
  assert.match(chat, /\/api\/aura\/workbench\/mcp\/call/);
  assert.match(chat, /\/api\/aura\/workbench\/skills\//);
  assert.match(chat, /skillSource/);
  assert.match(chat, /source: selectedTool\.skillSource/);
  assert.match(chat, /Starta uppdrag/);
  assert.match(chat, /selectedTool/);
  assert.match(chat, /role="log".*aria-label="JACO-konversation"/);
  // Operator 2026-10-11: real observed steps belong in the same conversation.
  assert.match(chat, /CognitiveEventCard/);
  assert.match(chat, /source:'jaco:\/\/current-work'/);
  assert.match(source, /liveEvents=\{cognitiveEvents\}/);
  assert.match(tree, /children: Map<string, SearchNode>/);
  assert.match(tree, /\/api\/aura\/workbench\/tree/);
  assert.match(tree, /directories/);
  assert.match(tree, /expanded/);
  assert.match(tree, /toggleDirectory/);
  assert.match(tree, /ChevronDown/);
  assert.match(tree, /gitChanges/);
  assert.match(palette, /AURA_PRODUCT_TOOLS/);
  assert.match(registry, /Tool Fabric|AURA_PRODUCT_TOOLS|AuraProductTool/);
  for (const id of ['git.source-control','mcp.fabric','remote.control','browser.cdp','editor.vscode','chatgpt.connector','evidence.receipts']) {
    assert.match(registry, new RegExp(id.replace(/[.]/g, '\\.') ));
  }
  assert.doesNotMatch(source, /ChatGPT\s+CONNECTED|VS Code\s+CONNECTED|MCP\s+6\/6/i);
});

test('the Aura runtime nucleus is an observation projection, not decorative telemetry', () => {
  const source = read(path.join(runtimeRoot, 'src/components/AuraRuntimeNucleus.tsx'));
  const workbench = read(path.join(runtimeRoot, 'src/components/JacoAuraComputeIDE.tsx'));
  assert.match(workbench, /<CognitiveWorkspace/);
  const live = read(path.join(runtimeRoot, 'src/hooks/useCognitiveLive.ts'));
  assert.match(live, /new EventSource\('\/api\/aura\/workbench\/live'\)/);
  assert.match(source, /mission\.receipts\.filter/);
  assert.match(source, /mcpProviders.*filter/);
  assert.match(source, /approvalCount/);
  assert.match(source, /OBSERVED.*VERIFIED.*AWAITING_REVIEW.*UNOBSERVED/s);
  assert.match(source, /observation projection/);
  assert.doesNotMatch(source, /Math\.random|SIMULATED|setInterval|fake/i);
});

test('canonical Workbench routes use live runtime objects and remain local-only', () => {
  const server = read(path.join(runtimeRoot, 'server.ts'));
  const start = server.indexOf("// 4a. Aura Workbench");
  const end = server.indexOf("// 4b. Aura truthful runtime projection.", start);
  assert.ok(start >= 0 && end > start, 'Workbench server block missing');
  const block = server.slice(start, end);

  assert.match(server, /const parseTerminalCommandLine/);
  assert.match(server, /COMMAND_UNCLOSED_QUOTE/);
  assert.match(server, /executable: parsed\.executable/);
  assert.match(server, /args: parsed\.args/);

  assert.match(block, /app\.get\('\/api\/aura\/workbench', requireLocalUi/);
  assert.match(block, /app\.get\('\/api\/aura\/workbench\/tree', requireLocalUi/);
  assert.match(block, /listAuraWorkbenchDirectory/);
  assert.match(block, /app\.get\('\/api\/aura\/workbench\/files', requireLocalUi/);
  assert.match(block, /app\.get\('\/api\/aura\/workbench\/file', requireLocalUi/);
  assert.match(block, /app\.put\('\/api\/aura\/workbench\/file', requireLocalUi/);
  assert.match(block, /app\.post\('\/api\/aura\/workbench\/file\/rename', requireLocalUi/);
  assert.match(block, /app\.post\('\/api\/aura\/workbench\/file\/delete', requireLocalUi/);
  assert.match(block, /app\.get\('\/api\/aura\/workbench\/git\/status', requireLocalUi/);
  assert.match(block, /app\.get\('\/api\/aura\/workbench\/git\/diff', requireLocalUi/);
  assert.match(block, /app\.post\('\/api\/aura\/workbench\/git\/action', requireLocalUi/);
  assert.match(block, /app\.post\('\/api\/aura\/workbench\/start-goal', requireLocalUi/);
  assert.match(block, /app\.get\('\/api\/aura\/workbench\/approvals', requireLocalUi/);
  assert.match(block, /app\.post\('\/api\/aura\/workbench\/approvals\/:id\/decision', requireLocalUi/);
  assert.match(block, /app\.post\('\/api\/aura\/workbench\/missions', requireLocalUi/);
  assert.match(block, /app\.get\('\/api\/aura\/workbench\/mcp', requireLocalUi/);
  assert.match(block, /app\.post\('\/api\/aura\/workbench\/mcp\/import-git', requireLocalUi/);
  assert.match(block, /app\.post\('\/api\/aura\/workbench\/mcp\/call', requireLocalUi/);
  assert.match(block, /app\.post\('\/api\/aura\/workbench\/providers', requireLocalUi/);
  assert.match(block, /app\.post\('\/api\/aura\/workbench\/providers\/:id\/probe', requireLocalUi/);

  assert.match(block, /connectedRuntime\.novaMissions\.current\(\)/);
  assert.match(block, /connectedRuntime\.bus\.listEvents\(100\)/);
  assert.match(block, /connectedRuntime\.providers\.list\(\)/);
  assert.match(block, /getAuraSeerHealth/);
  assert.match(block, /seerHealth\.health\?\.local_model/);
  assert.match(block, /evidenceSource: active \? 'seer-health\.local_model'/);
  assert.match(block, /continuumSurface\.runtime\.skills\.refresh\(\)/);
  assert.match(block, /continuumSurface\.runtime\.skills\.skillMachineSnapshot/);
  assert.match(block, /source: 'continuum-runtime'/);
  assert.match(block, /source: 'a2a-package'/);
  assert.match(block, /app\.post\('\/api\/aura\/workbench\/skills\/:id\/execute', requireLocalUi/);
  assert.match(block, /SKILL_NOT_ACTIVE/);
  assert.match(block, /SKILL_NOT_OPERATOR_APPROVED/);
  assert.match(block, /continuumSurface\.runtime\.skills\.execute/);
  assert.match(block, /executeLocalSkill/);
  assert.match(block, /connectedRuntime\.providers\.register/);
  assert.match(block, /connectedRuntime\.providers\.probe/);
  assert.match(block, /listByStatus\('awaiting_approval'\)/);
  assert.match(block, /connectedRuntime\.novaMissions\.resolve/);
  assert.match(block, /modelRelay\.mandates\.isActive/);
  assert.match(block, /auraMcpSources\.stageGit/);
  assert.match(block, /CDP_DIRECT_MUTATION_DISABLED_USE_REMOTE_OR_BROWSER_HANDS_OFF/);
  assert.match(block, /callAuraMcpRpc/);
  assert.match(block, /callCanonicalSeer\('\/cortex\/strategy\/start'/);
  assert.match(block, /JACO_WORKPLACE_URL/);
  assert.match(block, /\/v1\/overview/);
  assert.match(block, /agent\.card\.capabilities/);
  assert.match(block, /source: 'agent-card'/);
  assert.match(block, /source: 'mission-contract'/);
  assert.match(block, /resolveWorkspacePath/);
  assert.match(block, /WORKBENCH_FILE_TOO_LARGE/);
  assert.match(block, /WORKBENCH_FILE_CONFLICT/);
  assert.match(block, /WORKBENCH_EXPECTED_HASH_REQUIRED/);
  assert.match(block, /workspace\.file\.renamed/);
  assert.match(block, /workspace\.file\.deleted/);
  assert.match(block, /getAuraWorkbenchGitStatus/);
  assert.match(block, /readAuraGitDiff/);
  assert.match(block, /execFileAsync\('git'/);
  assert.match(block, /executable: 'git'/);
  assert.match(block, /\['fetch', '--prune'\]/);
  assert.match(block, /\['pull', '--ff-only'\]/);
  assert.match(block, /timeoutMs = 60000/);
  assert.match(block, /integrations: buildAuraIntegrationFabric/);
  assert.match(block, /vscodeMcpConfigured/);
  assert.match(block, /chatgptGatewayConfigured/);
  assert.match(block, /remote_status/);
  assert.match(block, /remote_windows/);
  assert.match(block, /nova_targets/);
  assert.match(block, /visual studio code\|code - insiders/);
  assert.match(block, /No ChatGPT MCP\/Workplace integration observed/);
  assert.match(block, /OpenAI model providers do not count as ChatGPT app integration/);
  assert.match(block, /authenticated ChatGPT\/Nova gateway contract exists/);
  assert.match(block, /workspace\.file\.saved/);
  assert.match(block, /PROVIDER_SECRET_VALUES_NOT_ACCEPTED/);
  assert.match(block, /apiKeyEnv/);
  assert.doesNotMatch(block, /auraEngineManager/);
  assert.doesNotMatch(block, /INITIAL_MODELS|INITIAL_TELEMETRY|INITIAL_CODE_FILES/);
  assert.doesNotMatch(block, /Math\.random\(\).*status|SIMULATED/);
});


test('canonical SEER exposes a single operator start-goal entry point', () => {
  const seer = read(path.join(root, 'gateway/src/seer.mjs'));
  assert.match(seer, /POST && path === '\/cortex\/strategy\/start'/);
  assert.match(seer, /seer\.operator_primary_goal/);
  assert.match(seer, /developmentCycle\.trigger\('operator-goal'/);
  assert.match(seer, /Explicit operator primary goal:/);
  // The graph belongs to this turn's focus goal: the primary goal, or the next goal while the primary
  // goal's own work is running or waiting on the operator.
  assert.match(seer, /strategic_goal_id: focusGoal\?\.id/);
});

test('Aura does not render parallel legacy chat surfaces', () => {
  const app = read(path.join(runtimeRoot, 'src/App.tsx'));
  assert.doesNotMatch(app, /JacoAgentChatbot/);
  assert.doesNotMatch(app, /FloatingAuraAssistant/);
  assert.doesNotMatch(app, /<AgentConsole/);
  assert.match(app, /<JacoAuraComputeIDE \/>/);
  const registry = read(path.join(runtimeRoot, 'src/lib/auraToolRegistry.ts'));
  assert.doesNotMatch(registry, /chat\.open/);
});
test('Git MCP import is provenance-bound and staged before authority', () => {
  const registry = read(path.join(runtimeRoot, 'src/server/mcp/auraMcpSourceRegistry.ts'));
  assert.match(registry, /github\.com/);
  assert.match(registry, /MCP_GIT_GITHUB_HTTPS_REQUIRED/);
  assert.match(registry, /git', \['ls-remote'/);
  assert.match(registry, /resolvedSha/);
  assert.match(registry, /status: 'STAGED'/);
  assert.match(registry, /OPERATOR_APPROVED/);
  assert.doesNotMatch(registry, /npm install|npm ci|child_process.*shell:\s*true/);
});

test('legacy Aura engine is not imported by the Workbench component', () => {
  const source = read(path.join(runtimeRoot, 'src/components/JacoAuraComputeIDE.tsx'));
  assert.doesNotMatch(source, /auraEngine|AuraEngineManager|currentPersona|strategicGoals|subAgents/);
});
test('Aura distinguishes canonical Skill Runtime from A2A package trust', () => {
  const source = read(path.join(runtimeRoot, 'src/components/JacoAuraComputeIDE.tsx'));
  assert.match(source, /Continuum Skill Runtime/);
  assert.match(source, /skillRuntime/);
  assert.match(source, /skillSource: skill\.source/);
  assert.match(source, /<SkillsView/);
  assert.match(source, /toolHint/);
});


test('the single canonical conversation stays mounted while contextual views change', () => {
  const source = read(path.join(runtimeRoot, 'src/components/JacoAuraComputeIDE.tsx'));
  const workspace = read(path.join(runtimeRoot, 'src/components/CognitiveWorkspace.tsx'));
  const css = read(path.join(runtimeRoot, 'src/cognitive-workspace.css'));
  assert.equal((source.match(/<AuraChatPanel/g)||[]).length,1);
  assert.match(source, /conversation=\{renderChatContent\(\)\}/);
  assert.match(workspace, /className="cognitive-conversation".*props\.conversation/);
  assert.match(workspace, /aria-label="Visa samtalet"/);
  assert.doesNotMatch(workspace, /hasCanvas&&.*cognitive-conversation/);
  // Mobile hides the conversation with CSS, preserving its draft and the controller.
  assert.match(css, /cognitive-main\[data-canvas=true\]>.cognitive-conversation \{ display:none;/);
});


test('Termux Aura production assets are served from RELEASE_ROOT, never WORKSPACE_ROOT', () => {
  const server = read(path.join(runtimeRoot, 'server.ts'));
  assert.match(server, /const RELEASE_ROOT = path\.resolve\(process\.env\.JACO_RELEASE_ROOT \|\| process\.cwd\(\)\)/);
  assert.match(server, /const distPath = path\.join\(RELEASE_ROOT, 'dist'\)/);
  assert.doesNotMatch(server, /const distPath = path\.join\(WORKSPACE_ROOT, 'dist'\)/);
  assert.match(server, /X-JACO-UI-ROOT/);
  assert.match(server, /Cache-Control', 'no-store, max-age=0'/);
});


test('the conversation is the initial workspace without a force-open URL', () => {
  const source = read(path.join(runtimeRoot, 'src/components/JacoAuraComputeIDE.tsx'));
  const workspace = read(path.join(runtimeRoot, 'src/components/CognitiveWorkspace.tsx'));
  assert.match(source, /useState<CognitiveCanvas>\('conversation'\)/);
  assert.match(workspace, /data-cognitive-workspace="true"/);
});
