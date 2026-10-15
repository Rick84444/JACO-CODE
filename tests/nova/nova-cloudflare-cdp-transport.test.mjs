import test from 'node:test';
import assert from 'node:assert/strict';

const previous = {
  JACO_NOVA_TRANSPORT: process.env.JACO_NOVA_TRANSPORT,
  NOVA_BRIDGE_URL: process.env.NOVA_BRIDGE_URL,
};
process.env.JACO_NOVA_TRANSPORT = 'gateway';
process.env.NOVA_BRIDGE_URL = 'https://api.mimirpower.com';

const { novaTransportPath, normalizeNovaTransportResult } = await import('../../agents/hands-off-agent.mjs');

test.after(() => {
  if (previous.JACO_NOVA_TRANSPORT == null) delete process.env.JACO_NOVA_TRANSPORT;
  else process.env.JACO_NOVA_TRANSPORT = previous.JACO_NOVA_TRANSPORT;
  if (previous.NOVA_BRIDGE_URL == null) delete process.env.NOVA_BRIDGE_URL;
  else process.env.NOVA_BRIDGE_URL = previous.NOVA_BRIDGE_URL;
});

test('gateway transport maps browser operations onto public Nova gateway routes', () => {
  assert.equal(novaTransportPath('/health', 'gateway'), '/health');
  assert.equal(novaTransportPath('/targets', 'gateway'), '/v1/nova/targets');
  assert.equal(novaTransportPath('/observe', 'gateway'), '/v1/nova/observe');
  assert.equal(novaTransportPath('/navigate', 'gateway'), '/v1/nova/navigate');
  assert.equal(novaTransportPath('/click', 'gateway'), '/v1/nova/click');
  assert.equal(novaTransportPath('/type', 'gateway'), '/v1/nova/type');
  assert.equal(novaTransportPath('/survey', 'gateway'), '/v1/nova/survey');
});

test('gateway transport unwraps Nova receipts while preserving health truth', () => {
  assert.deepEqual(
    normalizeNovaTransportResult('/observe', {
      ok: true,
      requestId: 'req-1',
      result: { ok: true, observed: true, title: 'ChatGPT' },
    }, 'gateway'),
    { ok: true, observed: true, title: 'ChatGPT' },
  );

  assert.deepEqual(
    normalizeNovaTransportResult('/health', {
      ok: true,
      service: 'jaco-chatgpt-nova-gateway',
      nova: { ok: true, service: 'nova-bridge', cdpPort: 9222 },
      seer: { ok: true },
    }, 'gateway'),
    {
      ok: true,
      service: 'nova-bridge',
      cdpPort: 9222,
      gateway: true,
      gatewayService: 'jaco-chatgpt-nova-gateway',
      seer: { ok: true },
    },
  );
});

test('direct transport remains backward compatible', () => {
  assert.equal(novaTransportPath('/observe', 'direct'), '/observe');
  const receipt = { ok: true, observed: true };
  assert.equal(normalizeNovaTransportResult('/observe', receipt, 'direct'), receipt);
});
