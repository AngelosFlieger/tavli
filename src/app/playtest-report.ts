import type { Player } from '../game/rules/position';
import type { GameState } from '../game/session/state';
import type { SessionEvent } from '../game/session/transition';
import type { AbilityId, ActiveEffect, PlayerLoadout } from '../game/variant/types';
import type { MatchSelection } from '../net/messages';

export type PlaytestMetadata = {
  mode: 'LOCAL';
  selection: MatchSelection;
  seed: number;
  configHash: string | null;
};

export type PlaytestStateSnapshot = {
  phase: GameState['phase'];
  active: Player | null;
  round: number;
  roll: number[];
  remaining: number[];
  loadouts: [PlayerLoadout, PlayerLoadout] | null;
  activeEffects: ActiveEffect[];
  outcome: GameState['outcome'];
};

export type PlaytestEntry = {
  index: number;
  events: SessionEvent[];
  state: PlaytestStateSnapshot;
};

export type PlaytestSummary = {
  draftsOpened: number;
  stalledTurns: [number, number];
  picks: Partial<Record<AbilityId, number>>;
  uses: Partial<Record<AbilityId, number>>;
  effectsExpired: Partial<Record<AbilityId, number>>;
  winner: Player | null | undefined;
  points: number | undefined;
  reason: string | undefined;
};

export type PlaytestReport = PlaytestMetadata & {
  schemaVersion: 1;
  startedAt: string;
  entries: PlaytestEntry[];
  summary: PlaytestSummary;
};

/** Keeps balance telemetry in memory; nothing is sent off-device. */
export class PlaytestRecorder {
  private report: PlaytestReport | null = null;

  constructor(private readonly now: () => Date = () => new Date()) {}

  start(metadata: PlaytestMetadata): void {
    this.report = {
      schemaVersion: 1,
      ...structuredClone(metadata),
      startedAt: this.now().toISOString(),
      entries: [],
      summary: emptySummary(),
    };
  }

  clear(): void {
    this.report = null;
  }

  record(events: SessionEvent[], state: GameState): void {
    if (!this.report || !events.length) return;
    const entry: PlaytestEntry = {
      index: this.report.entries.length,
      events: structuredClone(events),
      state: snapshotState(state),
    };
    this.report.entries.push(entry);
    updateSummary(this.report.summary, events, state);
  }

  snapshot(): PlaytestReport | null {
    return this.report ? structuredClone(this.report) : null;
  }
}

function emptySummary(): PlaytestSummary {
  return {
    draftsOpened: 0,
    stalledTurns: [0, 0],
    picks: {},
    uses: {},
    effectsExpired: {},
    winner: undefined,
    points: undefined,
    reason: undefined,
  };
}

function snapshotState(state: GameState): PlaytestStateSnapshot {
  return {
    phase: state.phase,
    active: state.active,
    round: state.powerups?.completedRounds ?? 0,
    roll: [...state.roll],
    remaining: [...state.remaining],
    loadouts: state.powerups ? structuredClone(state.powerups.loadouts) : null,
    activeEffects: structuredClone(state.powerups?.activeEffects ?? []),
    outcome: structuredClone(state.outcome),
  };
}

function updateSummary(summary: PlaytestSummary, events: SessionEvent[], state: GameState): void {
  for (const event of events) {
    if (event.type === 'DraftOpened') summary.draftsOpened++;
    if (event.type === 'AbilityPicked') increment(summary.picks, event.abilityId);
    if (event.type === 'AbilityUsed') increment(summary.uses, event.abilityId);
    if (event.type === 'EffectExpired') increment(summary.effectsExpired, event.abilityId);
    if (event.type === 'NoLegalMoves' && state.active !== null)
      summary.stalledTurns[state.active]++;
    if (event.type === 'GameEnded') {
      summary.winner = event.outcome.winner;
      summary.points = event.outcome.points;
      summary.reason = event.outcome.reason;
    }
  }
}

function increment(target: Partial<Record<AbilityId, number>>, abilityId: AbilityId): void {
  target[abilityId] = (target[abilityId] ?? 0) + 1;
}
