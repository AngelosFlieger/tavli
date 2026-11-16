import { initialGameState, type GameState, type Session } from './state';
import { CLASSIC_RULES, type RulesContext } from '../variant/types';
import type { SessionEvent } from './transition';

export type StatusKey = string;
export type StatusParams = Record<string, string | number>;

export function initialPresentedSession(rules: RulesContext = CLASSIC_RULES): Session {
  const state = initialGameState(rules);
  const parts = sessionMessageParts(state, [{ type: 'GameReset' }]);
  if (parts) {
    state.message = parts.text;
    state.messageKey = parts.key;
    state.messageParams = parts.params;
  }
  return { state, history: [] };
}

// Status copy belongs to presentation. Undo restores the saved text with its state.
export function sessionMessage(state: GameState, events: SessionEvent[]): string | null {
  return sessionMessageParts(state, events)?.text ?? null;
}

/** Structured status copy so UI layers can render the same message in another locale. */
export function sessionMessageParts(
  state: GameState,
  events: SessionEvent[],
): { key: StatusKey; params: StatusParams; text: string } | null {
  const event = events.at(-1);
  if (!event) return null;
  switch (event.type) {
    case 'GameReset':
      return { key: 'status.gameReset', params: {}, text: 'Player 1 rolls both dice to start.' };
    case 'RollStarted':
      return {
        key: 'status.openingRoll',
        params: { player: state.active! + 1 },
        text: state.opening ? `Player ${state.active! + 1} · opening roll` : 'Rolling…',
      };
    case 'OpeningRollPassed':
      return { key: 'status.openingPassed', params: {}, text: 'Player 2 rolls both dice.' };
    case 'OpeningRollTied':
      return {
        key: 'status.openingTied',
        params: {},
        text: 'Tie · Player 1 rolls both dice again.',
      };
    case 'OpeningWinnerChosen':
      return {
        key: 'status.openingWinner',
        params: { player: event.player + 1 },
        text: `Player ${event.player + 1} starts · roll both dice for your first turn.`,
      };
    case 'NoLegalMoves':
      return { key: 'status.noLegalMoves', params: {}, text: 'No legal moves · End your turn.' };
    case 'MovesComplete':
      return {
        key: 'status.movesComplete',
        params: {},
        text: 'Moves complete · End Turn, or Undo to reconsider.',
      };
    case 'MovesAvailable':
      return {
        key: 'status.movesAvailable',
        params: {},
        text: 'Pick up highlighted checkers, then place them one by one.',
      };
    case 'GameEnded':
      return event.outcome.winner === null
        ? {
            key: `outcome.${event.outcome.kind}`,
            params: {},
            text: event.outcome.reason,
          }
        : {
            key: 'status.winner',
            params: { player: event.outcome.winner + 1 },
            text: `Player ${event.outcome.winner + 1} wins · ${event.outcome.reason}`,
          };
    case 'TurnEnded':
      return {
        key: 'status.turnEnded',
        params: { player: event.next + 1 },
        text: `Player ${event.next + 1} · roll both dice.`,
      };
    case 'DraftDue':
      return {
        key: 'status.draftDue',
        params: { round: event.round },
        text: `Round ${event.round} complete · ability draft.`,
      };
    case 'DraftOpened':
      return {
        key: 'status.draftOpened',
        params: {},
        text: 'Rolling to decide who drafts first…',
      };
    case 'DraftOrderTied':
      return { key: 'status.draftTied', params: {}, text: 'Draft roll tied · rolling again.' };
    case 'DraftOrderChosen':
      return {
        key: 'status.draftChosen',
        params: { player: event.first + 1 },
        text: `Player ${event.first + 1} drafts first.`,
      };
    case 'AbilityPicked':
      return {
        key: 'status.abilityPicked',
        params: { player: event.player + 1 },
        text: `Player ${event.player + 1} picked an ability.`,
      };
    case 'AbilityUsed':
      return {
        key: 'status.abilityUsed',
        params: { player: event.player + 1 },
        text: `Player ${event.player + 1} used an ability.`,
      };
    case 'DraftCompleted':
      return {
        key: 'status.draftCompleted',
        params: { player: state.active! + 1 },
        text: `Player ${state.active! + 1} · roll both dice.`,
      };
    default:
      return null;
  }
}
