import test from 'node:test';
import assert from 'node:assert/strict';
import { createLobby } from '../src/net/lobby';
import { Game } from '../src/game/engine';

const die = (values: number[]) => {
  let index = 0;
  return () => values[index++] ?? 1;
};

test('the first searching player is paired with the next one', () => {
  const lobby = createLobby(() => 1);
  assert.deepEqual(lobby.join('ada'), { type: 'waiting' });
  assert.deepEqual(lobby.join('ada'), { type: 'waiting' });
  const matched = lobby.join('basil');
  assert.equal(matched?.type, 'matched');
  if (matched?.type !== 'matched') return;
  assert.deepEqual(matched.ids, ['ada', 'basil']);
  assert.equal(matched.state.active, 0);
  assert.equal(matched.state.phase, 'OPENING_ROLL');
  const waiting = lobby.join('cleo');
  assert.deepEqual(waiting, { type: 'waiting' });
  assert.equal(lobby.leave('cleo'), null);
});

test('only the player to move can roll, and the server chooses the dice', () => {
  const lobby = createLobby(die([6, 1, 4, 4]));
  lobby.join('ada');
  lobby.join('basil');
  assert.equal(lobby.act('basil', { type: 'roll' })?.to.length, 1);
  const rolled = lobby.act('ada', { type: 'roll' });
  assert.deepEqual(rolled?.update.dice, [6, 1]);
  assert.equal(rolled?.update.state.active, 1);
  assert.equal(rolled?.update.state.phase, 'OPENING_ROLL');
  const second = lobby.act('basil', { type: 'roll' });
  assert.deepEqual(second?.update.dice, [4, 4]);
  assert.equal(second?.update.state.active, 1);
  assert.equal(second?.update.state.phase, 'WAITING_FOR_ROLL');
});

test('a move is checked on the server and undo restores it for the same player', () => {
  const lobby = createLobby(die([6, 1, 1, 1, 2, 1]));
  lobby.join('ada');
  lobby.join('basil');
  lobby.act('ada', { type: 'roll' });
  lobby.act('basil', { type: 'roll' });
  const state = lobby.act('ada', { type: 'roll' })!.update.state;
  assert.equal(state.phase, 'WAITING_FOR_MOVE');
  const move = { from: 0, to: 2, die: 2 };
  assert.equal(lobby.act('basil', { type: 'move', sequence: [move] })?.to.length, 1);
  const played = lobby.act('ada', { type: 'move', sequence: [move] });
  assert.equal(played?.update.state.board[2].length, 1);
  assert.equal(played?.update.canUndo, true);
  const undone = lobby.act('ada', { type: 'undo' });
  assert.equal(undone?.update.state.board[0].length, 15);
  assert.equal(undone?.update.canUndo, false);
});

test('an out-of-range move is rejected without interrupting the online match', () => {
  const lobby = createLobby(die([6, 1, 1, 1, 2, 1]));
  lobby.join('ada');
  lobby.join('basil');
  lobby.act('ada', { type: 'roll' });
  lobby.act('basil', { type: 'roll' });
  const before = lobby.act('ada', { type: 'roll' })!.update.state;
  const rejected = lobby.act('ada', {
    type: 'move',
    sequence: [{ from: 99, to: 2, die: 2 }],
  });
  assert.deepEqual(rejected?.to, ['ada']);
  assert.deepEqual(rejected?.update.state, before);
  const played = lobby.act('ada', {
    type: 'move',
    sequence: [{ from: 0, to: 2, die: 2 }],
  });
  assert.equal(played?.update.state.board[2].length, 1);
});

test('cancelling a search that already paired frees both seats', () => {
  const lobby = createLobby(() => 1);
  lobby.join('ada');
  assert.equal(lobby.cancel('ada'), null);
  lobby.join('ada');
  lobby.join('basil');
  assert.equal(lobby.cancel('basil'), 'ada');
  assert.equal(lobby.act('ada', { type: 'roll' }), null);
  assert.equal(lobby.join('ada')?.type, 'waiting');
});

test('leaving a match tells the opponent, and a restart clears the dice', () => {
  const lobby = createLobby(() => 3);
  lobby.join('ada');
  lobby.join('basil');
  assert.equal(lobby.leave('ada'), 'basil');
  assert.equal(lobby.act('basil', { type: 'roll' }), null);
  lobby.join('ada');
  lobby.join('cleo');
  const restarted = lobby.act('cleo', { type: 'restart' });
  assert.equal(restarted?.update.resetDice, true);
  assert.equal(restarted?.update.state.phase, 'OPENING_ROLL');
  assert.equal(restarted?.to.includes('ada'), true);
});

test('authoritative session transitions match the local facade through a turn', () => {
  const rolls = [6, 1, 1, 1, 2, 1];
  const lobby = createLobby(die(rolls));
  const local = new Game();
  lobby.join('ada');
  lobby.join('basil');
  for (const [id, values] of [
    ['ada', [6, 1]],
    ['basil', [1, 1]],
    ['ada', [2, 1]],
  ] as const) {
    assert.equal(local.beginRoll(), true);
    local.receiveRoll([...values]);
    const result = lobby.act(id, { type: 'roll' });
    assert.deepEqual(result?.update.state, local.state);
    assert.equal(result?.update.canUndo, local.history.length > 0);
  }
  while (local.state.phase === 'WAITING_FOR_MOVE') {
    const move = local.moves()[0];
    assert.equal(local.move(move), true);
    const result = lobby.act('ada', { type: 'move', sequence: [move] });
    assert.deepEqual(result?.update.state, local.state);
    assert.equal(result?.update.canUndo, local.history.length > 0);
  }
  assert.equal(local.state.phase, 'TURN_COMPLETE');
  assert.equal(local.endTurn(), true);
  const ended = lobby.act('ada', { type: 'end' });
  assert.deepEqual(ended?.update.state, local.state);
  assert.equal(ended?.update.canUndo, false);
});

test('a rejected server die leaves the match unchanged', () => {
  const lobby = createLobby(() => 7);
  lobby.join('ada');
  const matched = lobby.join('basil');
  assert.equal(matched?.type, 'matched');
  if (matched?.type !== 'matched') return;
  const rejected = lobby.act('ada', { type: 'roll' });
  assert.deepEqual(rejected?.to, ['ada']);
  assert.deepEqual(rejected?.update.state, matched.state);
  assert.equal(rejected?.update.dice, undefined);
});
