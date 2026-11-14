import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initialGameState } from '../src/game/session/state';
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
        revision: 0,
        away: [null, null],
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

test('two processes pair through MongoDB and both see the same roll', async () => {
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

    await first.disconnect('ada');
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
    assert.equal(left.find((event) => event.userId === 'basil')?.message.type, 'left');
    assert.equal(await store.matchForUser('basil'), null);
    const kept = await store.match(live.id);
    assert.equal(kept?.winner, 'basil');
    assert.notEqual(kept?.endedAt, null);
    assert.equal(kept?.session.state.phase, live.session.state.phase);
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
    live.session.state.phase = 'GAME_OVER';
    live.session.state.outcome = { winner: 0, points: 1, reason: 'Bear-off' };
    assert.equal(await store.endMatch(live, 'ada'), true);
    const restarted = await first.act('ada', { type: 'restart' });
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
    const followed = await second.sync();
    assert.equal(followed.find((event) => event.userId === 'basil')?.message.type, 'update');
  } finally {
    await store.drop();
  }
});
