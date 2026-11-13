import test from 'node:test';
import assert from 'node:assert/strict';
import { GameController } from '../src/app/game-controller';
import { Game } from '../src/game/engine';
import type { Command } from '../src/net/messages';

test('local controller preserves facade state and status through a complete turn', () => {
  const controller = new GameController();
  const baseline = new Game();
  assert.deepEqual(controller.state, baseline.state);
  for (const values of [
    [6, 6],
    [1, 1],
    [2, 3],
  ]) {
    assert.equal(controller.beginRoll(), baseline.beginRoll());
    controller.receiveRoll(values);
    baseline.receiveRoll(values);
    assert.deepEqual(controller.state, baseline.state);
  }

  const first = baseline.moves()[0];
  assert.equal(controller.requestMove([first])?.type, 'local');
  assert.equal(baseline.move(first), true);
  assert.deepEqual(controller.state, baseline.state);
  controller.finishLocalMove();
  assert.equal(controller.undo(), baseline.undo());
  assert.deepEqual(controller.state, baseline.state);

  let moved = 0;
  while (baseline.state.phase === 'WAITING_FOR_MOVE') {
    const move = baseline.moves()[0];
    assert.equal(controller.requestMove([move])?.type, 'local');
    assert.equal(baseline.move(move), true);
    controller.finishLocalMove();
    assert.deepEqual(controller.state, baseline.state);
    assert.equal(controller.canUndo, baseline.history.length > 0);
    moved++;
    assert.ok(moved <= 4);
  }
  assert.equal(controller.endTurn(), baseline.endTurn());
  assert.deepEqual(controller.state, baseline.state);
  assert.equal(controller.restart(), 'local');
  baseline.reset();
  assert.deepEqual(controller.state, baseline.state);
});

test('local controller routes a move, animation completion, and undo through the game', () => {
  const controller = new GameController();
  assert.equal(controller.beginRoll(true), false);
  assert.equal(controller.beginRoll(), true);
  controller.receiveRoll([6, 6]);
  controller.beginRoll();
  controller.receiveRoll([1, 1]);
  controller.beginRoll();
  controller.receiveRoll([2, 3]);
  const before = structuredClone(controller.state);
  const move = controller.moves()[0];
  const request = controller.requestMove([move]);
  assert.equal(request?.type, 'local');
  if (request?.type !== 'local') return;
  assert.deepEqual(request.start.board, before.board);
  assert.deepEqual(request.stages.at(-1)!.board, controller.state.board);
  assert.equal(controller.state.phase, 'WAITING_FOR_MOVE');
  assert.equal(controller.busy, true);
  assert.equal(controller.undo(), false);
  controller.finishLocalMove();
  assert.equal(controller.canUndo, true);
  assert.equal(controller.undo(), true);
  assert.deepEqual(controller.state, before);
});

test('presentation locks input after the authoritative phase advances', () => {
  const controller = new GameController();
  assert.equal(controller.beginRoll(), true);
  assert.equal(controller.state.phase, 'OPENING_ROLL');
  assert.equal(controller.busy, true);
  assert.equal(controller.beginRoll(), false);
  controller.receiveRoll([6, 6]);
  controller.beginRoll();
  controller.receiveRoll([1, 1]);
  controller.beginRoll();
  controller.receiveRoll([2, 3]);
  while (controller.state.phase === 'WAITING_FOR_MOVE') {
    assert.equal(controller.requestMove([controller.moves()[0]])?.type, 'local');
    assert.equal(controller.busy, true);
    assert.equal(controller.undo(), false);
    assert.equal(controller.endTurn(), false);
    controller.finishLocalMove();
  }
  assert.equal(controller.state.phase, 'TURN_COMPLETE');
  assert.equal(controller.endTurn(), true);
});

test('online controller waits for authority, then adopts presented dice and moves', () => {
  const controller = new GameController();
  const sent: Command[] = [];
  controller.join(0, (command) => sent.push(command));
  assert.equal(controller.beginRoll(), true);
  assert.deepEqual(sent, [{ type: 'roll' }]);
  assert.equal(controller.busy, true);
  assert.equal(controller.beginRoll(), false);
  const opening = structuredClone(controller.state);
  opening.active = 1;
  opening.phase = 'OPENING_ROLL';
  controller.queueRoll(opening, false);
  assert.equal(controller.state.active, 0);
  const presented = controller.presentedRoll();
  assert.ok(presented);
  controller.adopt(presented!.state, presented!.canUndo);
  assert.equal(controller.busy, false);
  assert.equal(controller.mine(), false);
  assert.equal(controller.beginRoll(), false);
  controller.queueRoll(opening, false);
  controller.adopt(opening, false);
  assert.equal(controller.presentedRoll(), null);

  const moving = structuredClone(opening);
  moving.active = 0;
  moving.opening = false;
  moving.phase = 'WAITING_FOR_MOVE';
  moving.remaining = [2];
  controller.adopt(moving, false);
  const sequence = [{ from: 0, to: 2, die: 2 }];
  assert.deepEqual(controller.requestMove(sequence), { type: 'sent' });
  assert.deepEqual(sent.at(-1), { type: 'move', sequence });
  assert.equal(controller.busy, true);
  const result = structuredClone(moving);
  result.board[2] = [result.board[0].pop()!];
  result.phase = 'WAITING_FOR_MOVE';
  assert.equal(controller.beginRemoteMove(sequence, result, true), 14);
  assert.equal(controller.busy, true);
  const completed = controller.finishRemoteMove();
  assert.ok(completed);
  assert.equal(controller.busy, false);
  assert.deepEqual(controller.state.board[2], []);
  controller.adopt(completed!.state, completed!.canUndo);
  assert.deepEqual(controller.state.board[2], [14]);
  assert.equal(controller.canUndo, true);
  assert.equal(controller.undo(), true);
  assert.deepEqual(sent.at(-1), { type: 'undo' });
  controller.leaveOnline();
  assert.equal(controller.scripted, false);
  assert.equal(controller.state.phase, 'OPENING_ROLL');
});

test('pickup queue keeps the next checker after a local placement and clears on undo', () => {
  const controller = new GameController();
  controller.beginRoll();
  controller.receiveRoll([6, 6]);
  controller.beginRoll();
  controller.receiveRoll([1, 1]);
  controller.beginRoll();
  controller.receiveRoll([3, 5]);
  const pickup = controller.pickup;
  assert.equal(pickup.refresh(controller.state, true, false).pickable[0], 14);
  assert.equal(controller.pickAt(0), 14);
  assert.equal(controller.pickAt(0), 13);
  assert.deepEqual(pickup.items, [14, 13]);
  const sequence = pickup.sequences(controller.state)[0];
  assert.ok(sequence);
  assert.equal(sequence.length, 1);
  assert.equal(controller.requestMove(sequence)?.type, 'local');
  assert.deepEqual(pickup.items, [13]);
  controller.finishLocalMove();
  assert.deepEqual(pickup.items, [13]);
  assert.ok(pickup.sequences(controller.state).length);
  assert.equal(controller.undo(), true);
  assert.deepEqual(pickup.items, []);
});

test('authoritative adoption revalidates or clears the held queue', () => {
  const controller = new GameController();
  const state = structuredClone(controller.state);
  state.opening = false;
  state.phase = 'WAITING_FOR_MOVE';
  state.remaining = [3, 5];
  controller.adopt(state, false);
  const pickup = controller.pickup;
  controller.pickAt(0);
  controller.pickAt(0);
  assert.deepEqual(pickup.items, [14, 13]);
  const accepted = structuredClone(state);
  accepted.board[3] = [accepted.board[0].pop()!];
  accepted.remaining = [5];
  assert.equal(controller.beginRemoteMove([{ from: 0, to: 3, die: 3 }], accepted, true), 14);
  assert.deepEqual(pickup.items, [13]);
  const completed = controller.finishRemoteMove();
  assert.ok(completed);
  controller.adopt(completed!.state, completed!.canUndo, true);
  assert.deepEqual(pickup.items, [13]);
  assert.ok(pickup.sequences(controller.state).length);
  controller.adopt({ ...accepted, remaining: [] }, true, true);
  assert.deepEqual(pickup.items, []);
  pickup.pickAt(0, { ...accepted, remaining: [5] });
  assert.deepEqual(pickup.items, [13]);
  controller.adopt(accepted, true);
  assert.deepEqual(pickup.items, []);
});
