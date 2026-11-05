import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuraSourceInspector } from '../../runtime/src/server/connected/auraSourceInspector.mjs';
import { cognitiveQuestionToolbox } from '../../runtime/src/server/connected/cognitiveQuestionToolbox.mjs';
import { buildAuraSeerPrompts } from '../../agents/lib/aura-seer-chat.mjs';

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-self-inspect-'));
  const root = path.join(base, 'JACO-CODE');
  const other = path.join(base, 'selected-customer-project');
  fs.mkdirSync(path.join(root, 'runtime'), { recursive: true });
  fs.mkdirSync(path.join(root, 'agents', 'lib'), { recursive: true });
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"jaco"}');
  fs.writeFileSync(path.join(root, 'README.md'), 'JACO self development');
  fs.writeFileSync(path.join(root, 'runtime', 'server.ts'), '// JACO runtime\n' + 'x'.repeat(50_000) + '\nsource_inspection_works\n');
  fs.writeFileSync(path.join(root, 'agents', 'lib', 'aura-seer-chat.mjs'), 'export const hello = true;\n');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=must-not-leak');
  fs.writeFileSync(path.join(root, 'runtime', 'secret-token.mjs'), 'DO_NOT_DISCLOSE');
  fs.writeFileSync(path.join(other, 'customer.txt'), 'customer private information');
  return { base, root, other };
}

test('Aura can inspect JACO source independently of the selected project, without write grants', t => {
  const { base, root, other } = fixture();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const inspect = createAuraSourceInspector({ candidateRoots: [other, root] });
  const status = inspect();
  assert.equal(status.available, true);
  assert.equal(status.readOnly, true);
  assert.equal(status.independentOfSelectedWorkspace, true);
  assert.equal(status.writesAuthorized, false);
  assert.deepEqual(inspect({action:'list',path:'.'}).entries.sort(), ['README.md', 'agents/', 'package.json', 'runtime/']);
  assert.ok(!inspect({action:'list',path:'runtime'}).entries.includes('secret-token.mjs'));
  assert.match(inspect({action:'read',path:'agents/lib/aura-seer-chat.mjs'}).content, /hello/);
  const page = inspect({action:'read',path:'runtime/server.ts',offset:50000,limit:200});
  assert.equal(page.offset, 50000);
  assert.match(page.content, /source_inspection_works/);
  const results = inspect({action:'search',path:'runtime',query:'source_inspection_works'});
  assert.equal(results.matches[0].path, 'runtime/server.ts');
  assert.equal(results.matches[0].line, 3);
});

test('Aura self-inspection denies outside paths, symlinks, secrets and mutations', t => {
  const { base, root, other } = fixture();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const inspect = createAuraSourceInspector({ candidateRoots: [root] });
  for (const requestedPath of ['../selected-customer-project/customer.txt', '/etc/passwd', '.env', 'runtime/secret-token.mjs', 'runtime/node_modules/a.js', 'packaging/setup.nsi']) {
    assert.throws(() => inspect({action:'read',path:requestedPath}), /JACO_SOURCE_/);
  }
  assert.throws(() => inspect({action:'modify',path:'runtime/server.ts'}), /JACO_SOURCE_ACTION_UNSUPPORTED/);
  assert.throws(() => inspect({action:'search',path:'.',query:'x'}), /JACO_SOURCE_QUERY_INVALID/);
  try {
    fs.symlinkSync(path.join(other, 'customer.txt'), path.join(root, 'runtime', 'linked.ts'));
    assert.throws(() => inspect({action:'read',path:'runtime/linked.ts'}), /JACO_SOURCE_SYMLINK_REFUSED/);
    assert.ok(!inspect({action:'list',path:'runtime'}).entries.includes('linked.ts'));
  } catch (e) {
    if (e.code !== 'EPERM' && e.code !== 'EACCES' && e.code !== 'ENOTSUP') throw e;
  }
});

test('missing JACO checkout reports unavailable rather than asserting own code cannot be inspected universally', t => {
  const { base, other } = fixture();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const inspect = createAuraSourceInspector({ candidateRoots: [other] });
  assert.equal(inspect().available, false);
  assert.equal(inspect().source, 'JACO_SOURCE_CHECKOUT_NOT_AVAILABLE');
  assert.throws(() => inspect({action:'list'}), /JACO_SOURCE_CHECKOUT_NOT_AVAILABLE/);
});

test('Manual and Planning allow source reading but never add write authority', () => {
  const toolbox = cognitiveQuestionToolbox({observe:async()=>null,tools:{
    jaco_source:{description:'read JACO code',run: async()=>({available:true})},
    start_goal:{description:'write mission',run:async()=>{throw Error('must never execute')}},
    repo_read:{description:'project read',run:async()=> 'ok'},
  }},()=>({events:[]}));
  assert.ok('jaco_source' in toolbox.tools);
  assert.ok('repo_read' in toolbox.tools);
  assert.ok(!('start_goal' in toolbox.tools));
  const prompt = buildAuraSeerPrompts({message:'Kan du analysera din egen JACO-kod?', chatMode:'manual'});
  assert.match(prompt.system, /jaco_source status/);
  assert.match(prompt.system, /model's proprietary weights/);
  assert.match(prompt.system, /explicit, authorized mission/);
  assert.match(prompt.system, /RUN_MODE: MANUAL/);
});
