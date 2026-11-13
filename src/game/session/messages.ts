import { initialGameState, type GameState, type Session } from './state';
import type { SessionEvent } from './transition';

export function initialPresentedSession(): Session {
  const state = initialGameState();
  state.message = sessionMessage(state, [{ type: 'GameReset' }])!;
  return { state, history: [] };
}

// Status copy belongs to presentation. Undo restores the saved text with its state.
export function sessionMessage(state: GameState, events: SessionEvent[]): string | null {
  const event = events.at(-1);
  if (!event) return null;
  switch (event.type) {
    case 'GameReset':
      return 'Player 1 rolls both dice to start.';
    case 'RollStarted':
      return state.opening ? `Player ${state.active! + 1} · opening roll` : 'Rolling…';
    case 'OpeningRollPassed':
      return 'Player 2 rolls both dice.';
    case 'OpeningRollTied':
      return 'Tie · Player 1 rolls both dice again.';
    case 'OpeningWinnerChosen':
      return `Player ${event.player + 1} starts · roll both dice for your first turn.`;
    case 'NoLegalMoves':
      return 'No legal moves · End your turn.';
    case 'MovesComplete':
      return 'Moves complete · End Turn, or Undo to reconsider.';
    case 'MovesAvailable':
      return 'Pick up highlighted checkers, then place them one by one.';
    case 'GameEnded':
      return event.outcome.winner === null
        ? event.outcome.reason
        : `Player ${event.outcome.winner + 1} wins · ${event.outcome.reason}`;
    case 'TurnEnded':
      return `Player ${event.next + 1} · roll both dice.`;
    default:
      return null;
  }
}
