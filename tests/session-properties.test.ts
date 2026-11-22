import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import { legalMoves } from '../src/game/rules/moves';
import { sessionInvariantViolations } from '../src/game/session/invariants';
import { initialGameState, type Session } from '../src/game/session/state';
import { transitionSession, type SessionCommand } from '../src/game/session/transition';

const die = fc.integer({ min: 1, max: 6 });
const decisiveOpening = fc.tuple(die, die).filter(([first, second]) => first !== second);
const decision = fc.record({
  dice: fc.tuple(die, die),
  moveIndex: fc.nat(),
  undo: fc.boolean(),
});

function assertCheckerIdentity(session: Session): void {
  const checkers = [...session.state.board, ...session.state.off].flat().sort((a, b) => a - b);
  assert.deepEqual(
    checkers,
    Array.from({ length: 30 }, (_, checker) => checker),
  );
}

function applyAccepted(session: Session, command: SessionCommand): Session {
  const before = structuredClone(session);
  const first = transitionSession(session, command);
  const repeated = transitionSession(session, command);

  assert.deepEqual(session, before, `${command.type} mutated its input`);
  assert.deepEqual(repeated, first, `${command.type} was not deterministic`);
  assert.equal(first.ok, true, `${command.type} should be accepted`);
  if (!first.ok) return session;
  assert.deepEqual(
    sessionInvariantViolations(first.session),
    [],
    `${command.type} violated the session contract`,
  );
  assertCheckerIdentity(first.session);
  return first.session;
}

test('generated reachable Classic sessions remain deterministic and invariant-safe', () => {
  fc.assert(
    fc.property(
      fc.array(die, { maxLength: 4 }),
      decisiveOpening,
      fc.array(decision, { minLength: 1, maxLength: 80 }),
      (tieFaces, finalOpening, decisions) => {
        let session: Session = { state: initialGameState(), history: [] };
        const attempts: [number, number][] = [
          ...tieFaces.map((face): [number, number] => [face, face]),
          finalOpening,
        ];
        session = applyAccepted(session, { type: 'resolveOpening', attempts });

        for (const next of decisions) {
          if (session.state.phase === 'GAME_OVER') break;
          if (session.state.phase === 'WAITING_FOR_ROLL') {
            session = applyAccepted(session, { type: 'beginRoll' });
            session = applyAccepted(session, { type: 'receiveRoll', values: [...next.dice] });
            continue;
          }
          if (session.state.phase === 'WAITING_FOR_MOVE') {
            assert.notEqual(session.state.active, null);
            const moves = legalMoves(session.state, session.state.active!, session.state.remaining);
            assert.ok(moves.length > 0);
            session = applyAccepted(session, {
              type: 'move',
              sequence: [moves[next.moveIndex % moves.length]],
            });
            continue;
          }
          if (session.state.phase === 'TURN_COMPLETE') {
            if (next.undo && session.history.length > 0) {
              const previous = structuredClone(session.history.at(-1)!);
              session = applyAccepted(session, { type: 'undo' });
              assert.deepEqual(session.state, previous);
            } else {
              session = applyAccepted(session, { type: 'endTurn' });
            }
            continue;
          }
          assert.fail(`Unexpected reachable Classic phase ${session.state.phase}`);
        }
      },
    ),
    { numRuns: 100 },
  );
});

test('generated invalid rolls are rejected without mutating the session', () => {
  const invalidRoll = fc
    .array(fc.integer({ min: -10, max: 12 }), { maxLength: 5 })
    .filter((values) => values.length !== 2 || values.some((value) => value < 1 || value > 6));

  fc.assert(
    fc.property(invalidRoll, (values) => {
      let session: Session = { state: initialGameState(), history: [] };
      session = applyAccepted(session, { type: 'resolveOpening', attempts: [[6, 1]] });
      session = applyAccepted(session, { type: 'beginRoll' });
      const before = structuredClone(session);

      assert.deepEqual(transitionSession(session, { type: 'receiveRoll', values }), {
        ok: false,
        reason: 'invalid_roll',
      });
      assert.deepEqual(session, before);
    }),
    { numRuns: 100 },
  );
});
