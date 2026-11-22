import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { legalMoves } from '../src/game/rules/moves';
import { initialPresentedSession } from '../src/game/session/messages';
import { initialGameState, type Session } from '../src/game/session/state';
import { createPowerupsV1Input } from '../src/game/variant/config/profiles/v1';
import { resolveVariantConfig } from '../src/game/variant/config/schema';
import { powerupsRules } from '../src/game/variant/types';
import { openStore } from '../server/store';
import { createTables } from '../server/tables';
import { nonTiedOpeningRandom } from './support/opening-random';

const createTestTables = (
  store: Parameters<typeof createTables>[0],
  rollDie: Parameters<typeof createTables>[1],
  now?: Parameters<typeof createTables>[2],
  openingRandom = nonTiedOpeningRandom(),
) => createTables(store, rollDie, now, undefined, undefined, openingRandom);

test('a live match is found by either seat without loading every match', async () => {
  const store = await openStore({ name: `plakoto-test-${randomUUID()}` });

  try {
    const session = { state: initialGameState(), history: [] };

    assert.equal(
      await store.insertMatch({
        id: 'live',
        seats: ['crimson', 'ivory'],
        session,
        variantConfig: null,
        lastUpdate: null,
        revision: 0,
        away: [null, null],
        connected: [true, false],
        endedAt: null,
        winner: null,
      }),
      true,
    );
    assert.deepEqual((await store.matchForUser('ivory'))?.seats, ['crimson', 'ivory']);
    assert.equal(await store.matchForUser('missing'), null);
  } finally {
    await store.drop();
  }
});

test('a stored manual opening is resolved automatically when a player reconnects', async () => {
  const store = await openStore({ name: `plakoto-test-${randomUUID()}` });

  try {
    const current = initialPresentedSession();
    const legacySession = {
      ...current,
      state: {
        ...current.state,
        phase: 'OPENING_ROLL',
        opening: true,
        openingRolls: [null, null],
        openingAttempts: [],
        message: 'legacy copy',
        messageKey: 'status.openingRoll',
        messageParams: { player: 1 },
      },
    } as unknown as Session;

    assert.equal(
      await store.insertMatch({
        id: 'pending-opening',
        seats: ['crimson', 'ivory'],
        session: legacySession,
        variantConfig: null,
        lastUpdate: null,
        revision: 0,
        away: [null, null],
        connected: [false, false],
        endedAt: null,
        winner: null,
      }),
      true,
    );

    const tables = createTestTables(store, () => 2, undefined, nonTiedOpeningRandom());
    const events = await tables.connect('crimson');
    const resume = events[0]?.message;

    assert.equal(resume?.type, 'resume');

    if (resume?.type !== 'resume') return;

    assert.equal(resume.revision, 1);
    assert.equal(resume.state.phase, 'WAITING_FOR_ROLL');
    assert.deepEqual(resume.presentations, [
      { type: 'OPENING', blocking: true, attempts: [[6, 1]] },
    ]);
    assert.deepEqual((await store.match('pending-opening'))?.session.state.opening, {
      status: 'RESOLVED',
      attempts: [[6, 1]],
      winner: 0,
    });
    assert.equal('message' in resume.state, false);
  } finally {
    await store.drop();
  }
});

test('stored legacy presentation hints migrate to discriminated jobs', async () => {
  const store = await openStore({ name: `plakoto-test-${randomUUID()}` });

  try {
    assert.equal(
      await store.insertMatch({
        id: 'legacy-presentation',
        seats: ['crimson', 'ivory'],
        session: { state: initialGameState(), history: [] },
        variantConfig: null,
        lastUpdate: {
          revision: 1,
          details: { dice: [6, 1] },
        } as never,
        revision: 1,
        away: [null, null],
        connected: [true, true],
        endedAt: null,
        winner: null,
      }),
      true,
    );

    assert.deepEqual((await store.match('legacy-presentation'))?.lastUpdate?.details, {
      presentations: [{ type: 'DICE', blocking: true, values: [6, 1] }],
    });
  } finally {
    await store.drop();
  }
});

test('a stored pre-constraint effect snapshot is migrated on read', async () => {
  const store = await openStore({ name: `plakoto-test-${randomUUID()}` });
  const config = resolveVariantConfig(createPowerupsV1Input());

  try {
    const session = initialPresentedSession(powerupsRules(config));
    const powerups = session.state.powerups!;

    powerups.activeEffects = [
      {
        instanceId: 'legacy-1',
        abilityId: 'frostSeal',
        source: 1,
        affectedPlayer: 0,
        target: { type: 'POINT', point: 12 },
        tags: ['CONTROL'],
        modifiers: { blockLeaving: true, blockLanding: true },
        duration: { boundary: 'TARGET_TURN_END', count: 1 },
        remaining: 1,
      } as unknown as (typeof powerups.activeEffects)[number],
    ];
    assert.equal(
      await store.insertMatch({
        id: 'legacy-live',
        seats: ['crimson', 'ivory'],
        session,
        variantConfig: config,
        lastUpdate: null,
        revision: 0,
        away: [null, null],
        connected: [true, false],
        endedAt: null,
        winner: null,
      }),
      true,
    );

    const tables = createTestTables(store, () => 1);
    const message = (await tables.connect('crimson'))[0]?.message;

    assert.equal(message?.type, 'resume');

    if (message?.type !== 'resume') return;

    assert.deepEqual(message.state.powerups?.activeEffects[0].constraints, [
      { kind: 'BLOCK_LEAVING' },
      { kind: 'BLOCK_LANDING' },
    ]);
  } finally {
    await store.drop();
  }
});

test('a stored configuration snapshot restores without a registered profile', async () => {
  const store = await openStore({ name: `plakoto-test-${randomUUID()}` });
  const input = createPowerupsV1Input();

  input.id = 'stored-balance-test';
  input.draft.intervalRounds = 2;

  const config = resolveVariantConfig(input);
  const tables = createTestTables(store, () => 1);

  try {
    assert.equal(
      await store.insertMatch({
        id: 'configured-live',
        seats: ['crimson', 'ivory'],
        session: initialPresentedSession(powerupsRules(config)),
        variantConfig: config,
        lastUpdate: null,
        revision: 0,
        away: [null, null],
        connected: [true, false],
        endedAt: null,
        winner: null,
      }),
      true,
    );

    const message = (await tables.connect('crimson'))[0]?.message;

    assert.equal(message?.type, 'resume');

    if (message?.type !== 'resume') return;

    assert.equal(message.variantConfig?.hash, config.hash);
    assert.equal(message.state.variantConfigHash, config.hash);
  } finally {
    await store.drop();
  }
});

test('two processes preserve exact roll and move revision metadata', async () => {
  const store = await openStore({ name: `plakoto-test-${randomUUID()}` });
  const rolls = [6, 1, 4, 4];
  let roll = 0;
  const next = () => rolls[roll++] ?? 1;
  let now = 1_000;
  const clock = () => now;
  const first = createTestTables(store, next, clock);
  let openingDie = 0;
  const second = createTestTables(store, next, clock, (maximum) =>
    openingDie++ % 2 === 0 ? 0 : maximum - 1,
  );

  try {
    await first.connect('ada');
    await second.connect('basil');
    assert.equal((await first.find('ada'))[0]?.message.type, 'waiting');

    const matched = await second.find('basil');
    const basilMatched = matched.find((event) => event.userId === 'basil')?.message;

    assert.equal(basilMatched?.type, 'matched');

    if (basilMatched?.type !== 'matched') return;

    const seen = await first.sync();
    const adaMatched = seen.find((event) => event.userId === 'ada')?.message;

    assert.equal(adaMatched?.type, 'matched');

    if (adaMatched?.type !== 'matched') return;

    assert.equal(adaMatched.matchId, basilMatched.matchId);
    assert.equal(adaMatched.revision, basilMatched.revision);

    const movement = await second.act('basil', { type: 'roll' });
    const movementUpdate = movement[0]?.message;

    assert.equal(movementUpdate?.type, 'update');

    if (movementUpdate?.type !== 'update') return;

    const movementFollowed = (await first.sync()).find((event) => event.userId === 'ada')?.message;

    assert.equal(movementFollowed?.type, 'update');

    if (movementFollowed?.type !== 'update') return;

    assert.deepEqual(movementFollowed.presentations, movementUpdate.presentations);
    assert.deepEqual(movementFollowed.events, movementUpdate.events);
    assert.deepEqual(movementUpdate.presentations, [
      { type: 'DICE', blocking: true, values: [6, 1] },
    ]);
    assert.ok(movementUpdate.revision > adaMatched.revision);

    const player = movementUpdate.state.active;

    assert.notEqual(player, null);

    if (player === null) return;

    const move = legalMoves(movementUpdate.state, player, movementUpdate.state.remaining)[0];

    assert.ok(move);

    const moved = await second.act('basil', { type: 'move', sequence: [move] });
    const movedUpdate = moved[0]?.message;

    assert.equal(movedUpdate?.type, 'update');

    if (movedUpdate?.type !== 'update') return;

    const moveFollowed = (await first.sync()).find((event) => event.userId === 'ada')?.message;

    assert.equal(moveFollowed?.type, 'update');

    if (moveFollowed?.type !== 'update') return;

    assert.deepEqual(moveFollowed.presentations, [
      { type: 'MOVE', blocking: true, sequence: [move] },
    ]);
    assert.deepEqual(moveFollowed.events, movedUpdate.events);

    await first.disconnect('ada');

    const awayRevision = (await second.sync()).find((event) => event.userId === 'basil')?.message;

    assert.equal(awayRevision?.type, 'update');

    if (awayRevision?.type !== 'update') return;

    assert.equal(awayRevision.sequence, undefined);
    assert.equal(awayRevision.events, undefined);
    now += 40_000;
    assert.equal((await first.connect('ada'))[0]?.message.type, 'resume');
    now += 45_001;
    assert.equal(
      (await second.sync()).some((event) => event.message.type === 'left'),
      false,
    );

    const live = await store.matchForUser('basil');

    assert.ok(live);
    await first.disconnect('ada');
    now += 45_001;

    const left = await second.sync();

    assert.equal(left.find((event) => event.message.type === 'left')?.message.type, 'left');
    assert.equal(await store.matchForUser('basil'), null);

    const kept = await store.match(live.id);

    assert.equal(kept?.winner, 'basil');
    assert.notEqual(kept?.endedAt, null);
    assert.equal(kept?.session.state.phase, 'GAME_OVER');
    assert.equal(kept?.session.state.outcome?.kind, 'DISCONNECT');
  } finally {
    await store.drop();
  }
});

test('revisioned commands acknowledge acceptance and reject stale retries without mutation', async () => {
  const store = await openStore({ name: `plakoto-test-${randomUUID()}` });
  const tables = createTestTables(store, () => 3);

  try {
    await tables.connect('ada');
    await tables.connect('basil');
    await tables.find('ada');

    const matched = await tables.find('basil');
    const message = matched.find((event) => event.userId === 'ada')?.message;

    assert.equal(message?.type, 'matched');

    if (message?.type !== 'matched') return;

    const stale = await tables.act(
      'ada',
      { type: 'roll' },
      {
        commandId: 'stale-roll',
        matchId: message.matchId,
        expectedRevision: message.revision + 1,
      },
    );
    const rejected = stale.find((event) => event.userId === 'ada')?.message;

    assert.equal(rejected?.type, 'update');

    if (rejected?.type !== 'update') return;

    assert.deepEqual(rejected.commandResult, {
      commandId: 'stale-roll',
      status: 'REJECTED',
      reason: 'STALE_REVISION',
    });
    assert.equal(rejected.revision, message.revision);
    assert.deepEqual(rejected.state, message.state);

    const accepted = await tables.act(
      'ada',
      { type: 'roll' },
      {
        commandId: 'current-roll',
        matchId: message.matchId,
        expectedRevision: message.revision,
      },
    );
    const update = accepted.find((event) => event.userId === 'ada')?.message;

    assert.equal(update?.type, 'update');

    if (update?.type !== 'update') return;

    assert.deepEqual(update.commandResult, {
      commandId: 'current-roll',
      status: 'ACCEPTED',
    });
    assert.ok(update.revision > message.revision);
  } finally {
    await store.drop();
  }
});

test('concurrent commands for one match serialize around one authoritative revision', async () => {
  const store = await openStore({ name: `plakoto-test-${randomUUID()}` });
  const tables = createTestTables(store, () => 3);

  try {
    await tables.connect('ada');
    await tables.connect('basil');
    await tables.find('ada');

    const matched = await tables.find('basil');
    const initial = matched.find((event) => event.userId === 'ada')?.message;

    assert.equal(initial?.type, 'matched');

    if (initial?.type !== 'matched') return;

    const results = await Promise.all(
      ['parallel-a', 'parallel-b'].map((commandId) =>
        tables.act(
          'ada',
          { type: 'roll' },
          {
            commandId,
            matchId: initial.matchId,
            expectedRevision: initial.revision,
          },
        ),
      ),
    );
    const statuses = results
      .flat()
      .filter((event) => event.userId === 'ada' && event.message.type === 'update')
      .map((event) =>
        event.message.type === 'update' ? event.message.commandResult?.status : undefined,
      )
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    assert.deepEqual(statuses, ['ACCEPTED', 'REJECTED']);
    assert.equal((await store.match(initial.matchId))?.revision, initial.revision + 1);
  } finally {
    await store.drop();
  }
});

test('MongoDB matchmaking keeps rulesets and balance profiles in separate queues', async () => {
  const store = await openStore({ name: `plakoto-test-${randomUUID()}` });
  const tables = createTestTables(store, () => 1);
  const standard = { ruleset: 'POWERUPS_V1', profileId: 'powerups-v1' } as const;
  const fast = { ruleset: 'POWERUPS_V1', profileId: 'fast-balance' } as const;

  try {
    await Promise.all(
      ['classic-1', 'classic-2', 'standard-1', 'standard-2', 'fast-1', 'fast-2'].map((id) =>
        tables.connect(id),
      ),
    );
    assert.equal((await tables.find('classic-1'))[0]?.message.type, 'waiting');
    assert.equal((await tables.find('standard-1', standard))[0]?.message.type, 'waiting');
    assert.equal((await tables.find('fast-1', fast))[0]?.message.type, 'waiting');

    const classic = await tables.find('classic-2');
    const standardMatch = await tables.find('standard-2', standard);
    const fastMatch = await tables.find('fast-2', fast);

    const matchedState = (events: Awaited<ReturnType<typeof tables.find>>) => {
      const message = events.find((event) => event.message.type === 'matched')?.message;

      assert.equal(message?.type, 'matched');

      return message?.type === 'matched' ? message.state : null;
    };

    assert.equal(matchedState(classic)?.ruleset, 'CLASSIC');
    assert.equal(matchedState(standardMatch)?.ruleset, 'POWERUPS_V1');
    assert.equal(matchedState(fastMatch)?.ruleset, 'POWERUPS_V1');
    assert.notEqual(
      matchedState(standardMatch)?.variantConfigHash,
      matchedState(fastMatch)?.variantConfigHash,
    );
  } finally {
    await store.drop();
  }
});

test('cancelling keeps the match and records the opponent as winner', async () => {
  const store = await openStore({ name: `plakoto-test-${randomUUID()}` });
  const first = createTestTables(store, () => 1);
  const second = createTestTables(store, () => 1);

  try {
    await first.connect('ada');
    await second.connect('basil');
    await first.find('ada');
    await second.find('basil');
    await first.sync();

    const live = await store.matchForUser('ada');

    assert.ok(live);
    await second.cancel('basil');

    const left = await first.sync();

    assert.equal(left.find((event) => event.userId === 'ada')?.message.type, 'left');
    assert.equal(await store.matchForUser('ada'), null);

    const kept = await store.match(live.id);

    assert.equal(kept?.winner, 'ada');
    assert.notEqual(kept?.endedAt, null);
  } finally {
    await store.drop();
  }
});

test('a finished game stays stored, and the next game is a new match', async () => {
  const store = await openStore({ name: `plakoto-test-${randomUUID()}` });
  const tables = createTestTables(store, () => 1);

  try {
    await tables.connect('ada');
    await tables.connect('basil');
    await tables.find('ada');
    await tables.find('basil');
    await tables.sync();

    const live = await store.matchForUser('ada');

    assert.ok(live);
    live.session.state.phase = 'GAME_OVER';
    live.session.state.outcome = {
      winner: 0,
      points: 1,
      reason: 'Bear-off',
      kind: 'BEAR_OFF',
    };
    assert.equal(await store.endMatch(live, 'ada'), true);

    const offer = await tables.act('ada', { type: 'restart' });

    assert.equal(offer.find((event) => event.userId === 'ada')?.message.type, 'rematch');
    assert.equal((await store.matchForUser('ada'))?.id, live.id);

    const restarted = await tables.act('basil', { type: 'restart' });
    const update = restarted.find((event) => event.userId === 'ada')?.message;

    assert.equal(update?.type, 'update');

    if (update?.type !== 'update') return;

    assert.equal(update.state.phase, 'WAITING_FOR_ROLL');
    assert.deepEqual(update.presentations, [
      { type: 'OPENING', blocking: true, attempts: [[6, 1]] },
    ]);

    const kept = await store.match(live.id);

    assert.equal(kept?.winner, 'ada');
    assert.equal(kept?.session.state.phase, 'GAME_OVER');

    const again = await store.matchForUser('ada');

    assert.notEqual(again?.id, live.id);
    assert.equal(again?.winner, null);

    const followed = await tables.sync();

    assert.equal(
      followed.find((event) => event.userId === 'basil'),
      undefined,
    );
    assert.equal(restarted.find((event) => event.userId === 'basil')?.message.type, 'update');
  } finally {
    await store.drop();
  }
});
