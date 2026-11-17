import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { legalMoves } from '../src/game/rules/moves';
import { initialPresentedSession } from '../src/game/session/messages';
import { initialGameState } from '../src/game/session/state';
import { createPowerupsV1Input } from '../src/game/variant/config/profiles/v1';
import { resolveVariantConfig } from '../src/game/variant/config/schema';
import { powerupsRules } from '../src/game/variant/types';
import { openStore } from '../server/store';
import { createTables } from '../server/tables';

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

test('a stored configuration snapshot restores without a registered profile', async () => {
  const store = await openStore({ name: `plakoto-test-${randomUUID()}` });
  const input = createPowerupsV1Input();
  input.id = 'stored-balance-test';
  input.draft.intervalRounds = 2;
  const config = resolveVariantConfig(input);
  const tables = createTables(store, () => 1);
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
  const first = createTables(store, next, clock);
  const second = createTables(store, next, clock);
  try {
    await first.connect('ada');
    await second.connect('basil');
    assert.equal((await first.find('ada'))[0]?.message.type, 'waiting');
    const matched = await second.find('basil');
    assert.equal(matched.find((event) => event.userId === 'basil')?.message.type, 'matched');
    const seen = await first.sync();
    assert.equal(seen.find((event) => event.userId === 'ada')?.message.type, 'matched');

    const rolled = await first.act('ada', { type: 'roll' });
    assert.equal(rolled[0]?.message.type, 'update');
    if (rolled[0]?.message.type !== 'update') return;
    const followed = await second.sync();
    const update = followed.find((event) => event.userId === 'basil')?.message;
    assert.equal(update?.type, 'update');
    if (update?.type !== 'update') return;
    assert.deepEqual(update.dice, [6, 1]);
    assert.deepEqual(update.events, rolled[0].message.events);

    const opening = await second.act('basil', { type: 'roll' });
    const openingUpdate = opening[0]?.message;
    assert.equal(openingUpdate?.type, 'update');
    if (openingUpdate?.type !== 'update') return;
    const openingFollowed = (await first.sync()).find((event) => event.userId === 'ada')?.message;
    assert.equal(openingFollowed?.type, 'update');
    if (openingFollowed?.type !== 'update') return;
    assert.deepEqual(openingFollowed.events, openingUpdate.events);

    const movement = await second.act('basil', { type: 'roll' });
    const movementUpdate = movement[0]?.message;
    assert.equal(movementUpdate?.type, 'update');
    if (movementUpdate?.type !== 'update') return;
    const movementFollowed = (await first.sync()).find((event) => event.userId === 'ada')?.message;
    assert.equal(movementFollowed?.type, 'update');
    if (movementFollowed?.type !== 'update') return;
    assert.deepEqual(movementFollowed.dice, movementUpdate.dice);
    assert.deepEqual(movementFollowed.events, movementUpdate.events);

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
    assert.deepEqual(moveFollowed.sequence, [move]);
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

test('MongoDB matchmaking keeps rulesets and balance profiles in separate queues', async () => {
  const store = await openStore({ name: `plakoto-test-${randomUUID()}` });
  const tables = createTables(store, () => 1);
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
  const first = createTables(store, () => 1);
  const second = createTables(store, () => 1);
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
  const tables = createTables(store, () => 1);
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
    assert.equal(update.state.phase, 'OPENING_ROLL');
    assert.equal(update.resetDice, true);
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
