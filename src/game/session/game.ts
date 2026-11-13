import { legalMoves } from '../rules/moves';
import type { Move, Position } from '../rules/position';
import { initialPresentedSession, sessionMessage } from './messages';
import type { GameState } from './state';
import { transitionSession, type SessionCommand, type SessionResult } from './transition';

export type { GameState } from './state';

// Compatibility facade retained for regression tests using the old Game API.
export class Game {
  state: GameState = initialPresentedSession().state;
  history: GameState[] = [];
  private moveKey = '';
  private cachedMoves: Move[] = [];
  private pendingRoll = false;

  private dispatch(command: SessionCommand): SessionResult {
    const result = transitionSession({ state: this.state, history: this.history }, command);
    if (!result.ok) return result;
    this.state = result.session.state;
    this.history = result.session.history;
    const message = sessionMessage(this.state, result.events);
    if (message !== null) this.state.message = message;
    return result;
  }

  moves(): Move[] {
    if (this.state.active === null || this.state.phase !== 'WAITING_FOR_MOVE') return [];
    const key = JSON.stringify([this.state.board, this.state.remaining, this.state.active]);
    if (key !== this.moveKey) {
      this.moveKey = key;
      this.cachedMoves = legalMoves(this.state, this.state.active, this.state.remaining);
    }
    return this.cachedMoves;
  }

  beginRoll(): boolean {
    if (this.pendingRoll) return false;
    const accepted = this.dispatch({ type: 'beginRoll' }).ok;
    if (accepted) this.pendingRoll = true;
    return accepted;
  }

  receiveRoll(values: number[]): void {
    if (!this.pendingRoll) return;
    if (this.dispatch({ type: 'receiveRoll', values }).ok) this.pendingRoll = false;
  }

  move(move: Move): boolean {
    return this.dispatch({ type: 'move', sequence: [move] }).ok;
  }

  moveSequence(sequence: Move[]): Position[] | null {
    const result = this.dispatch({ type: 'move', sequence });
    return result.ok ? result.stages! : null;
  }

  undo(): boolean {
    return this.dispatch({ type: 'undo' }).ok;
  }

  endTurn(): boolean {
    return this.dispatch({ type: 'endTurn' }).ok;
  }

  reset(): void {
    this.dispatch({ type: 'restart' });
    this.pendingRoll = false;
  }
}
