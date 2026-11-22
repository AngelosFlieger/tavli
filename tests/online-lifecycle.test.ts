import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initialGameState, type Session } from '../src/game/session/state';
import { matchKey, rulesForSelection } from '../src/game/variant/rules-context';
import {
  isCommand,
  isAuthorityCursor,
  isHello,
  isNetworkGameState,
  isProtocolCompatible,
  isRevisionedCommand,
  isRevisionedUpdate,
  PROTOCOL_MIN_VERSION,
  PROTOCOL_VERSION,
} from '../src/net/messages';
import { createTables } from '../server/tables';
import { openStore } from '../server/store';
import { nonTiedOpeningRandom } from './support/opening-random';

const isolatedStore = () => openStore({ name: `plakoto-test-${randomUUID()}` });

test('the handshake accepts only integer protocol versions and forfeits explicitly', () => {
  assert.equal(isHello({ type: 'hello', protocol: PROTOCOL_VERSION }), true);
  assert.equal(isHello({ type: 'hello', protocol: 1.5 }), false);
  assert.equal(isHello({ type: 'find' }), false);
  assert.equal(isProtocolCompatible(PROTOCOL_VERSION), true);
  assert.equal(isProtocolCompatible(PROTOCOL_MIN_VERSION), true);
  assert.equal(isProtocolCompatible(PROTOCOL_MIN_VERSION - 1), false);
  assert.equal(isProtocolCompatible(PROTOCOL_VERSION + 1), false);
  assert.equal(isAuthorityCursor({ matchId: 'match-1', revision: 0 }), true);
  assert.equal(isAuthorityCursor({ matchId: '', revision: 0 }), false);
  assert.equal(isAuthorityCursor({ matchId: 'match-1', revision: -1 }), false);
  assert.equal(
    isRevisionedCommand({
      type: 'command',
      commandId: 'command-1',
      matchId: 'match-1',
      expectedRevision: 0,
      command: { type: 'roll' },
    }),
    true,
  );
  assert.equal(
    isRevisionedCommand({
      type: 'command',
      commandId: '',
      matchId: 'match-1',
      expectedRevision: 0,
      command: { type: 'roll' },
    }),
    false,
  );
  assert.equal(isCommand({ type: 'forfeit' }), true);
  assert.equal(isProtocolCompatible(2), false);
});

test('presentation jobs and update metadata are discriminated and revision-bound', () => {
  const state = initialGameState();
  const dice = {
    type: 'DICE' as const,
    blocking: true as const,
    values: [6, 1] as [number, number],
    rerolledDie: 0 as const,
  };

  assert.equal(
    isRevisionedUpdate({
      matchId: 'match-1',
      revision: 1,
      state,
      canUndo: false,
      presentations: [dice],
    }),
    true,
  );
  assert.equal(
    isRevisionedUpdate({
      matchId: 'match-1',
      revision: 1,
      state,
      canUndo: false,
      presentations: [{ type: 'DICE', blocking: false, values: [6, 1] }],
    }),
    false,
  );

  const opened = structuredClone(state);

  opened.opening = {
    status: 'RESOLVED',
    attempts: [
      [3, 3],
      [6, 1],
    ],
    winner: 0,
  };
  opened.phase = 'WAITING_FOR_ROLL';
  opened.active = 0;
  opened.roll = [6, 1];

  const openingUpdate = {
    matchId: 'match-1',
    revision: 0,
    state: opened,
    canUndo: false,
  };

  assert.equal(
    isRevisionedUpdate({
      ...openingUpdate,
      presentations: [
        {
          type: 'OPENING',
          blocking: true,
          attempts: [
            [3, 3],
            [6, 1],
          ],
        },
      ],
    }),
    true,
  );
  assert.equal(
    isRevisionedUpdate({
      ...openingUpdate,
      presentations: [
        {
          type: 'OPENING',
          blocking: true,
          attempts: [
            [3, 3],
            [5, 1],
          ],
        },
      ],
    }),
    false,
  );
  assert.equal(
    isRevisionedUpdate({
      ...openingUpdate,
      presentations: [
        {
          type: 'OPENING',
          blocking: true,
          attempts: [
            [3, 2],
            [6, 1],
          ],
        },
      ],
    }),
    false,
  );

  const contradictory = structuredClone(state);

  contradictory.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  assert.equal(isNetworkGameState(contradictory), false);
  assert.equal(
    isRevisionedUpdate({
      matchId: 'match-1',
      revision: 1,
      state: contradictory,
      canUndo: false,
      presentations: [],
    }),
    false,
  );

  const powerups = initialGameState(
    rulesForSelection({ ruleset: 'POWERUPS_V1', profileId: 'powerups-v1' }),
  );

  powerups.powerups!.loadouts[0].powerups.push({
    instanceId: 'bad-copy',
    abilityId: 'not-an-ability' as never,
  });
  assert.equal(isNetworkGameState(powerups), false);
  assert.equal(
    isRevisionedUpdate({
      matchId: 'match-1',
      revision: 1,
      state: { ...state, board: [] },
      canUndo: false,
      presentations: [],
    }),
    false,
  );
  assert.equal(
    isRevisionedUpdate({
      matchId: 'match-1',
      revision: 1,
      state,
      canUndo: false,
      presentations: [dice, { type: 'RESET_DICE', blocking: false }],
    }),
    false,
  );
  assert.equal(
    isRevisionedUpdate({
      matchId: 'match-1',
      revision: 1,
      state,
      canUndo: false,
      presentations: [],
      commandResult: { commandId: 'command-1', status: 'ACCEPTED', reason: 'INVALID_COMMAND' },
    }),
    false,
  );
  assert.equal(
    isRevisionedUpdate({
      matchId: 'match-1',
      revision: 1,
      state,
      canUndo: false,
      presentations: [],
      events: [{ type: 'DiceRolled', player: 0, values: [9] }],
    }),
    false,
  );
});

test('a queued opponent that never connects forfeits at the shorter no-show deadline', async () => {
  const store = await isolatedStore();
  let now = 1_000;
  const tables = createTables(
    store,
    () => 1,
    () => now,
    undefined,
    undefined,
    nonTiedOpeningRandom(),
  );

  try {
    await tables.connect('ada');
    await tables.find('ada');
    await tables.find('basil');

    const live = await store.matchForUser('ada');

    assert.ok(live);
    now += 20_001;

    const events = await tables.sync();

    assert.deepEqual(
      events.map((event) => [event.userId, event.message.type]),
      [
        ['ada', 'update'],
        ['ada', 'left'],
      ],
    );

    const update = events.find((event) => event.userId === 'ada')?.message;

    assert.equal(update?.type, 'update');

    if (update?.type !== 'update') return;

    assert.equal(update.state.phase, 'GAME_OVER');
    assert.equal(update.state.outcome?.kind, 'NO_SHOW');
    assert.equal(update.state.outcome?.winner, 0);
    assert.equal(await store.matchForUser('ada'), null);

    const ended = await store.match(live.id);

    assert.equal(ended?.session.state.outcome?.kind, 'NO_SHOW');
  } finally {
    await store.drop();
  }
});

test('resignation stores a typed result and keeps the match available for a rematch', async () => {
  const store = await isolatedStore();
  const tables = createTables(
    store,
    () => 1,
    undefined,
    undefined,
    undefined,
    nonTiedOpeningRandom(),
  );

  try {
    await tables.connect('ada');
    await tables.connect('basil');
    await tables.find('ada');
    await tables.find('basil');
    await tables.sync();

    const live = await store.matchForUser('ada');

    assert.ok(live);

    const events = await tables.act('ada', { type: 'forfeit' });

    assert.deepEqual(events.map((event) => event.userId).sort(), ['ada', 'basil']);

    const kept = await store.match(live.id);

    assert.equal(kept?.winner, 'basil');
    assert.equal(kept?.session.state.phase, 'GAME_OVER');
    assert.equal(kept?.session.state.outcome?.kind, 'RESIGNATION');
    assert.equal(kept?.session.state.outcome?.winner, 1);
    assert.equal((await store.matchForUser('ada'))?.id, live.id);
  } finally {
    await store.drop();
  }
});

test('startup clears volatile queues and gives live matches a reconnect grace', async () => {
  const store = await isolatedStore();
  const tables = createTables(
    store,
    () => 1,
    undefined,
    undefined,
    undefined,
    nonTiedOpeningRandom(),
  );

  try {
    await tables.connect('ada');
    await tables.connect('basil');
    await tables.find('ada');
    await tables.find('basil');
    await store.wait('stray', matchKey(rulesForSelection({ ruleset: 'CLASSIC' })));
    await tables.start();
    assert.equal(await store.queued('stray'), false);

    const live = await store.matchForUser('ada');

    assert.ok(live);
    assert.notEqual(live.away[0], null);
    assert.notEqual(live.away[1], null);
    assert.equal((await tables.connect('ada'))[0]?.message.type, 'resume');
  } finally {
    await store.drop();
  }
});

test('stored sessions with a malformed board are rejected instead of resumed', async () => {
  const store = await isolatedStore();

  try {
    const state = initialGameState();
    const bad = { state: { ...state, board: [] }, history: [] } as unknown as Session;

    assert.equal(
      await store.insertMatch({
        id: 'malformed',
        seats: ['ada', 'basil'],
        session: bad,
        variantConfig: null,
        lastUpdate: null,
        revision: 0,
        away: [null, null],
        connected: [true, true],
        endedAt: null,
        winner: null,
      }),
      true,
    );
    assert.equal(await store.match('malformed'), null);
  } finally {
    await store.drop();
  }
});

test('stored sessions with contradictory semantic state are rejected instead of resumed', async () => {
  const store = await isolatedStore();

  try {
    const state = initialGameState();

    state.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
    assert.equal(
      await store.insertMatch({
        id: 'contradictory',
        seats: ['ada', 'basil'],
        session: { state, history: [] },
        variantConfig: null,
        lastUpdate: null,
        revision: 0,
        away: [null, null],
        connected: [true, true],
        endedAt: null,
        winner: null,
      }),
      true,
    );
    assert.equal(await store.match('contradictory'), null);
  } finally {
    await store.drop();
  }
});

test('stored sessions reject malformed nested variant state through the shared decoder', async () => {
  const store = await isolatedStore();

  try {
    const rules = rulesForSelection({ ruleset: 'POWERUPS_V1', profileId: 'powerups-v1' });
    const state = initialGameState(rules);

    state.powerups!.loadouts[0].powerups.push({
      instanceId: 'bad-copy',
      abilityId: 'not-an-ability' as never,
    });
    assert.equal(
      await store.insertMatch({
        id: 'malformed-powerups',
        seats: ['ada', 'basil'],
        session: { state, history: [] },
        variantConfig: rules.variantConfig,
        lastUpdate: null,
        revision: 0,
        away: [null, null],
        connected: [true, true],
        endedAt: null,
        winner: null,
      }),
      true,
    );
    assert.equal(await store.match('malformed-powerups'), null);
  } finally {
    await store.drop();
  }
});
