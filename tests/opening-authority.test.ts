import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAutomaticOpening } from '../src/game/session/opening-authority';
import { initialPresentedSession } from '../src/game/session/messages';
import { transitionSession } from '../src/game/session/transition';
import { CLASSIC_RULES } from '../src/game/variant/types';

test('automatic opening rolls one owned die together and retries both dice on ties', () => {
  const samples = [2, 2, 5, 3];
  const resolved = resolveAutomaticOpening(
    initialPresentedSession(),
    CLASSIC_RULES,
    () => samples.shift()! - 1,
  );

  assert.ok(resolved);
  assert.deepEqual(resolved.attempts, [
    [2, 2],
    [5, 3],
  ]);
  assert.equal(resolved.winner, 0);
  assert.equal(resolved.session.state.phase, 'WAITING_FOR_ROLL');
  assert.equal(resolved.session.state.active, 0);
  assert.deepEqual(resolved.session.state.opening, {
    status: 'RESOLVED',
    attempts: [
      [2, 2],
      [5, 3],
    ],
    winner: 0,
  });
  assert.deepEqual(resolved.session.state.roll, [5, 3]);
  assert.deepEqual(resolved.events, [
    {
      type: 'OpeningResolved',
      attempts: [
        [2, 2],
        [5, 3],
      ],
      player: 0,
    },
  ]);
});

test('opening resolution rejects incomplete, invalid, and post-winner attempt sequences atomically', () => {
  const session = initialPresentedSession();

  for (const attempts of [
    [],
    [[2, 2]],
    [
      [2, 3],
      [5, 1],
    ],
    [
      [2, 2],
      [7, 1],
    ],
  ] as [number, number][][]) {
    const result = transitionSession(session, { type: 'resolveOpening', attempts });

    assert.equal(result.ok, false);
    assert.equal(session.state.phase, 'OPENING');
    assert.deepEqual(session.state.opening, { status: 'PENDING' });
  }
});

test('automatic opening is a no-op once opening authority has already advanced', () => {
  const opened = transitionSession(initialPresentedSession(), {
    type: 'resolveOpening',
    attempts: [[6, 1]],
  });

  assert.equal(opened.ok, true);

  if (!opened.ok) return;

  let samples = 0;

  assert.equal(
    resolveAutomaticOpening(opened.session, CLASSIC_RULES, () => {
      samples++;

      return 0;
    }),
    null,
  );
  assert.equal(samples, 0);
});

test('automatic opening stops safely after the bounded number of tied attempts', () => {
  let samples = 0;
  const result = resolveAutomaticOpening(initialPresentedSession(), CLASSIC_RULES, () => {
    samples++;

    return 2;
  });

  assert.equal(result, null);
  assert.equal(samples, 128);
});
