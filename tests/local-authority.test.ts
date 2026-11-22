import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalAuthority } from '../src/app/local-authority';

test('local authority owns transitions, history, semantic events, and injected randomness', () => {
  const authority = new LocalAuthority(undefined, () => 0);

  assert.equal(authority.transition({ type: 'resolveOpening', attempts: [[6, 1]] }).ok, true);
  const started = authority.transition({ type: 'beginRoll' });
  assert.equal(started.ok, true);
  assert.deepEqual(authority.movementRoll(), [1, 1]);
  const rolled = authority.transition({ type: 'receiveRoll', values: [6, 1] });
  assert.equal(rolled.ok, true);
  assert.equal(authority.state.active, 0);
  assert.equal(rolled.ok && rolled.events.some((event) => event.type === 'MovesAvailable'), true);

  authority.reset();
  assert.equal(authority.state.phase, 'OPENING');
  assert.deepEqual(authority.movementRoll(), [1, 1]);
  assert.equal(authority.canUndo, false);
});

test('local authority adopts snapshots without retaining incompatible history', () => {
  const authority = new LocalAuthority();
  const state = structuredClone(authority.state);
  state.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  state.phase = 'WAITING_FOR_MOVE';
  state.roll = [2, 3];
  state.remaining = [2, 3];
  authority.adopt(state);

  const moved = authority.transition({
    type: 'move',
    sequence: [{ from: 0, to: 2, die: 2 }],
  });
  assert.equal(moved.ok, true);
  assert.equal(authority.canUndo, true);
  authority.adopt(authority.state);
  assert.equal(authority.canUndo, false);
});
