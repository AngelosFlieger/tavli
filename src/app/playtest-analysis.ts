import type { Player } from '../game/rules/position';
import type { SessionEvent } from '../game/session/transition';
import { ABILITY_IDS, type AbilityId, type AbilityInstance } from '../game/variant/types';
import type { PlaytestReport } from './playtest-report';

export type AbilityBalanceMetrics = {
  offered: number;
  picked: number;
  replacementPicks: number;
  replaced: number;
  used: number;
  effectsExpired: number;
  offerPickRate: number | null;
  usesPerPick: number | null;
  replacementPickRate: number | null;
  completedHoldSamples: number;
  completedHeldTurns: number;
  averageCompletedTurnsHeld: number | null;
  censoredHoldSamples: number;
  censoredHeldTurns: number;
  completedGamePicks: number;
  picksByWinner: number;
  pickWinRate: number | null;
  completedGameUses: number;
  usesByWinner: number;
  useWinRate: number | null;
};

export type BalanceGroup = {
  ruleset: PlaytestReport['selection']['ruleset'];
  profileId: string | null;
  configHash: string | null;
  reports: number;
  seeds: number[];
  completedGames: number;
  draws: number;
  completedTurns: number;
  averageTurnsPerCompletedGame: number | null;
  stalledTurns: [number, number];
  openingWinnerGames: number;
  openingWinnerWins: number;
  openingWinnerWinRate: number | null;
  draftFirstPickDecisions: number;
  draftFirstPickWins: number;
  draftFirstPickWinRate: number | null;
  abilities: Record<AbilityId, AbilityBalanceMetrics>;
};

export type BalanceAnalysis = {
  schemaVersion: 1;
  reportCount: number;
  rejectedCount: number;
  groups: BalanceGroup[];
};

type MutableGroup = Omit<
  BalanceGroup,
  | 'seeds'
  | 'averageTurnsPerCompletedGame'
  | 'openingWinnerWinRate'
  | 'draftFirstPickWinRate'
  | 'abilities'
> & {
  seeds: Set<number>;
  abilities: Record<AbilityId, AbilityBalanceMetrics>;
};

/** Aggregates reports without mixing distinct resolved configuration hashes. */
export function analyzePlaytestReports(
  reports: PlaytestReport[],
  rejectedCount = 0,
): BalanceAnalysis {
  const groups = new Map<string, MutableGroup>();

  for (const report of reports) {
    const profileId =
      report.selection.ruleset === 'POWERUPS_V1' ? report.selection.profileId : null;
    const key = `${report.selection.ruleset}:${profileId ?? 'classic'}:${report.configHash ?? 'none'}`;
    const group = groups.get(key) ?? createGroup(report, profileId);

    groups.set(key, group);
    aggregateReport(group, report);
  }

  return {
    schemaVersion: 1,
    reportCount: reports.length,
    rejectedCount,
    groups: [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, group]) => finalizeGroup(group)),
  };
}

/** Validates imported JSON before it reaches the typed analyzer. */
export function parsePlaytestReport(value: unknown): PlaytestReport | null {
  if (!isRecord(value)) return null;
  if (
    value.schemaVersion !== 1 ||
    value.mode !== 'LOCAL' ||
    typeof value.startedAt !== 'string' ||
    !isSeed(value.seed) ||
    !(value.configHash === null || typeof value.configHash === 'string') ||
    !isReportSelection(value.selection) ||
    !Array.isArray(value.entries) ||
    !isRecord(value.summary)
  )
    return null;
  if (!value.entries.every(isReportEntry)) return null;

  return value as PlaytestReport;
}

function createGroup(report: PlaytestReport, profileId: string | null): MutableGroup {
  return {
    ruleset: report.selection.ruleset,
    profileId,
    configHash: report.configHash,
    reports: 0,
    seeds: new Set(),
    completedGames: 0,
    draws: 0,
    completedTurns: 0,
    stalledTurns: [0, 0],
    openingWinnerGames: 0,
    openingWinnerWins: 0,
    draftFirstPickDecisions: 0,
    draftFirstPickWins: 0,
    abilities: Object.fromEntries(
      ABILITY_IDS.map((abilityId) => [abilityId, emptyAbilityMetrics()]),
    ) as Record<AbilityId, AbilityBalanceMetrics>,
  };
}

function aggregateReport(group: MutableGroup, report: PlaytestReport): void {
  group.reports++;
  group.seeds.add(report.seed);

  const events = report.entries.flatMap((entry) => entry.events);
  const outcome = [...events]
    .reverse()
    .find((event): event is Extract<SessionEvent, { type: 'GameEnded' }> =>
      isEvent(event, 'GameEnded'),
    )?.outcome;
  const completed = outcome !== undefined;
  const turnCount = events.filter((event) => isEvent(event, 'TurnEnded')).length;

  if (completed) {
    group.completedGames++;
    group.completedTurns += turnCount;

    if (outcome.winner === null) group.draws++;
  }

  const openingWinner = events.find(
    (event): event is Extract<SessionEvent, { type: 'OpeningResolved' }> =>
      isEvent(event, 'OpeningResolved'),
  )?.player;

  if (completed && openingWinner !== undefined) {
    group.openingWinnerGames++;

    if (outcome.winner === openingWinner) group.openingWinnerWins++;
  }

  for (const event of events) {
    if (isEvent(event, 'DraftOpened'))
      for (const abilityId of event.offer) group.abilities[abilityId].offered++;
    if (isEvent(event, 'AbilityPicked')) {
      const metrics = group.abilities[event.abilityId];

      metrics.picked++;

      if (completed) {
        metrics.completedGamePicks++;

        if (outcome.winner === event.player) metrics.picksByWinner++;
      }
    }
    if (isEvent(event, 'AbilityReplaced')) group.abilities[event.abilityId].replaced++;
    if (isEvent(event, 'AbilityUsed')) {
      const metrics = group.abilities[event.abilityId];

      metrics.used++;

      if (completed) {
        metrics.completedGameUses++;

        if (outcome.winner === event.player) metrics.usesByWinner++;
      }
    }
    if (isEvent(event, 'EffectExpired')) group.abilities[event.abilityId].effectsExpired++;
    if (isEvent(event, 'NoLegalMoves')) {
      const entry = report.entries.find((candidate) => candidate.events.includes(event));

      if (entry?.state.active !== null && entry?.state.active !== undefined)
        group.stalledTurns[entry.state.active]++;
    }
    if (completed && isEvent(event, 'DraftOrderChosen')) {
      group.draftFirstPickDecisions++;

      if (outcome.winner === event.first) group.draftFirstPickWins++;
    }
  }

  for (const entry of report.entries) {
    const picked = entry.events.find(
      (event): event is Extract<SessionEvent, { type: 'AbilityPicked' }> =>
        isEvent(event, 'AbilityPicked'),
    );

    if (picked && entry.events.some((event) => isEvent(event, 'AbilityReplaced')))
      group.abilities[picked.abilityId].replacementPicks++;
  }

  aggregateHoldTimes(group, report, completed);
}

function aggregateHoldTimes(group: MutableGroup, report: PlaytestReport, completed: boolean): void {
  let turns = 0;
  const held = new Map<string, { abilityId: AbilityId; acquiredTurn: number }>();

  for (const entry of report.entries) {
    turns += entry.events.filter((event) => isEvent(event, 'TurnEnded')).length;

    const current = new Map(
      (entry.state.loadouts ?? [])
        .flatMap((loadout) => [...loadout.powerups, ...loadout.passives])
        .map((instance) => [instance.instanceId, instance] as const),
    );

    for (const [instanceId, tracked] of held) {
      if (current.has(instanceId)) continue;

      closeHold(group.abilities[tracked.abilityId], turns - tracked.acquiredTurn, false);
      held.delete(instanceId);
    }
    for (const instance of current.values()) {
      if (!held.has(instance.instanceId))
        held.set(instance.instanceId, { abilityId: instance.abilityId, acquiredTurn: turns });
    }
  }
  for (const tracked of held.values())
    closeHold(group.abilities[tracked.abilityId], turns - tracked.acquiredTurn, !completed);
}

function closeHold(metrics: AbilityBalanceMetrics, turns: number, censored: boolean): void {
  if (censored) {
    metrics.censoredHoldSamples++;
    metrics.censoredHeldTurns += turns;
  } else {
    metrics.completedHoldSamples++;
    metrics.completedHeldTurns += turns;
  }
}

function finalizeGroup(group: MutableGroup): BalanceGroup {
  for (const metrics of Object.values(group.abilities)) {
    metrics.averageCompletedTurnsHeld = rate(
      metrics.completedHeldTurns,
      metrics.completedHoldSamples,
    );
    metrics.offerPickRate = rate(metrics.picked, metrics.offered);
    metrics.usesPerPick = rate(metrics.used, metrics.picked);
    metrics.replacementPickRate = rate(metrics.replacementPicks, metrics.picked);
    metrics.pickWinRate = rate(metrics.picksByWinner, metrics.completedGamePicks);
    metrics.useWinRate = rate(metrics.usesByWinner, metrics.completedGameUses);
  }

  return {
    ...group,
    seeds: [...group.seeds].sort((left, right) => left - right),
    averageTurnsPerCompletedGame: rate(group.completedTurns, group.completedGames),
    openingWinnerWinRate: rate(group.openingWinnerWins, group.openingWinnerGames),
    draftFirstPickWinRate: rate(group.draftFirstPickWins, group.draftFirstPickDecisions),
  };
}

function emptyAbilityMetrics(): AbilityBalanceMetrics {
  return {
    offered: 0,
    picked: 0,
    replacementPicks: 0,
    replaced: 0,
    used: 0,
    effectsExpired: 0,
    offerPickRate: null,
    usesPerPick: null,
    replacementPickRate: null,
    completedHoldSamples: 0,
    completedHeldTurns: 0,
    averageCompletedTurnsHeld: null,
    censoredHoldSamples: 0,
    censoredHeldTurns: 0,
    completedGamePicks: 0,
    picksByWinner: 0,
    pickWinRate: null,
    completedGameUses: 0,
    usesByWinner: 0,
    useWinRate: null,
  };
}

function rate(numerator: number, denominator: number): number | null {
  return denominator ? numerator / denominator : null;
}

function isEvent<Type extends SessionEvent['type']>(
  event: SessionEvent,
  type: Type,
): event is Extract<SessionEvent, { type: Type }> {
  return event.type === type;
}

function isReportSelection(value: unknown): value is PlaytestReport['selection'] {
  if (!isRecord(value)) return false;
  if (value.ruleset === 'CLASSIC') return value.profileId === undefined;

  return (
    value.ruleset === 'POWERUPS_V1' && typeof value.profileId === 'string' && !!value.profileId
  );
}

function isReportEntry(value: unknown): boolean {
  if (!isRecord(value) || !Number.isInteger(value.index) || !Array.isArray(value.events))
    return false;
  if (!value.events.every(isReportEvent) || !isRecord(value.state)) return false;

  const state = value.state;

  return (
    (state.active === null || state.active === 0 || state.active === 1) &&
    Number.isInteger(state.round) &&
    Array.isArray(state.roll) &&
    Array.isArray(state.remaining) &&
    (state.loadouts === null || isLoadouts(state.loadouts)) &&
    Array.isArray(state.activeEffects) &&
    (state.outcome === null || isOutcome(state.outcome))
  );
}

function isReportEvent(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'DraftOpened')
    return Array.isArray(value.offer) && value.offer.every(isAbilityId);
  if (value.type === 'AbilityPicked' || value.type === 'AbilityUsed')
    return isAbilityId(value.abilityId) && isPlayer(value.player);
  if (value.type === 'AbilityReplaced') return isAbilityId(value.abilityId);
  if (value.type === 'EffectExpired') return isAbilityId(value.abilityId);
  if (value.type === 'OpeningResolved')
    return (
      isPlayer(value.player) &&
      Array.isArray(value.attempts) &&
      value.attempts.every(
        (attempt) =>
          Array.isArray(attempt) && attempt.length === 2 && attempt.every((die) => isDie(die)),
      )
    );
  if (value.type === 'DraftOrderChosen') return isPlayer(value.first);
  if (value.type === 'GameEnded') return isOutcome(value.outcome);

  return true;
}

function isDie(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 6;
}

function isLoadouts(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(
      (loadout) =>
        isRecord(loadout) &&
        Array.isArray(loadout.powerups) &&
        Array.isArray(loadout.passives) &&
        [...loadout.powerups, ...loadout.passives].every(isAbilityInstance),
    )
  );
}

function isAbilityInstance(value: unknown): value is AbilityInstance {
  return isRecord(value) && typeof value.instanceId === 'string' && isAbilityId(value.abilityId);
}

function isOutcome(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.winner === null || isPlayer(value.winner)) &&
    Number.isInteger(value.points) &&
    typeof value.reason === 'string'
  );
}

function isAbilityId(value: unknown): value is AbilityId {
  return typeof value === 'string' && ABILITY_IDS.includes(value as AbilityId);
}

function isPlayer(value: unknown): value is Player {
  return value === 0 || value === 1;
}

function isSeed(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 0xffff_ffff;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
