import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaytestRecorder } from '../src/app/playtest-report';
import { createSeededDie, createSeededRandomInt, parseOptionalSeed } from '../src/game/random';
import { initialGameState } from '../src/game/session/state';
import type { SessionEvent } from '../src/game/session/transition';
import { POWERUPS_V1 } from '../src/game/variant/config/profiles';
import { powerupsRules } from '../src/game/variant/types';

test('seeded random integers are reproducible and stay within bounds', () => {
  const first = createSeededRandomInt(42);
  const second = createSeededRandomInt(42);
  const different = createSeededRandomInt(43);
  const values = Array.from({ length: 20 }, () => first(6));

  assert.deepEqual(
    values,
    Array.from({ length: 20 }, () => second(6)),
  );
  assert.notDeepEqual(
    values,
    Array.from({ length: 20 }, () => different(6)),
  );
  assert.equal(
    values.every((value) => value >= 0 && value < 6),
    true,
  );
  assert.throws(() => createSeededRandomInt(-1));
  assert.throws(() => first(0));
});

test('seeded dice are reproducible, stay on a die face, and keep their own stream', () => {
  const first = createSeededDie(2);
  const second = createSeededDie(2);
  const rolls = Array.from({ length: 20 }, first);

  assert.deepEqual(rolls, Array.from({ length: 20 }, second));
  assert.equal(
    rolls.every((roll) => Number.isInteger(roll) && roll >= 1 && roll <= 6),
    true,
  );
  // Draft and passive draws keep the bare seed stream, so dice must not consume it.
  const untouched = createSeededRandomInt(2);
  const expectedDrafts = Array.from({ length: 20 }, () => untouched(6));
  const draft = createSeededRandomInt(2);
  const die = createSeededDie(2);
  const interleavedDrafts = Array.from({ length: 20 }, () => {
    die();
    return draft(6);
  });
  assert.deepEqual(interleavedDrafts, expectedDrafts);
});

test('blank playtest seeds keep fresh randomness while explicit seeds remain reproducible', () => {
  assert.equal(parseOptionalSeed(''), undefined);
  assert.equal(parseOptionalSeed('   '), undefined);
  assert.equal(parseOptionalSeed('12345'), 12345);
  assert.equal(parseOptionalSeed('4294967295'), 0xffff_ffff);
  assert.equal(parseOptionalSeed('-1'), undefined);
  assert.equal(parseOptionalSeed('4294967296'), undefined);
});

test('playtest recorder keeps semantic events, state snapshots, and balance summaries', () => {
  const rules = powerupsRules(POWERUPS_V1);
  const state = initialGameState(rules);
  state.opening = false;
  state.active = 1;
  state.phase = 'TURN_COMPLETE';
  state.powerups!.completedRounds = 3;
  state.powerups!.activeEffects = [
    {
      instanceId: 'effect-1',
      abilityId: 'frostSeal',
      source: 0,
      affectedPlayer: 1,
      target: { type: 'POINT', point: 12 },
      tags: ['CONTROL'],
      constraints: [{ kind: 'BLOCK_LEAVING' }, { kind: 'BLOCK_LANDING' }],
      duration: { boundary: 'TARGET_TURN_END', count: 2 },
      remaining: 1,
    },
  ];
  const recorder = new PlaytestRecorder(() => new Date('2026-01-02T03:04:05.000Z'));
  recorder.start({
    mode: 'LOCAL',
    selection: { ruleset: 'POWERUPS_V1', profileId: 'powerups-v1' },
    seed: 77,
    configHash: POWERUPS_V1.hash,
  });
  const events: SessionEvent[] = [
    { type: 'DraftOpened', offer: ['frostSeal', 'recast', 'homeGuard'] },
    { type: 'AbilityPicked', player: 0, abilityId: 'frostSeal' },
    {
      type: 'AbilityUsed',
      player: 0,
      abilityId: 'frostSeal',
      target: { type: 'POINT', point: 12 },
    },
    { type: 'NoLegalMoves' },
    { type: 'EffectExpired', abilityId: 'frostSeal' },
    {
      type: 'GameEnded',
      outcome: { winner: 0, points: 1, reason: 'Player 1 bore off all checkers.' },
    },
  ];

  recorder.record(events, state);
  state.powerups!.activeEffects[0].remaining = 99;
  const report = recorder.snapshot()!;

  assert.equal(report.startedAt, '2026-01-02T03:04:05.000Z');
  assert.equal(report.entries[0].state.activeEffects[0].remaining, 1);
  assert.deepEqual(report.summary, {
    draftsOpened: 1,
    stalledTurns: [0, 1],
    picks: { frostSeal: 1 },
    uses: { frostSeal: 1 },
    effectsExpired: { frostSeal: 1 },
    winner: 0,
    points: 1,
    reason: 'Player 1 bore off all checkers.',
  });
});
