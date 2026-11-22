import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addHistoryEntry,
  createHistoryEntry,
  historyLimit,
  parseHistory,
} from '../src/app/history';

const outcome = {
  winner: 0 as 0 | 1 | null,
  points: 1,
  reason: 'All checkers borne off',
  kind: 'BEAR_OFF' as const,
};

test('history entries are validated, deduplicated, and capped', () => {
  const first = createHistoryEntry(
    { mode: 'LOCAL', ruleset: 'CLASSIC', outcome, rounds: 7 },
    1_000,
    'a',
  );
  const second = createHistoryEntry(
    { mode: 'ONLINE', ruleset: 'POWERUPS_V1', outcome, rounds: 5 },
    2_000,
    'b',
  );

  const merged = addHistoryEntry([first], second);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 'b');

  assert.equal(addHistoryEntry(merged, first).length, 2);

  const parsed = parseHistory(JSON.parse(JSON.stringify(merged)));

  assert.equal(parsed.length, 2);
  assert.equal(parseHistory([{ version: 2 }]).length, 0);

  const many = Array.from({ length: historyLimit + 5 }, (_, index) =>
    createHistoryEntry(
      { mode: 'LOCAL', ruleset: 'CLASSIC', outcome, rounds: index },
      index,
      `id-${index}`,
    ),
  );

  assert.equal(addHistoryEntry([], many.at(-1)!).length, 1);

  const capped = many.reduce(
    (acc, entry) => addHistoryEntry(acc, entry),
    [] as ReturnType<typeof addHistoryEntry>,
  );

  assert.equal(capped.length, historyLimit);
});
