import test from 'node:test';
import assert from 'node:assert/strict';
import { GameController } from '../src/app/game-controller';
import { createGameplayActions, type ActionScene } from '../src/app/gameplay-actions';
import { resolvedOpeningState } from './support/resolved-opening';

test('local actions sequence roll, move, animation completion, undo, and restart', () => {
  const controller = new GameController();

  controller.adopt(resolvedOpeningState(), false);

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
  const actions = createGameplayActions(controller, scene, {
    reset: () => diceResets++,
    play() {},
    playOpening() {},
  });

  setup = true;
  assert.equal(actions.beginRoll(), false);
  setup = false;
  assert.equal(actions.beginRoll(), true);
  actions.receiveRoll([2, 3]);

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
  assert.equal(controller.state.phase, 'WAITING_FOR_ROLL');
  assert.equal(controller.state.opening.status, 'RESOLVED');
  assert.equal(
    controller.state.opening.status === 'RESOLVED' && controller.state.opening.attempts.length > 0,
    true,
  );
  assert.equal(diceResets, 1);
  assert.equal(setup, true);
});

test('interrupted local animation releases the move lock before a late callback', () => {
  const controller = new GameController();

  controller.adopt(resolvedOpeningState(), false);

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
  const actions = createGameplayActions(controller, scene, {
    reset() {},
    play() {},
    playOpening() {},
  });

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
