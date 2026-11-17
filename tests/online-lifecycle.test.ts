import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initialGameState, type Session } from '../src/game/session/state';
import { matchKey, rulesForSelection } from '../src/game/variant/rules-context';
import { isCommand, isHello, isProtocolCompatible, PROTOCOL_VERSION } from '../src/net/messages';
import { createTables } from '../server/tables';
import { openStore } from '../server/store';

const isolatedStore = () => openStore({ name: `plakoto-test-${randomUUID()}` });

test('the handshake accepts only integer protocol versions and forfeits explicitly', () => {
  assert.equal(isHello({ type: 'hello', protocol: PROTOCOL_VERSION }), true);
  assert.equal(isHello({ type: 'hello', protocol: 1.5 }), false);
  assert.equal(isHello({ type: 'find' }), false);
  assert.equal(isProtocolCompatible(PROTOCOL_VERSION), true);
  assert.equal(isProtocolCompatible(PROTOCOL_VERSION + 1), false);
  assert.equal(isCommand({ type: 'forfeit' }), true);
});

test('a queued opponent that never connects forfeits at the shorter no-show deadline', async () => {
  const store = await isolatedStore();
  let now = 1_000;
  const tables = createTables(
    store,
    () => 1,
    () => now,
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
  const tables = createTables(store, () => 1);
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
  const tables = createTables(store, () => 1);
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
