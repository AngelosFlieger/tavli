import test from 'node:test';
import assert from 'node:assert/strict';
import { InteractionController } from '../src/app/interaction-controller';
import { initialGameState } from '../src/game/session/state';

test('interaction controller owns operation lifetime independently of authority state', () => {
  const interaction = new InteractionController();
  interaction.start({ type: 'ROLL', authority: 'LOCAL', forced: [2, 5] });

  assert.equal(interaction.busy, true);
  assert.deepEqual(interaction.takeForcedLocalRoll(), [2, 5]);
  assert.equal(interaction.takeForcedLocalRoll(), null);
  assert.equal(interaction.busy, true);

  interaction.finish();
  assert.equal(interaction.busy, false);
});

test('interaction adoption invalidates caches and clears or revalidates held checkers', () => {
  const interaction = new InteractionController();
  const state = initialGameState();
  state.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  state.phase = 'WAITING_FOR_MOVE';
  state.roll = [2, 3];
  state.remaining = [2, 3];

  assert.ok(interaction.moves(state).length > 0);
  assert.equal(interaction.pickAt(0, state, true), 14);
  assert.deepEqual(interaction.pickup.items, [14]);

  interaction.adopt(state, true);
  assert.deepEqual(interaction.pickup.items, [14]);
  const changed = structuredClone(state);
  changed.remaining = [];
  interaction.adopt(changed, true);
  assert.deepEqual(interaction.pickup.items, []);
});
