import test from 'node:test';
import assert from 'node:assert/strict';
import { GameController } from '../src/app/game-controller';
import {
  createOnlineGameFlow,
  type OnlineDice,
  type OnlineScene,
} from '../src/app/online-game-flow';
import type { Move } from '../src/game/engine';

test('online flow presents authoritative rolls and moves before adopting them', () => {
  const controller = new GameController();
  const calls: string[] = [];
  let completeMove = () => {};
  const scene: OnlineScene = {
    faceSeat: () => calls.push('face'),
    presentState: (resetDice) => calls.push(resetDice ? 'present-reset' : 'present'),
    playRemoteMove: (_sequence: Move[], checker: number, done: () => void) => {
      calls.push(`animate-${checker}`);
      completeMove = done;
    },
  };
  const dice: OnlineDice = {
    play: (values) => calls.push(`dice-${values.join('-')}`),
    reset: () => calls.push('dice-reset'),
  };
  const flow = createOnlineGameFlow(controller, scene, dice);
  flow.join(0, () => {}, controller.state);
  assert.deepEqual(calls, ['face', 'present', 'dice-reset']);
  assert.equal(controller.seat, 0);

  const rolled = structuredClone(controller.state);
  rolled.active = 1;
  flow.receive({ state: rolled, canUndo: false, dice: [2, 3] });
  assert.equal(controller.state.active, 0);
  assert.equal(controller.busy, false);
  assert.equal(calls.at(-1), 'dice-2-3');
  flow.presentedRoll();
  assert.equal(controller.state.active, 1);

  const ready = structuredClone(controller.state);
  ready.active = 0;
  ready.opening = false;
  ready.phase = 'WAITING_FOR_MOVE';
  ready.remaining = [2];
  flow.receive({ state: ready, canUndo: false });
  const moved = structuredClone(ready);
  moved.board[2] = [moved.board[0].pop()!];
  moved.remaining = [];
  moved.phase = 'TURN_COMPLETE';
  flow.receive({
    state: moved,
    canUndo: true,
    sequence: [{ from: 0, to: 2, die: 2 }],
  });
  assert.equal(controller.busy, true);
  assert.deepEqual(controller.state.board[2], []);
  assert.equal(calls.at(-1), 'animate-14');
  completeMove();
  assert.deepEqual(controller.state.board[2], [14]);
  assert.equal(controller.state.phase, 'TURN_COMPLETE');
  assert.equal(controller.busy, false);
  assert.equal(controller.canUndo, true);

  flow.receive({ state: controller.state, canUndo: false, resetDice: true });
  assert.deepEqual(calls.slice(-2), ['dice-reset', 'present-reset']);
  flow.leave();
  assert.equal(controller.seat, null);
  assert.equal(controller.state.phase, 'OPENING_ROLL');
});

test('interrupted remote presentation adopts once and ignores a late completion', () => {
  const controller = new GameController();
  let done = () => {};
  let presents = 0;
  const scene: OnlineScene = {
    faceSeat() {},
    presentState() {
      presents++;
    },
    playRemoteMove(_sequence, _checker, complete) {
      done = complete;
    },
  };
  const dice: OnlineDice = { play() {}, reset() {} };
  const flow = createOnlineGameFlow(controller, scene, dice);
  flow.join(0, () => {}, controller.state);
  const ready = structuredClone(controller.state);
  ready.opening = false;
  ready.phase = 'WAITING_FOR_MOVE';
  ready.remaining = [2];
  flow.receive({ state: ready, canUndo: false });
  const moved = structuredClone(ready);
  moved.board[2] = [moved.board[0].pop()!];
  moved.remaining = [];
  moved.phase = 'TURN_COMPLETE';
  flow.receive({ state: moved, canUndo: true, sequence: [{ from: 0, to: 2, die: 2 }] });
  assert.equal(controller.busy, true);
  flow.finishRemoteMove();
  assert.deepEqual(controller.state.board[2], [14]);
  assert.equal(controller.busy, false);
  const afterInterruption = presents;
  done();
  assert.equal(presents, afterInterruption);
});
