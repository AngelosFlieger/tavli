import { owner } from '../rules/position';
import type { GameState, Session } from './state';

export type StateInvariantViolation = {
  path: string;
  reason: string;
};

/**
 * Checks semantic invariants after a value has already been decoded as GameState.
 *
 * This intentionally has no browser, transport, or persistence dependencies so the same contract
 * can be enforced by transitions, stores, tests, and future protocol decoders.
 */
export function gameStateInvariantViolations(state: GameState): StateInvariantViolation[] {
  const violations: StateInvariantViolation[] = [];
  const add = (path: string, reason: string) => violations.push({ path, reason });
  const opening = state.opening as GameState['opening'] | null | undefined;

  if (state.board.length !== 24) add('board', 'must contain exactly 24 points');
  if (state.off.length !== 2) add('off', 'must contain exactly two trays');

  const locations = [...state.board, ...state.off];
  const checkers = locations.flat();
  if (checkers.length !== 30) add('board/off', 'must contain exactly 30 checkers');
  const unique = new Set(checkers);
  if (unique.size !== checkers.length) add('board/off', 'each checker must appear exactly once');
  for (const checker of checkers) {
    if (!Number.isInteger(checker) || checker < 0 || checker > 29) {
      add('board/off', `contains invalid checker ${String(checker)}`);
      continue;
    }
  }
  for (const player of [0, 1] as const) {
    if (state.off[player].some((checker) => owner(checker) !== player))
      add(`off.${player}`, 'may contain only checkers owned by that player');
  }

  if (state.roll.length !== 0 && state.roll.length !== 2)
    add('roll', 'must be empty or contain exactly two dice');
  if (!opening || (opening.status !== 'PENDING' && opening.status !== 'RESOLVED'))
    add('opening', 'must be pending or resolved');
  else if (opening.status === 'RESOLVED') {
    if (!Array.isArray(opening.attempts) || opening.attempts.length === 0)
      add('opening.attempts', 'must contain at least one attempt');
    else
      for (const [index, attempt] of opening.attempts.entries()) {
        if (
          !Array.isArray(attempt) ||
          attempt.length !== 2 ||
          attempt.some((value) => !Number.isInteger(value) || value < 1 || value > 6)
        )
          add(`opening.attempts.${index}`, 'must contain one valid die for each player');
        else if (index < opening.attempts.length - 1 && attempt[0] !== attempt[1])
          add(`opening.attempts.${index}`, 'must be a tie before the final attempt');
      }
    const final = opening.attempts.at(-1);
    if (final?.[0] === final?.[1]) add('opening.attempts', 'final attempt must choose a winner');
    if (final && opening.winner !== (final[0] > final[1] ? 0 : 1))
      add('opening.winner', 'must match the final attempt');
  }

  if (state.phase === 'OPENING') {
    if (opening?.status !== 'PENDING') add('opening', 'must be pending during OPENING');
  } else if (opening?.status === 'PENDING' && state.phase !== 'GAME_OVER') {
    add('opening', 'may remain pending outside OPENING only when the game has ended');
  }

  if (state.phase === 'WAITING_FOR_MOVE') {
    if (opening?.status !== 'RESOLVED') add('opening', 'must be resolved while moves exist');
    if (state.active === null) add('active', 'must identify the moving player');
    if (state.remaining.length === 0) add('remaining', 'must contain at least one movement token');
  }

  if (
    (state.phase === 'WAITING_FOR_ROLL' || state.phase === 'TURN_COMPLETE') &&
    state.active === null
  )
    add('active', `must identify the player during ${state.phase}`);

  if (state.phase === 'GAME_OVER') {
    if (state.outcome === null) add('outcome', 'must be present during GAME_OVER');
    if (state.clock !== null) add('clock', 'must be absent during GAME_OVER');
  } else if (state.outcome !== null) {
    add('outcome', 'must be absent before GAME_OVER');
  }

  if ((state.phase === 'DRAFT_ORDER' || state.phase === 'DRAFT_PICK') && state.clock?.running)
    add('clock', 'must not run during a draft');
  if (state.clock?.running && state.clock.deadline === null)
    add('clock.deadline', 'must be present while the clock is running');
  if (state.clock && !state.clock.running && state.clock.deadline !== null)
    add('clock.deadline', 'must be absent while the clock is paused');

  if (state.ruleset === 'CLASSIC') {
    if (state.variantConfigHash !== null) add('variantConfigHash', 'must be null for CLASSIC');
    if (state.powerups !== null) add('powerups', 'must be null for CLASSIC');
  } else {
    if (!state.variantConfigHash) add('variantConfigHash', 'must identify POWERUPS_V1 rules');
    if (state.powerups === null) add('powerups', 'must be present for POWERUPS_V1');
  }

  return violations;
}

export function sessionInvariantViolations(session: Session): StateInvariantViolation[] {
  return [session.state, ...session.history].flatMap((state, index) =>
    gameStateInvariantViolations(state).map((violation) => ({
      path: index === 0 ? `state.${violation.path}` : `history.${index - 1}.${violation.path}`,
      reason: violation.reason,
    })),
  );
}

export function assertGameStateInvariants(state: GameState): void {
  const violations = gameStateInvariantViolations(state);
  if (!violations.length) return;
  throw new Error(
    `Invalid game state: ${violations.map(({ path, reason }) => `${path} ${reason}`).join('; ')}`,
  );
}
