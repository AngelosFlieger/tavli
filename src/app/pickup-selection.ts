import { canPlaceQueue, queuedSequences } from '../game/pickup';
import { owner, type GameState, type Move } from '../game/engine';

export type PickupView = {
  queue: number[];
  pickable: (number | null)[];
  sequences: Move[][];
};

/** Temporary checker selection, kept outside the authoritative game state. */
export class PickupSelection {
  private queue: number[] = [];
  private sequenceCacheKey = '';
  private cachedSequences: Move[][] = [];

  get items(): readonly number[] {
    return [...this.queue];
  }

  clear(): void {
    this.queue = [];
  }

  releaseLast(): number | undefined {
    return this.queue.pop();
  }

  consume(checker: number): void {
    if (this.queue[0] === checker) this.queue.shift();
    else this.clear();
  }

  revalidate(state: GameState): void {
    if (state.phase === 'WAITING_FOR_MOVE' && state.active !== null) {
      while (this.queue.length && !canPlaceQueue(state, state.active, state.remaining, this.queue))
        this.queue.pop();
    } else this.clear();
  }

  private nextChecker(point: number, state: GameState): number | null {
    if (
      state.phase !== 'WAITING_FOR_MOVE' ||
      state.active === null ||
      this.queue.length >= state.remaining.length
    )
      return null;
    const stack = state.board[point];
    if (!stack) return null;
    const checker = [...stack]
      .reverse()
      .find((id) => owner(id) === state.active && !this.queue.includes(id));
    if (checker === undefined) return null;
    return canPlaceQueue(state, state.active, state.remaining, [...this.queue, checker])
      ? checker
      : null;
  }

  pickAt(point: number, state: GameState): number | null {
    const checker = this.nextChecker(point, state);
    if (checker !== null) this.queue.push(checker);
    return checker;
  }

  sequences(state: GameState, locked = false): Move[][] {
    if (!this.queue.length || locked || state.phase !== 'WAITING_FOR_MOVE' || state.active === null)
      return [];
    const key = JSON.stringify([state.board, state.remaining, state.active, this.queue]);
    if (key !== this.sequenceCacheKey) {
      this.sequenceCacheKey = key;
      this.cachedSequences = queuedSequences(state, state.active, state.remaining, this.queue);
    }
    return this.cachedSequences;
  }

  refresh(state: GameState, interactive: boolean, locked: boolean): PickupView {
    const queue = state.phase === 'WAITING_FOR_MOVE' ? [...this.queue] : [];
    const pickable = Array.from({ length: 24 }, (_, point) =>
      interactive ? this.nextChecker(point, state) : null,
    );
    return { queue, pickable, sequences: this.sequences(state, locked) };
  }
}
