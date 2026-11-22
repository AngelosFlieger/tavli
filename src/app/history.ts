import type { Outcome, Player } from '../game/rules/position';

export type HistoryEntry = {
  version: 1;
  id: string;
  at: number;
  mode: 'LOCAL' | 'ONLINE';
  ruleset: 'CLASSIC' | 'POWERUPS_V1';
  winner: Player | null;
  kind: Outcome['kind'];
  points: number;
  rounds: number;
};

const storageKey = 'plakoto-history';

export const historyLimit = 50;

export function createHistoryEntry(
  values: {
    mode: 'LOCAL' | 'ONLINE';
    ruleset: 'CLASSIC' | 'POWERUPS_V1';
    outcome: Outcome;
    rounds: number;
  },
  now = Date.now(),
  id = `${now}-${Math.random().toString(36).slice(2, 8)}`,
): HistoryEntry {
  return {
    version: 1,
    id,
    at: now,
    mode: values.mode,
    ruleset: values.ruleset,
    winner: values.outcome.winner,
    kind: values.outcome.kind,
    points: values.outcome.points,
    rounds: values.rounds,
  };
}

/** Pure list management: keeps the newest entries and enforces the cap. */
export function addHistoryEntry(entries: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...entries.filter((existing) => existing.id !== entry.id)]
    .sort((left, right) => right.at - left.at)
    .slice(0, historyLimit);
}

export function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== 'object') return false;

  const entry = value as Partial<HistoryEntry>;

  return (
    entry.version === 1 &&
    typeof entry.id === 'string' &&
    typeof entry.at === 'number' &&
    (entry.mode === 'LOCAL' || entry.mode === 'ONLINE') &&
    (entry.ruleset === 'CLASSIC' || entry.ruleset === 'POWERUPS_V1') &&
    (entry.winner === 0 || entry.winner === 1 || entry.winner === null) &&
    typeof entry.kind === 'string' &&
    typeof entry.points === 'number' &&
    typeof entry.rounds === 'number'
  );
}

export function parseHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];

  return raw.filter(isHistoryEntry);
}

export function loadHistory(): HistoryEntry[] {
  try {
    return parseHistory(JSON.parse(localStorage.getItem(storageKey) ?? '[]'));
  } catch {
    return [];
  }
}

export function saveHistory(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(entries.slice(0, historyLimit)));
  } catch {
    // Private mode or quota failures keep the in-memory list only.
  }
}

export function clearHistory() {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // Nothing to do.
  }
}
