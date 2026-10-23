import test from 'node:test';
import assert from 'node:assert/strict';
import { createGithubNovaControlInbox } from '../../agents/lib/github-control-inbox.mjs';

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return body == null ? '' : JSON.stringify(body); },
  };
}

test('GitHub control accepts an owner command and creates one durable Nova mission', async () => {
  const calls = [];
  const missions = new Map();
  const client = {
    async create(input) {
      calls.push(['create', input]);
      const mission = { id: 'mission-1', status: 'ACTIVE', phase: 'READY', turn: 0, failures: 0, receipts: [] };
      missions.set(mission.id, mission);
      return mission;
    },
    async get(id) { return missions.get(id); },
    async resolve() { throw new Error('unexpected'); },
  };

  const fetchImpl = async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'GET' && url.includes('/issues?')) {
      return response(200, [{
        number: 42,
        title: '[JACO NOVA] test command',
        user: { login: 'Rick84444' },
        body: '<!-- jaco-nova-control:v1 -->\n\`\`\`json\n' + JSON.stringify({
          schema: 'jaco.nova-control/v1',
          commandId: 'chatgpt-test-001',
          op: 'mission.create',
          goal: 'inspect repository state',
          allowedTasks: ['repo-list', 'repo-read', 'git-status'],
        }) + '\n\`\`\`',
      }]);
    }
    if (method === 'POST' && url.endsWith('/issues/42/comments')) return response(201, { id: 9001 });
    throw new Error('unexpected fetch ' + method + ' ' + url);
  };

  const inbox = createGithubNovaControlInbox({
    missionClient: client,
    fetchImpl,
    repo: 'Rick84444/jaco-code',
    token: 'token',
    actor: 'Rick84444',
    pollMs: 5000,
  });
  const state = {};
  const first = await inbox.poll(state, { force: true });
  assert.equal(first.accepted.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].source, 'github-control');
  assert.equal(calls[0][1].executor, 'nova');
  assert.match(calls[0][1].idempotencyKey, /#42:chatgpt-test-001$/);

  const second = await inbox.poll(state, { force: true });
  assert.equal(second.accepted.length, 0);
  assert.equal(calls.length, 1);
});

test('GitHub control ignores commands not authored by the configured operator', async () => {
  const client = {
    async create() { throw new Error('must not execute'); },
    async get() { throw new Error('must not execute'); },
    async resolve() { throw new Error('must not execute'); },
  };
  const fetchImpl = async url => {
    if (url.includes('/issues?')) {
      return response(200, [{
        number: 7,
        title: '[JACO NOVA] hostile',
        user: { login: 'someone-else' },
        body: '<!-- jaco-nova-control:v1 -->\n{}',
      }]);
    }
    throw new Error('unexpected');
  };
  const inbox = createGithubNovaControlInbox({
    missionClient: client,
    fetchImpl,
    repo: 'Rick84444/jaco-code',
    token: 'token',
    actor: 'Rick84444',
  });
  const result = await inbox.poll({}, { force: true });
  assert.deepEqual(result.accepted, []);
});

test('GitHub control can resolve a mission but cannot authorize spend', async () => {
  const resolved = [];
  const client = {
    async create() { throw new Error('unexpected'); },
    async get(id) { return { id, status: 'ACTIVE', phase: 'READY', turn: 3, failures: 0, receipts: [] }; },
    async resolve(id, input) {
      resolved.push({ id, input });
      return { id, status: 'ACTIVE', phase: 'READY', turn: 3, failures: 0, receipts: [] };
    },
  };
  let issueMode = 'valid';
  const comments = [];
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'GET' && url.includes('/issues?')) {
      const payload = issueMode === 'valid'
        ? { schema: 'jaco.nova-control/v1', commandId: 'chatgpt-resolve-001', op: 'mission.resolve', missionId: 'mission-9', decision: 'resume', note: 'continue after inspection' }
        : { schema: 'jaco.nova-control/v1', commandId: 'chatgpt-resolve-002', op: 'mission.resolve', missionId: 'mission-9', decision: 'resume', note: '[approve-spend] pay it' };
      return response(200, [{ number: issueMode === 'valid' ? 8 : 9, title: '[JACO NOVA] resolve', user: { login: 'Rick84444' }, body: '<!-- jaco-nova-control:v1 -->\n\`\`\`json\n' + JSON.stringify(payload) + '\n\`\`\`' }]);
    }
    if (method === 'POST' && url.includes('/comments')) {
      comments.push(JSON.parse(options.body).body);
      return response(201, { id: issueMode === 'valid' ? 8001 : 9001 });
    }
    if (method === 'PATCH' && url.includes('/issues/9')) return response(200, {});
    if (method === 'PATCH' && url.includes('/issues/comments/8001')) return response(200, {});
    throw new Error('unexpected fetch ' + method + ' ' + url);
  };

  const inbox = createGithubNovaControlInbox({
    missionClient: client,
    fetchImpl,
    repo: 'Rick84444/jaco-code',
    token: 'token',
    actor: 'Rick84444',
  });
  const state = {};
  await inbox.poll(state, { force: true });
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].id, 'mission-9');
  assert.match(resolved[0].input.note, /^github-control:/);

  issueMode = 'spend';
  await inbox.poll(state, { force: true });
  assert.equal(resolved.length, 1);
  assert.equal(comments.some(body => body.includes('SPEND_APPROVAL_NOT_ALLOWED')), true);
});

test('tracked GitHub control issue is updated from local durable mission state', async () => {
  const mission = { id: 'mission-2', status: 'DONE', phase: 'CLOSED', turn: 4, failures: 0, receipts: [{}, {}] };
  const patched = [];
  const client = {
    async create() { throw new Error('unexpected'); },
    async get() { return mission; },
    async resolve() { throw new Error('unexpected'); },
  };
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'GET' && url.includes('/issues?')) return response(200, []);
    if (method === 'PATCH' && url.includes('/issues/comments/77')) {
      patched.push(JSON.parse(options.body).body);
      return response(200, { id: 77 });
    }
    if (method === 'PATCH' && url.endsWith('/issues/12')) return response(200, { state: 'closed' });
    throw new Error('unexpected fetch ' + method + ' ' + url);
  };
  const inbox = createGithubNovaControlInbox({
    missionClient: client,
    fetchImpl,
    repo: 'Rick84444/jaco-code',
    token: 'token',
    actor: 'Rick84444',
  });
  const state = { githubControl: { lastPollAt: 0, lastError: null, issues: {
    '12': { commandId: 'cmd-12', op: 'mission.create', missionId: 'mission-2', commentId: 77, status: 'ACTIVE', phase: 'READY', closed: false },
  }}};
  const result = await inbox.poll(state, { force: true });
  assert.equal(result.updates[0].status, 'DONE');
  assert.equal(state.githubControl.issues['12'].closed, true);
  assert.equal(patched[0].includes('**DONE**'), true);
});


test('tokenless Nova control reads Git ref, creates one durable mission, and performs no REST requests', async () => {
  const creates = [];
  const gitCalls = [];
  let httpFetched = false;
  const client = {
    async create(input) {
      creates.push(input);
      return { id: 'mission-git-1', status: 'ACTIVE', phase: 'READY', turn: 0, failures: 0, receipts: [] };
    },
    async get(id) { return { id, status: 'ACTIVE', phase: 'READY', turn: 0, failures: 0, receipts: [] }; },
    async resolve() { throw new Error('unexpected'); },
  };
  const payload = {
    schema: 'jaco.nova-control/v1',
    commandId: 'android-observe-git-001',
    op: 'mission.create',
    goal: 'Observe Android status and screen without mutation',
    allowedTasks: ['android-status', 'android-observe'],
  };
  const gitExecImpl = async (file,args) => {
    gitCalls.push([file,...args]);
    if (args[2] === 'fetch') return { stdout:'', stderr:'' };
    if (args[2] === 'show') return { stdout:JSON.stringify(payload), stderr:'' };
    throw new Error('unexpected git op '+args.join(' '));
  };

  const inbox = createGithubNovaControlInbox({
    missionClient: client,
    fetchImpl: async () => { httpFetched = true; throw new Error('REST must not be used in tokenless git-ref mode'); },
    gitExecImpl,
    repoRoot: '/repo',
    repo: 'Rick84444/jaco-code',
    token: '',
    actor: 'Rick84444',
    pollMs: 5000,
  });
  assert.equal(inbox.enabled, true);
  assert.equal(inbox.transport, 'git-ref');
  assert.equal(inbox.writeback, 'git-ref-when-authorized');
  assert.equal(inbox.pollMs, 30000);

  const state = {};
  const first = await inbox.poll(state, { force: true });
  assert.equal(first.accepted.length, 1);
  assert.equal(first.accepted[0].transport, 'git-ref');
  assert.equal(creates.length, 1);
  assert.equal(creates[0].source, 'git-control');
  assert.match(creates[0].idempotencyKey,/^git-control:Rick84444\/jaco-code:android-observe-git-001$/);
  assert.deepEqual(creates[0].allowedTasks, ['android-status', 'android-observe']);
  assert.equal(httpFetched, false);
  assert.deepEqual(gitCalls[0],[
    'git','-C','/repo','fetch','--quiet','--no-tags','origin',
    '+refs/heads/jaco-control:refs/jaco/nova-control'
  ]);
  assert.deepEqual(gitCalls[1],[
    'git','-C','/repo','show','refs/jaco/nova-control:.jaco/nova-control.json'
  ]);
  assert.equal(state.githubControl.issues['git:android-observe-git-001'].missionId, 'mission-git-1');
  assert.equal(state.githubControl.issues['git:android-observe-git-001'].commentId, null);

  const second = await inbox.poll(state, { force: true });
  assert.equal(second.accepted.length, 0);
  assert.equal(creates.length, 1);
});

test('git-ref command rejected by mission validation is recorded once, not retried every poll', async () => {
  let creates = 0;
  const client = {
    async create() { creates += 1; throw new Error('INVALID_MISSION_ALLOWED_TASKS'); },
    async get() { throw new Error('unexpected'); },
    async resolve() { throw new Error('unexpected'); },
  };
  const payload = {
    schema: 'jaco.nova-control/v1',
    commandId: 'android-observe-rejected-001',
    op: 'mission.create',
    goal: 'Observe Android without mutation',
    allowedTasks: ['android-status', 'android-observe'],
  };
  const gitExecImpl = async (file, args) => {
    if (args[2] === 'fetch') return { stdout: '', stderr: '' };
    if (args[2] === 'show') return { stdout: JSON.stringify(payload), stderr: '' };
    throw new Error('unexpected git op ' + args.join(' '));
  };
  const inbox = createGithubNovaControlInbox({
    missionClient: client,
    fetchImpl: async () => { throw new Error('REST must not be used'); },
    gitExecImpl,
    repoRoot: '/repo',
    repo: 'Rick84444/jaco-code',
    token: '',
    actor: 'Rick84444',
  });

  const state = {};
  const first = await inbox.poll(state, { force: true });
  assert.equal(first.error, undefined);
  assert.equal(first.accepted.length, 0);
  const record = state.githubControl.issues['git:android-observe-rejected-001'];
  assert.equal(record.status, 'REJECTED');
  assert.equal(record.closed, true);
  assert.equal(record.error, 'INVALID_MISSION_ALLOWED_TASKS');

  const second = await inbox.poll(state, { force: true });
  assert.equal(second.error, undefined);
  assert.equal(creates, 1);
});

test('transient mission-control failure is still retried on the next poll', async () => {
  let creates = 0;
  const client = {
    async create() { creates += 1; throw new Error('fetch failed'); },
    async get() { throw new Error('unexpected'); },
    async resolve() { throw new Error('unexpected'); },
  };
  const payload = { schema: 'jaco.nova-control/v1', commandId: 'transient-001', op: 'mission.create', goal: 'Check health' };
  const gitExecImpl = async (file, args) => (args[2] === 'show' ? { stdout: JSON.stringify(payload) } : { stdout: '' });
  const inbox = createGithubNovaControlInbox({
    missionClient: client, gitExecImpl, repoRoot: '/repo', repo: 'Rick84444/jaco-code', token: '', actor: 'Rick84444',
  });
  const state = {};
  assert.equal((await inbox.poll(state, { force: true })).error, 'fetch failed');
  assert.equal((await inbox.poll(state, { force: true })).error, 'fetch failed');
  assert.equal(creates, 2);
  assert.equal(state.githubControl.issues['git:transient-001'], undefined);
});


test('forced Git-only mode never calls REST even if a GH token is configured', async () => {
  const calls=[];
  let restCalled=false;
  const inbox=createGithubNovaControlInbox({
    missionClient:{
      async create(input) {calls.push(input);return {id:'mission-tokenless',status:'ACTIVE',phase:'READY',turn:0,failures:0,receipts:[]};},
      async get() {return {id:'mission-tokenless',status:'ACTIVE',phase:'READY',turn:0,failures:0,receipts:[]};},
      async resolve() {throw Error('unexpected');},
    },
    repo:'Rick84444/JACO-CODE',
    token:'preexisting-gh-token-do-not-use',
    transportMode:'git-ref',
    actor:'Rick84444',
    repoRoot:'/repo',
    gitExecImpl:async (file,args)=>{
      if(args[2]==='fetch') return {stdout:'',stderr:''};
      if(args[2]==='show') return {stdout:JSON.stringify({
        schema:'jaco.nova-control/v1',
        commandId:'forced-git-only-001',
        op:'mission.create',
        goal:'Check local status safely',
        allowedTasks:['git-status'],
      }),stderr:''};
      throw Error('Git receipt push unavailable in this fixture');
    },
    fetchImpl:async ()=>{restCalled=true;throw Error('REST MUST NOT BE USED');},
  });
  assert.equal(inbox.transport,'git-ref');
  assert.equal(inbox.writeback,'git-ref-when-authorized');
  const result=await inbox.poll({}, {force:true});
  assert.equal(restCalled,false);
  assert.equal(result.accepted.length,1);
  assert.equal(calls.length,1);
  assert.equal(calls[0].executor,'nova');
  assert.equal(result.statusReceipt.error,'GIT_CONTROL_STATUS_PUSH_UNAVAILABLE');
});
