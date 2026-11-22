import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePlaytestReports, parsePlaytestReport } from '../src/app/playtest-analysis';
import type { PlaytestEntry, PlaytestReport } from '../src/app/playtest-report';
import type { PlayerLoadout } from '../src/game/variant/types';

const emptyLoadouts = (): [PlayerLoadout, PlayerLoadout] => [
  { powerups: [], passives: [] },
  { powerups: [], passives: [] },
];

function entry(
  index: number,
  events: PlaytestEntry['events'],
  loadouts = emptyLoadouts(),
  active: 0 | 1 | null = 0,
): PlaytestEntry {
  const ended = events.find((event) => event.type === 'GameEnded');

  return {
    index,
    events,
    state: {
      phase: ended ? 'GAME_OVER' : 'WAITING_FOR_ROLL',
      active,
      round: 1,
      roll: [],
      remaining: [],
      loadouts,
      activeEffects: [],
      outcome: ended?.type === 'GameEnded' ? ended.outcome : null,
    },
  };
}

function report(seed: number, configHash: string, entries: PlaytestEntry[]): PlaytestReport {
  return {
    schemaVersion: 1,
    mode: 'LOCAL',
    selection: { ruleset: 'POWERUPS_V1', profileId: 'powerups-v1' },
    seed,
    configHash,
    startedAt: '2026-01-02T03:04:05.000Z',
    entries,
    summary: {
      draftsOpened: 0,
      stalledTurns: [0, 0],
      picks: {},
      uses: {},
      effectsExpired: {},
      winner: undefined,
      points: undefined,
      reason: undefined,
    },
  };
}

test('aggregate analysis separates config hashes and derives completed and censored metrics', () => {
  const frostLoadout = emptyLoadouts();

  frostLoadout[0].powerups.push({ instanceId: 'frost-1', abilityId: 'frostSeal' });

  const completed = report(10, 'hash-a', [
    entry(0, [
      { type: 'OpeningResolved', attempts: [[6, 1]], player: 0 },
      { type: 'DraftOpened', offer: ['frostSeal', 'recast', 'homeGuard'] },
      { type: 'DraftOrderChosen', first: 0 },
    ]),
    entry(1, [{ type: 'AbilityPicked', player: 0, abilityId: 'frostSeal' }], frostLoadout),
    entry(2, [{ type: 'TurnEnded', player: 0, next: 1 }], frostLoadout, 1),
    entry(
      3,
      [
        {
          type: 'AbilityUsed',
          player: 0,
          abilityId: 'frostSeal',
          target: { type: 'POINT', point: 12 },
        },
        { type: 'TurnEnded', player: 1, next: 0 },
      ],
      emptyLoadouts(),
      0,
    ),
    entry(4, [
      {
        type: 'GameEnded',
        outcome: { winner: 0, points: 1, reason: 'Player 1 bore off all checkers.' },
      },
    ]),
  ]);

  const guardLoadout = emptyLoadouts();

  guardLoadout[1].passives.push({ instanceId: 'guard-1', abilityId: 'homeGuard' });

  const incomplete = report(11, 'hash-a', [
    entry(0, [{ type: 'AbilityPicked', player: 1, abilityId: 'homeGuard' }], guardLoadout, 1),
    entry(1, [{ type: 'NoLegalMoves' }], guardLoadout, 1),
    entry(2, [{ type: 'TurnEnded', player: 1, next: 0 }], guardLoadout, 0),
  ]);
  const otherConfig = report(12, 'hash-b', []);

  const analysis = analyzePlaytestReports([completed, incomplete, otherConfig]);

  assert.equal(analysis.groups.length, 2);

  const group = analysis.groups.find((candidate) => candidate.configHash === 'hash-a')!;

  assert.equal(group.reports, 2);
  assert.deepEqual(group.seeds, [10, 11]);
  assert.equal(group.completedGames, 1);
  assert.equal(group.completedTurns, 2);
  assert.equal(group.averageTurnsPerCompletedGame, 2);
  assert.deepEqual(group.stalledTurns, [0, 1]);
  assert.equal(group.openingWinnerWinRate, 1);
  assert.equal(group.draftFirstPickWinRate, 1);
  assert.deepEqual(
    {
      offered: group.abilities.frostSeal.offered,
      picked: group.abilities.frostSeal.picked,
      used: group.abilities.frostSeal.used,
      holds: group.abilities.frostSeal.completedHoldSamples,
      heldTurns: group.abilities.frostSeal.completedHeldTurns,
      average: group.abilities.frostSeal.averageCompletedTurnsHeld,
      offerPickRate: group.abilities.frostSeal.offerPickRate,
      usesPerPick: group.abilities.frostSeal.usesPerPick,
      pickWinRate: group.abilities.frostSeal.pickWinRate,
      useWinRate: group.abilities.frostSeal.useWinRate,
    },
    {
      offered: 1,
      picked: 1,
      used: 1,
      holds: 1,
      heldTurns: 2,
      average: 2,
      offerPickRate: 1,
      usesPerPick: 1,
      pickWinRate: 1,
      useWinRate: 1,
    },
  );
  assert.equal(group.abilities.homeGuard.censoredHoldSamples, 1);
  assert.equal(group.abilities.homeGuard.censoredHeldTurns, 1);
});

test('import validation accepts generated reports and rejects unsafe metric shapes', () => {
  const valid = report(99, 'hash-a', [
    entry(0, [{ type: 'AbilityPicked', player: 0, abilityId: 'recast' }]),
  ]);

  assert.deepEqual(parsePlaytestReport(structuredClone(valid)), valid);

  const missingPlayer = structuredClone(valid) as unknown as {
    entries: { events: Record<string, unknown>[] }[];
  };

  delete missingPlayer.entries[0].events[0].player;
  assert.equal(parsePlaytestReport(missingPlayer), null);

  const unknownAbility = structuredClone(valid) as unknown as {
    entries: { events: Record<string, unknown>[] }[];
  };

  unknownAbility.entries[0].events[0].abilityId = 'not-a-card';
  assert.equal(parsePlaytestReport(unknownAbility), null);
});
