import test from 'node:test';
import assert from 'node:assert/strict';
import { GameController } from '../src/app/game-controller';
import { createGameplayActions, type ActionScene } from '../src/app/gameplay-actions';

test('local actions sequence roll, move, animation completion, undo, and restart', () => {
  const controller = new GameController();
  let setup = false;
  let moveDone = () => {};
  let animations = 0;
  let diceResets = 0;
  const scene: ActionScene = {
    isSetupActive: () => setup,
    refresh() {},
    startSetup() {
      setup = true;
    },
    playLocalMove(_sequence, _request, done) {
      animations++;
      moveDone = done;
    },
  };
  const actions = createGameplayActions(controller, scene, { reset: () => diceResets++ });
  setup = true;
  assert.equal(actions.beginRoll(), false);
  setup = false;
  for (const values of [
    [6, 6],
    [1, 1],
    [2, 3],
  ]) {
    assert.equal(actions.beginRoll(), true);
    actions.receiveRoll(values);
  }
  const before = structuredClone(controller.state);
  const move = controller.moves()[0];
  actions.move([move]);
  assert.equal(animations, 1);
  assert.equal(controller.busy, true);
  assert.notDeepEqual(controller.state.board, before.board);
  actions.undo();
  assert.notDeepEqual(controller.state.board, before.board);
  moveDone();
  assert.equal(controller.busy, false);
  actions.undo();
  assert.deepEqual(controller.state, before);
  actions.restart();
  assert.equal(controller.state.phase, 'OPENING_ROLL');
  assert.equal(diceResets, 1);
  assert.equal(setup, true);
});

test('interrupted local animation releases the move lock before a late callback', () => {
  const controller = new GameController();
  let done = () => {};
  let refreshes = 0;
  const scene: ActionScene = {
    isSetupActive: () => false,
    refresh: () => refreshes++,
    startSetup() {},
    playLocalMove(_sequence, _request, complete) {
      done = complete;
    },
  };
  const actions = createGameplayActions(controller, scene, { reset() {} });
  actions.beginRoll();
  actions.receiveRoll([6, 6]);
  actions.beginRoll();
  actions.receiveRoll([1, 1]);
  actions.beginRoll();
  actions.receiveRoll([2, 3]);
  actions.move([controller.moves()[0]]);
  assert.equal(controller.busy, true);
  actions.finishInterruptedMove();
  assert.equal(controller.busy, false);
  const afterInterruption = refreshes;
  done();
  assert.equal(refreshes, afterInterruption);
});
