import test from 'node:test';
import assert from 'node:assert/strict';
import { PresentationCoordinator } from '../src/app/presentation-coordinator';

test('presentation tickets cannot complete a newer presentation', () => {
  const coordinator = new PresentationCoordinator();
  const dice = coordinator.begin('DICE');
  const move = coordinator.begin('REMOTE_MOVE');

  assert.equal(coordinator.complete(dice), false);
  assert.equal(coordinator.blocking, true);
  assert.equal(coordinator.kind, 'REMOTE_MOVE');
  assert.equal(coordinator.complete(move), true);
  assert.equal(coordinator.blocking, false);
});

test('cancel invalidates an outstanding presentation ticket', () => {
  const coordinator = new PresentationCoordinator();
  const ticket = coordinator.begin('DICE');

  coordinator.cancel();

  assert.equal(coordinator.blocking, false);
  assert.equal(coordinator.complete(ticket), false);
});
