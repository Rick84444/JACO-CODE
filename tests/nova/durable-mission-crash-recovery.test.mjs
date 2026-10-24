import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-crash-recovery-'));
  const buses = [];
  t.after(() => {
    for (const bus of buses) bus.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const open = () => {
    const bus = new DurableMissionBus(root);
    buses.push(bus);
    return bus;
  };
  return { root, open, bus: open() };
}

function enqueue(bus, capability = 'external.write', maxAttempts = 3) {
  const mission = bus.createMission({ goal: 'Verify crash recovery' });
  const ticket = bus.enqueueTicket({ missionId: mission.id, capability, title: 'One bounded task', maxAttempts });
  return { mission, ticket };
}

function claim(bus, ticket, worker = 'worker-a') {
  bus.registerWorker(worker, [ticket.capability]);
  const lease = bus.claimNext(worker, [ticket.capability], 60_000);
  assert.equal(lease?.id, ticket.id);
  return lease;
}

function expire(bus, ticketId) {
  bus.db.prepare('UPDATE tickets SET lease_expires_at=? WHERE id=?')
    .run('2000-01-01T00:00:00.000Z', ticketId);
}

test('a crash before start safely requeues a claimed ticket without performing work', t => {
  const { open, bus } = fixture(t);
  const { ticket } = enqueue(bus);
  const first = claim(bus, ticket);
  assert.equal(first.status, 'CLAIMED');
  expire(bus, ticket.id);
  bus.close();

  const restarted = open();
  assert.equal(restarted.getTicket(ticket.id).status, 'READY');
  assert.equal(restarted.listEvents().filter(e => e.type === 'LEASE_EXPIRED_REQUEUED').length, 1);
  const retry = claim(restarted, ticket, 'worker-b');
  assert.equal(retry.attempts, 2);
  assert.throws(() => restarted.start(ticket.id, 'worker-a', first.leaseToken), /LEASE_MISMATCH/);
});

test('a crash after an external side effect quarantines the task and never runs it twice', t => {
  const { root, open, bus } = fixture(t);
  const { mission, ticket } = enqueue(bus);
  const first = claim(bus, ticket);
  bus.start(ticket.id, 'worker-a', first.leaseToken);
  const externalEffect = path.join(root, 'external-effect.log');
  fs.appendFileSync(externalEffect, 'effect\n');
  expire(bus, ticket.id);
  bus.close();

  const restarted = open();
  assert.equal(restarted.getTicket(ticket.id).status, 'OUTCOME_UNKNOWN');
  assert.equal(restarted.getMission(mission.id).status, 'BLOCKED');
  assert.equal(restarted.listEvents().filter(e => e.type === 'LEASE_EXPIRED_OUTCOME_UNKNOWN').length, 1);
  restarted.registerWorker('worker-b', [ticket.capability]);
  assert.equal(restarted.claimNext('worker-b', [ticket.capability]), null);
  assert.equal(fs.readFileSync(externalEffect, 'utf8'), 'effect\n');
  assert.throws(() => restarted.complete(ticket.id, 'worker-a', first.leaseToken,
    { evidence: [{ source: 'tool' }] }), /LEASE_MISMATCH/);
});

test('lost lease during verification is never automatically replayed', t => {
  const { bus } = fixture(t);
  const { mission, ticket } = enqueue(bus, 'a2a.discover');
  const lease = claim(bus, ticket);
  bus.start(ticket.id, 'worker-a', lease.leaseToken);
  bus.db.prepare('UPDATE tickets SET status=? WHERE id=?').run('VERIFYING', ticket.id);
  expire(bus, ticket.id);
  assert.equal(bus.requeueExpiredLeases(), 1);
  assert.equal(bus.getTicket(ticket.id).status, 'OUTCOME_UNKNOWN');
  assert.equal(bus.getMission(mission.id).status, 'BLOCKED');
});

test('audited read-only discovery may recover automatically after a crash', t => {
  const { open, bus } = fixture(t);
  const { ticket } = enqueue(bus, 'a2a.discover');
  const lease = claim(bus, ticket);
  bus.start(ticket.id, 'worker-a', lease.leaseToken);
  expire(bus, ticket.id);
  bus.close();
  const restarted = open();
  assert.equal(restarted.getTicket(ticket.id).status, 'READY');
  assert.equal(claim(restarted, ticket, 'worker-b').attempts, 2);
});

test('a worker failure after starting a mutating task requires reconciliation, even when retry was requested', t => {
  const { bus } = fixture(t);
  const { mission, ticket } = enqueue(bus, 'wordpress.update');
  const lease = claim(bus, ticket);
  bus.start(ticket.id, 'worker-a', lease.leaseToken);
  const failed = bus.fail(ticket.id, 'worker-a', lease.leaseToken, 'CONNECTION_LOST_AFTER_POST', { retry: true });
  assert.equal(failed.status, 'OUTCOME_UNKNOWN');
  assert.equal(bus.getMission(mission.id).status, 'BLOCKED');
  assert.equal(bus.listEvents().filter(e => e.type === 'TICKET_RETRY').length, 0);
  assert.equal(bus.listEvents().filter(e => e.type === 'TICKET_OUTCOME_UNKNOWN').length, 1);
});

test('an operator can reconcile an observed completion without repeating the action', t => {
  const { bus } = fixture(t);
  const { mission, ticket } = enqueue(bus, 'external.write');
  const lease = claim(bus, ticket);
  bus.start(ticket.id, 'worker-a', lease.leaseToken);
  expire(bus, ticket.id);
  bus.requeueExpiredLeases();
  assert.throws(() => bus.reconcileUnknownOutcome(ticket.id, {
    decision: 'COMPLETED', reason: 'I checked the external target.'
  }), /RECONCILIATION_EVIDENCE_REQUIRED/);
  const done = bus.reconcileUnknownOutcome(ticket.id, {
    decision: 'COMPLETED',
    reason: 'I inspected the destination and confirmed the write.',
    evidence: [{ source: 'external-system', reference: 'verification-123' }],
    result: { externalId: 'verification-123' }
  });
  assert.equal(done.status, 'DONE');
  assert.equal(done.result.reconciliation, 'OPERATOR_ATTESTED');
  assert.equal(bus.getMission(mission.id).status, 'DONE');
  assert.throws(() => bus.reconcileUnknownOutcome(ticket.id, {
    decision: 'COMPLETED', reason: 'The same external check', evidence: ['x']
  }), /TICKET_OUTCOME_NOT_UNKNOWN/);
});

test('operator-confirmed no-effect permits an explicit retry, while unrelated tickets stay blocked beforehand', t => {
  const { bus } = fixture(t);
  const { mission, ticket } = enqueue(bus, 'a2a.outbound');
  const dependent = bus.enqueueTicket({
    missionId: mission.id, capability: 'aura.reason', title: 'Dependent analysis', dependsOn: [ticket.id]
  });
  const lease = claim(bus, ticket);
  bus.start(ticket.id, 'worker-a', lease.leaseToken);
  expire(bus, ticket.id);
  bus.requeueExpiredLeases();
  bus.registerWorker('worker-b', [ticket.capability, dependent.capability]);
  assert.equal(bus.claimNext('worker-b', [ticket.capability, dependent.capability]), null);
  const ready = bus.reconcileUnknownOutcome(ticket.id, {
    decision: 'NO_EFFECT', reason: 'External task ID is absent in the remote system.',
    evidence: [{ source: 'remote-task-lookup', exists: false }]
  });
  assert.equal(ready.status, 'READY');
  assert.equal(bus.getMission(mission.id).status, 'ACTIVE');
  assert.equal(claim(bus, ticket, 'worker-b').attempts, 2);
});

test('retry limits are respected after a claimed task expires', t => {
  const { bus } = fixture(t);
  const { mission, ticket } = enqueue(bus, 'external.write', 1);
  claim(bus, ticket);
  expire(bus, ticket.id);
  bus.requeueExpiredLeases();
  assert.equal(bus.getTicket(ticket.id).status, 'FAILED');
  assert.equal(bus.getMission(mission.id).status, 'FAILED');
  assert.equal(bus.claimNext('worker-a', [ticket.capability]), null);
});
