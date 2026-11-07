import { Game, type GameState, type Player } from '../game/engine';
import { isCommand, type Command, type Update } from './messages';

export type PlayerId = string;

export type JoinResult =
  | { type: 'waiting' }
  | { type: 'matched'; ids: [PlayerId, PlayerId]; state: GameState };

export type ActResult = { to: PlayerId[]; update: Update };

type Seat = { match: Match; player: Player };

/** Pairs the oldest waiting player with the next one, then runs one authoritative game. */
export function createLobby(rollDie: () => number) {
  let waiting: PlayerId | null = null;
  const seats = new Map<PlayerId, Seat>();

  function join(id: PlayerId): JoinResult | null {
    if (seats.has(id)) return null;
    if (waiting === id) return { type: 'waiting' };
    if (waiting) {
      const first = waiting;
      waiting = null;
      const match = new Match(first, id, rollDie);
      seats.set(first, { match, player: 0 });
      seats.set(id, { match, player: 1 });
      return { type: 'matched', ids: [first, id], state: match.view().state };
    }
    waiting = id;
    return { type: 'waiting' };
  }

  /** Leaves the queue, or the match if pairing already happened. */
  function cancel(id: PlayerId) {
    if (waiting === id) {
      waiting = null;
      return null;
    }
    return leave(id);
  }

  function leave(id: PlayerId): PlayerId | null {
    if (waiting === id) waiting = null;
    const seat = seats.get(id);
    if (!seat) return null;
    const opponent = seat.match.ids[seat.player === 0 ? 1 : 0];
    seats.delete(id);
    seats.delete(opponent);
    return opponent;
  }

  function act(id: PlayerId, command: unknown): ActResult | null {
    const seat = seats.get(id);
    if (!seat || !isCommand(command)) return null;
    return seat.match.act(seat.player, command, id);
  }

  return { join, cancel, leave, act };
}

class Match {
  readonly ids: [PlayerId, PlayerId];
  private game = new Game();

  constructor(
    first: PlayerId,
    second: PlayerId,
    private rollDie: () => number,
  ) {
    this.ids = [first, second];
  }

  view(): Update {
    return { state: structuredClone(this.game.state), canUndo: this.game.history.length > 0 };
  }

  act(player: Player, command: Command, sender: PlayerId): ActResult {
    const everyone = () => ({ to: [...this.ids], update: this.view() });
    const rejected = () => ({ to: [sender], update: this.view() });
    if (command.type === 'restart') {
      this.game.reset();
      return { to: [...this.ids], update: { ...this.view(), resetDice: true } };
    }
    if (player !== this.game.state.active) return rejected();
    if (command.type === 'roll') {
      if (!this.game.beginRoll()) return rejected();
      const dice: [number, number] = [this.rollDie(), this.rollDie()];
      this.game.receiveRoll(dice);
      return { to: [...this.ids], update: { ...this.view(), dice } };
    }
    if (command.type === 'move') {
      if (!this.game.moveSequence(command.sequence)) return rejected();
      this.game.finishAnimation();
      return { to: [...this.ids], update: { ...this.view(), sequence: command.sequence } };
    }
    if (command.type === 'undo') {
      if (!this.game.undo()) return rejected();
      return everyone();
    }
    if (!this.game.endTurn()) return rejected();
    return everyone();
  }
}
