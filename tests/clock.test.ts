import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceClock,
  clockConfigFromEnv,
  clockExpired,
  DEFAULT_CLOCK,
  formatClock,
  pauseClock,
  remainingMs,
  resumeClock,
  startClock,
} from '../src/game/clock';
import { createTables } from '../server/tables';
import { openStore } from '../server/store';
import { nonTiedOpeningRandom } from './support/opening-random';
import { randomUUID } from 'node:crypto';

test('clock configuration has safe defaults and environment overrides', () => {
  assert.deepEqual(clockConfigFromEnv({}), DEFAULT_CLOCK);
  assert.deepEqual(clockConfigFromEnv({ PLAKOTO_CLOCK: 'off' }), {
    enabled: false,
    openingMs: 0,
    turnMs: 0,
    bankMs: 0,
  });
  const tuned = clockConfigFromEnv({
    PLAKOTO_CLOCK_TURN_SECONDS: '45',
    PLAKOTO_CLOCK_OPENING_SECONDS: '10',
    PLAKOTO_CLOCK_BANK_SECONDS: '5',
  });
  assert.equal(tuned.turnMs, 45_000);
  assert.equal(tuned.openingMs, 10_000);
  assert.equal(tuned.bankMs, 5_000);
  assert.equal(
    clockConfigFromEnv({ PLAKOTO_CLOCK_TURN_SECONDS: 'nope' }).turnMs,
    DEFAULT_CLOCK.turnMs,
  );
});

test('clock pauses, resumes, advances between turns, and formats remaining time', () => {
  const config = { enabled: true, openingMs: 30_000, turnMs: 60_000, bankMs: 1_000 };
  assert.equal(startClock(config, 'OPENING', 1_000), null);
  let clock = startClock(config, 'WAITING_FOR_ROLL', 1_000);
  assert.equal(clock?.deadline, 62_000);
  clock = pauseClock(clock, 12_000);
  assert.equal(clock?.running, false);
  assert.equal(remainingMs(clock, 99_000), 50_000);
  clock = resumeClock(clock, 20_000);
  assert.equal(clock?.deadline, 70_000);
  assert.equal(clockExpired(clock, 69_999), false);
  assert.equal(clockExpired(clock, 70_000), true);
  assert.equal(formatClock({ remainingMs: 65_000, deadline: null, running: false }, 0), '1:05');
  const next = advanceClock(clock, 'TURN_COMPLETE', 'WAITING_FOR_ROLL', config, 50_000);
  assert.equal(next?.deadline, 111_000);
  assert.equal(
    advanceClock(next, 'WAITING_FOR_ROLL', 'DRAFT_PICK', config, 60_000)?.running,
    false,
  );
  assert.equal(advanceClock(next, 'WAITING_FOR_ROLL', 'GAME_OVER', config, 60_000), null);
});

test('the server clock expires the active seat through the revision guard', async () => {
  const store = await openStore({ name: `plakoto-test-${randomUUID()}` });
  let now = 1_000;
  const tables = createTables(
    store,
    () => 1,
    () => now,
    undefined,
    {
      enabled: true,
      openingMs: 100,
      turnMs: 200,
      bankMs: 0,
    },
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
    now += 201;
    const events = await tables.sync();
    assert.equal(events.find((event) => event.userId === 'ada')?.message.type, 'update');
    const ended = await store.match(live.id);
    assert.equal(ended?.winner, 'basil');
    assert.equal(ended?.session.state.phase, 'GAME_OVER');
    assert.equal(ended?.session.state.outcome?.kind, 'TIMEOUT');
  } finally {
    await store.drop();
  }
});

test('disconnect persists the paused clock with elapsed time deducted', async () => {
  const store = await openStore({ name: `plakoto-test-${randomUUID()}` });
  let now = 1_000;
  const tables = createTables(
    store,
    () => 1,
    () => now,
    undefined,
    { enabled: true, openingMs: 100, turnMs: 10_000, bankMs: 0 },
    nonTiedOpeningRandom(),
  );
  try {
    await tables.connect('ada');
    await tables.connect('basil');
    await tables.find('ada');
    await tables.find('basil');
    const before = await store.matchForUser('ada');
    assert.ok(before?.session.state.clock?.running);
    now += 2_500;
    await tables.disconnect('ada');
    const paused = await store.matchForUser('ada');
    assert.equal(paused?.session.state.clock?.running, false);
    assert.equal(paused?.session.state.clock?.deadline, null);
    assert.equal(paused?.session.state.clock?.remainingMs, 7_500);
  } finally {
    await store.drop();
  }
});
