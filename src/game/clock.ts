import type { Phase } from './session/phase';

export type ClockConfig = {
  enabled: boolean;
  openingMs: number;
  turnMs: number;
  bankMs: number;
};

export type GameClock = {
  remainingMs: number;
  deadline: number | null;
  running: boolean;
};

export const DISABLED_CLOCK: ClockConfig = Object.freeze({
  enabled: false,
  openingMs: 0,
  turnMs: 0,
  bankMs: 0,
});

export const DEFAULT_CLOCK: ClockConfig = Object.freeze({
  enabled: true,
  openingMs: 30_000,
  turnMs: 120_000,
  bankMs: 15_000,
});

export function clockConfigFromEnv(env: Record<string, string | undefined>): ClockConfig {
  if (env.PLAKOTO_CLOCK === 'off') return DISABLED_CLOCK;
  const seconds = (name: string, fallback: number) => {
    const value = Number(env[name]);
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) : fallback;
  };
  return {
    enabled: true,
    openingMs: seconds('PLAKOTO_CLOCK_OPENING_SECONDS', DEFAULT_CLOCK.openingMs),
    turnMs: seconds('PLAKOTO_CLOCK_TURN_SECONDS', DEFAULT_CLOCK.turnMs),
    bankMs: seconds('PLAKOTO_CLOCK_BANK_SECONDS', DEFAULT_CLOCK.bankMs),
  };
}

export function startClock(config: ClockConfig, phase: Phase, now: number): GameClock | null {
  if (
    !config.enabled ||
    phase === 'OPENING' ||
    phase === 'GAME_OVER' ||
    phase === 'DRAFT_ORDER' ||
    phase === 'DRAFT_PICK'
  )
    return null;
  const remainingMs = config.turnMs + config.bankMs;
  return { remainingMs, deadline: now + remainingMs, running: true };
}

export function remainingMs(clock: GameClock | null, now: number): number {
  if (!clock) return 0;
  if (!clock.running || clock.deadline === null) return Math.max(0, clock.remainingMs);
  return Math.max(0, clock.deadline - now);
}

export function pauseClock(clock: GameClock | null, now: number): GameClock | null {
  if (!clock || !clock.running) return clock;
  return { remainingMs: remainingMs(clock, now), deadline: null, running: false };
}

export function resumeClock(clock: GameClock | null, now: number): GameClock | null {
  if (!clock || clock.running) return clock;
  return { remainingMs: clock.remainingMs, deadline: now + clock.remainingMs, running: true };
}

export function clockExpired(clock: GameClock | null, now: number): boolean {
  return !!clock?.running && clock.deadline !== null && clock.deadline <= now;
}

export function advanceClock(
  clock: GameClock | null,
  previous: Phase,
  next: Phase,
  config: ClockConfig,
  now: number,
): GameClock | null {
  if (!config.enabled || next === 'GAME_OVER') return null;
  if (next === 'DRAFT_ORDER' || next === 'DRAFT_PICK') return pauseClock(clock, now);
  if (previous === 'DRAFT_ORDER' || previous === 'DRAFT_PICK' || previous === 'TURN_COMPLETE')
    return startClock(config, next, now);
  if (next === 'WAITING_FOR_ROLL' && previous !== 'WAITING_FOR_MOVE')
    return startClock(config, next, now);
  return clock;
}

export function formatClock(clock: GameClock | null, now: number): string {
  const totalSeconds = Math.ceil(remainingMs(clock, now) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
