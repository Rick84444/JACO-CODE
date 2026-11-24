import test from 'node:test';
import assert from 'node:assert/strict';
import { mountDeviceRoutes } from '../../runtime/src/server/connected/deviceAccess.mjs';

// The routes as the registry mounts them: a fake app that keeps each handler.
function mount() {
  const routes = new Map();
  const app = { get: (p, ...h) => routes.set(`GET ${p}`, h), post: (p, ...h) => routes.set(`POST ${p}`, h), delete: (p, ...h) => routes.set(`DELETE ${p}`, h) };
  const invites = [];
  const registry = { invite: (name, kind) => { invites.push([name, kind]); return { name, kind, code: 'ABCDE-FGHJK' }; }, list: () => [], revoke: () => ({}) };
  mountDeviceRoutes(app, (_req, _res, next) => next(), {}, registry);
  return { handler: routes.get('POST /api/connected/devices/invite').at(-1), invites };
}
const response = () => { const r = { code: 200, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };

test('a pairing code is created on this computer, never by a phone that is already paired', () => {
  const { handler, invites } = mount();
  const refused = response();
  handler({ ideSession: { name: 'phone-abc' }, body: { name: 'second-phone', kind: 'ide' } }, refused);
  assert.equal(refused.code, 403);
  assert.equal(refused.body.error, 'DEVICE_INVITE_LOCAL_ONLY');
  assert.equal(invites.length, 0, 'nothing was created');
  const allowed = response();
  handler({ body: { name: 'my-phone', kind: 'ide' } }, allowed);
  assert.equal(allowed.code, 200);
  assert.deepEqual(invites, [['my-phone', 'ide']]);
});
