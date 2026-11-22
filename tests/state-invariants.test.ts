import test from 'node:test';
import assert from 'node:assert/strict';
import { initialGameState, type Session } from '../src/game/session/state';
import {
  assertGameStateInvariants,
  gameStateInvariantViolations,
  sessionInvariantViolations,
} from '../src/game/session/invariants';
import { transitionSession, type SessionCommand } from '../src/game/session/transition';
import { stateMessageParts } from '../src/game/session/messages';

test('authoritative state excludes presentation copy and the HUD projects outcomes', () => {
  const state = initialGameState();
  assert.equal('message' in state, false);
  assert.equal('messageKey' in state, false);
  state.phase = 'GAME_OVER';
  state.outcome = { winner: 1, points: 2, reason: 'Ivory wins.', kind: 'MARS' };
  assert.deepEqual(stateMessageParts(state), {
    key: 'status.winner',
    params: { player: 2 },
    text: 'Player 2 wins · Ivory wins.',
  });
});

test('initial state and a representative turn preserve session invariants', () => {
  let session: Session = { state: initialGameState(), history: [] };
  assert.deepEqual(sessionInvariantViolations(session), []);

  const apply = (command: SessionCommand) => {
    const result = transitionSession(session, command);
    assert.equal(result.ok, true, `${command.type} should be accepted`);
    if (!result.ok) return;
    session = result.session;
    assert.deepEqual(
      sessionInvariantViolations(session),
      [],
      `${command.type} produced invalid state`,
    );
  };

  apply({ type: 'resolveOpening', attempts: [[6, 1]] });
  apply({ type: 'beginRoll' });
  apply({ type: 'receiveRoll', values: [2, 1] });
});

test('automatic opening history remains valid after play passes to the other player', () => {
  let session: Session = { state: initialGameState(), history: [] };
  const apply = (command: SessionCommand) => {
    const result = transitionSession(session, command);
    assert.equal(result.ok, true, `${command.type} should be accepted`);
    if (!result.ok) return;
    session = result.session;
    assert.deepEqual(sessionInvariantViolations(session), []);
  };

  apply({ type: 'resolveOpening', attempts: [[6, 1]] });
  apply({ type: 'beginRoll' });
  apply({ type: 'receiveRoll', values: [1, 1] });
  for (let step = 0; step < 4; step++)
    apply({ type: 'move', sequence: [{ from: 0, to: 1, die: 1 }] });
  apply({ type: 'endTurn' });

  assert.equal(session.state.active, 1);
  assert.equal(session.state.phase, 'WAITING_FOR_ROLL');
  assert.deepEqual(session.state.opening, {
    status: 'RESOLVED',
    attempts: [[6, 1]],
    winner: 0,
  });
});

test('state invariants report contradictory opening, ownership, outcome, and clock data', () => {
  const state = initialGameState();
  state.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  state.off[0].push(state.board[23].pop()!);
  state.outcome = { winner: 0, points: 1, reason: 'early', kind: 'BEAR_OFF' };
  state.clock = { remainingMs: 1000, deadline: null, running: true };

  const violations = gameStateInvariantViolations(state);
  assert.ok(violations.some(({ path }) => path === 'opening'));
  assert.ok(violations.some(({ path }) => path === 'off.0'));
  assert.ok(violations.some(({ path }) => path === 'outcome'));
  assert.ok(violations.some(({ path }) => path === 'clock.deadline'));
  assert.throws(() => assertGameStateInvariants(state), /Invalid game state/);
});

test('session invariants identify invalid history separately from current state', () => {
  const current = initialGameState();
  const history = structuredClone(current);
  history.roll = [1];

  assert.deepEqual(sessionInvariantViolations({ state: current, history: [history] }), [
    { path: 'history.0.roll', reason: 'must be empty or contain exactly two dice' },
  ]);
});
