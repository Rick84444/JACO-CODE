import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readAuraResponse, acknowledgeSavedDraft, observedMoney } from '../../runtime/src/lib/auraApi.mjs';
import { ideHost, createIdeRemoteGate } from '../../runtime/src/server/connected/ideAccess.mjs';

test('structured API errors and invalid successful bodies do not become GUI success', async () => {
  await assert.rejects(readAuraResponse(new Response(JSON.stringify({ error: { code: 'CONFLICT', message: 'File changed' } }), { status: 409 })), /CONFLICT: File changed/);
  await assert.rejects(readAuraResponse(new Response('<html>bad gateway</html>', { status: 200 })), /API_INVALID_JSON/);
  await assert.rejects(readAuraResponse(new Response('null')), /API_INVALID_RESPONSE/);
  await assert.rejects(readAuraResponse(new Response(JSON.stringify({ success: false, error: { code: 'DENIED' } }))), /DENIED/);
  assert.deepEqual(await readAuraResponse(new Response('{"success":true,"value":0}')), { success: true, value: 0 });
});
test('late save preserves newer draft while exact saved draft is acknowledged', () => {
  const drafts = { 'file.txt': 'newer text', 'other.txt': 'keep' };
  assert.equal(acknowledgeSavedDraft(drafts, { path: 'file.txt', content: 'submitted text' }), drafts);
  assert.deepEqual(acknowledgeSavedDraft(drafts, { path: 'file.txt', content: 'newer text' }), { 'other.txt': 'keep' });
});
test('unobserved revenue is distinct from an observed empty balance', () => {
  assert.equal(observedMoney(undefined), 'Ej observerat');
  assert.equal(observedMoney({ USD: NaN }), 'Ej observerat');
  assert.equal(observedMoney({}), '0');
  assert.match(observedMoney({ USD: 12 }), /12.*USD/);
});
test('remote IDE has no personal hostname default and fails closed without configured host', () => {
  assert.equal(ideHost({}), '');
  assert.equal(ideHost({ JACO_IDE_PUBLIC_HOST: 'ide.customer.example' }), 'ide.customer.example');
  const gate = createIdeRemoteGate({ verify: () => { throw Error('must not verify on unknown host'); }, redeem: () => null }, { env: {} });
  let status, body;
  const response = { status(value) { status = value; return this; }, json(value) { body = value; return this; } };
  gate({ headers: { host: 'ide.customer.example', 'x-forwarded-for': '198.51.100.1' }, path: '/' }, response, () => assert.fail('Unconfigured host allowed'));
  assert.equal(status, 403); assert.equal(body.error, 'HOST_NOT_SERVED');
});
// Operator 2026-10-11: one live conversation, with code and evidence opened when needed.
test('active GUI keeps one conversation controller while contextual workspaces change', () => {
  const root = new URL('../../runtime/src/', import.meta.url);
  const read = path => fs.readFileSync(new URL(path, root), 'utf8');
  const ide = read('components/JacoAuraComputeIDE.tsx');
  assert.match(ide, /session=\{chatSession\}/);
  assert.match(ide, /useState<CognitiveCanvas>\('conversation'\)/);
  assert.match(ide, /conversation=\{renderChatContent\(\)\}/);
  const workspace = read('components/CognitiveWorkspace.tsx');
  assert.match(workspace, /className="cognitive-conversation"/);
  assert.match(workspace, /props\.conversation/);
  assert.doesNotMatch(workspace, /hasCanvas&&.*cognitive-conversation/);
  assert.doesNotMatch(ide, />Conversation<\/button>/);
  assert.doesNotMatch(ide, /data-aura-primary-conversation/);
  // The chat shows the conversation; budget and provider settings sit behind its settings button.
  const chat = read('components/AuraChatPanel.tsx');
  assert.match(chat, /aria-label=\{tr\('Chattinställningar',\s*'Chat settings'\)\}/);
  assert.match(chat, /\{showSettings && \(/);
  assert.doesNotMatch(chat, /arbetsuppdatering/);
  assert.doesNotMatch(ide, /initialFileSelected/);
  assert.doesNotMatch(ide, /hidden lg:flex lg:h-auto lg:w-\[360px\].*Aura \/ SEER chat/s);
  assert.doesNotMatch(read('components/AuraChatPanel.tsx'), /Aura is connected to SEER|VERIFIED RUNTIME EVENTS/);
  assert.doesNotMatch(read('components/DevicesView.tsx'), /ide\.jacocode\.com|<hub-url>/);
  assert.doesNotMatch(read('components/RevenueView.tsx'), /No charge has ever been made/);
  assert.doesNotMatch(read('App.tsx'), /pb-10/);
});
