import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/session/game';
import { legalMoves } from '../src/game/rules/moves';
import { sessionMessage } from '../src/game/session/messages';
import { initialGameState, type Session } from '../src/game/session/state';
import { transitionSession, type SessionCommand } from '../src/game/session/transition';
import type { Phase } from '../src/game/session/phase';

test('session rejects commands in the wrong phase without changing its inputs', () => {
  const session: Session = { state: initialGameState(), history: [] };
  const before = structuredClone(session);
  for (const command of [
    { type: 'move', sequence: [{ from: 0, to: 1, die: 1 }] },
    { type: 'undo' },
    { type: 'endTurn' },
  ] as SessionCommand[]) {
    const result = transitionSession(session, command);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'phase');
    assert.deepEqual(session, before);
  }
  const rolling = transitionSession(session, { type: 'beginRoll' });
  assert.equal(rolling.ok, true);
  if (!rolling.ok) return;
  const invalid = transitionSession(rolling.session, { type: 'receiveRoll', values: [0, 7] });
  assert.deepEqual(invalid, { ok: false, reason: 'invalid_roll' });
  assert.equal(rolling.session.state.phase, 'OPENING_ROLL');
  assert.deepEqual(session, before);
});

test('session rejects each command outside its allowed phases', () => {
  const commands: [SessionCommand, Phase[]][] = [
    [{ type: 'beginRoll' }, ['OPENING_ROLL', 'WAITING_FOR_ROLL']],
    [{ type: 'receiveRoll', values: [1, 2] }, ['OPENING_ROLL', 'WAITING_FOR_ROLL']],
    [{ type: 'move', sequence: [{ from: 0, to: 1, die: 1 }] }, ['WAITING_FOR_MOVE']],
    [{ type: 'undo' }, ['WAITING_FOR_MOVE', 'TURN_COMPLETE']],
    [{ type: 'endTurn' }, ['TURN_COMPLETE']],
  ];
  const phases: Phase[] = [
    'OPENING_ROLL',
    'WAITING_FOR_ROLL',
    'WAITING_FOR_MOVE',
    'TURN_COMPLETE',
    'GAME_OVER',
  ];
  for (const phase of phases) {
    const state = initialGameState();
    state.phase = phase;
    const session = { state, history: [] };
    for (const [command, allowed] of commands) {
      if (allowed.includes(phase)) continue;
      assert.deepEqual(transitionSession(session, command), { ok: false, reason: 'phase' });
      assert.equal(session.state.phase, phase);
    }
  }
});

test('session emits a pin event and rejects out-of-range moves without partial state changes', () => {
  const state = initialGameState();
  state.board = Array.from({ length: 24 }, () => []);
  state.off = [[], []];
  state.board[1] = [0];
  state.board[3] = [15];
  state.phase = 'WAITING_FOR_MOVE';
  state.opening = false;
  state.remaining = [2];
  const session: Session = { state, history: [] };
  const before = structuredClone(session);
  assert.deepEqual(
    transitionSession(session, { type: 'move', sequence: [{ from: 99, to: 3, die: 2 }] }),
    { ok: false, reason: 'illegal_move' },
  );
  const result = transitionSession(session, {
    type: 'move',
    sequence: [{ from: 1, to: 3, die: 2 }],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.events, [
    { type: 'CheckerMoved', checker: 0, from: 1, to: 3, die: 2 },
    { type: 'CheckerPinned', checker: 0, victim: 15, point: 3 },
    { type: 'MovesComplete' },
  ]);
  assert.deepEqual(result.session.state.board[3], [15, 0]);
  assert.equal(result.session.state.phase, 'TURN_COMPLETE');
  assert.deepEqual(session, before);
});

test('Game facade and pure transition agree across opening, moves, undo and turn end', () => {
  const game = new Game();
  let session: Session = { state: structuredClone(game.state), history: [] };
  const apply = (command: SessionCommand) => {
    const result = transitionSession(session, command);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    session = result.session;
    const message = sessionMessage(session.state, result.events);
    if (message !== null) session.state.message = message;
    if (command.type === 'beginRoll') assert.equal(game.beginRoll(), true);
    if (command.type === 'receiveRoll') game.receiveRoll(command.values);
    if (command.type === 'move') assert.ok(game.moveSequence(command.sequence));
    if (command.type === 'undo') assert.equal(game.undo(), true);
    if (command.type === 'endTurn') assert.equal(game.endTurn(), true);
    if (command.type === 'restart') game.reset();
    assert.deepEqual(game.state, session.state);
    assert.deepEqual(game.history, session.history);
  };
  apply({ type: 'beginRoll' });
  apply({ type: 'receiveRoll', values: [6, 6] });
  apply({ type: 'beginRoll' });
  apply({ type: 'receiveRoll', values: [1, 1] });
  apply({ type: 'beginRoll' });
  apply({ type: 'receiveRoll', values: [2, 3] });
  const first = legalMoves(session.state, 0, session.state.remaining)[0];
  apply({ type: 'move', sequence: [first] });
  apply({ type: 'undo' });
  apply({ type: 'move', sequence: [first] });
  while (session.state.phase === 'WAITING_FOR_MOVE') {
    apply({ type: 'move', sequence: [legalMoves(session.state, 0, session.state.remaining)[0]] });
  }
  assert.equal(session.state.phase, 'TURN_COMPLETE');
  apply({ type: 'endTurn' });
  apply({ type: 'restart' });
});
