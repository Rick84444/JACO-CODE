import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentCard, hubDeviceLinked, joinWorkplace } from '../../agents/lib/workplace-session.mjs';

const device = { JACO_HUB_URL: 'https://api.jacocode.com', JACO_DEVICE_KEY: 'jdev_device_token_test' };

test('device credentials link a machine to its Hub unless the machine is the Hub', () => {
  assert.equal(hubDeviceLinked(device), true);
  assert.equal(hubDeviceLinked({ ...device, JACO_NODE_ROLE: 'hub' }), false);
  assert.equal(hubDeviceLinked({ ...device, JACO_NODE_ROLE: 'device' }), true);
  assert.equal(hubDeviceLinked({ JACO_HUB_URL: device.JACO_HUB_URL }), false);
});

test('the Hub joins its own Workplace even when leftover device credentials are configured', async () => {
  const calls = [];
  const bootstrap = async (_card, options) => {
    calls.push(options);
    return {
      client: { cursor: 0, sessionId: 'session-test', end: async () => null },
      registration: { agentId: 'agent:test', sessionId: 'session-test' },
      sync: { events: [], decisions: [] },
    };
  };
  const card = buildAgentCard({ stableId: 'hub-role-test', name: 'Hub role test', agentType: 'runtime', role: 'test', description: 'test' });
  const env = { ...device, JACO_NODE_ROLE: 'hub', JACO_WORKPLACE_URL: 'http://127.0.0.1:2995', JACO_WORKPLACE_TOKEN: 'local-workplace-test-token' };
  const session = await joinWorkplace({ card, env, bootstrap });
  assert.equal(session.state, 'READY');
  assert.equal(calls[0].baseUrl, env.JACO_WORKPLACE_URL);
  assert.equal(calls[0].token, env.JACO_WORKPLACE_TOKEN);
  await session.end();
});
