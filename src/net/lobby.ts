import type { Player } from '../game/rules/position';
import { initialPresentedSession, sessionMessage } from '../game/session/messages';
import type { GameState, Session } from '../game/session/state';
import { transitionSession, type SessionCommand } from '../game/session/transition';
import { isCommand, type Command, type Update } from './messages';

export type PlayerId = string;

export type ActResult = { to: PlayerId[]; update: Update };

export type SeatView = { you: Player; state: GameState; canUndo: boolean };

export type MatchSnapshot = { id: string; ids: [PlayerId, PlayerId]; session: Session };

type Seat = { match: Match; player: Player };

/** Runs the authoritative game for players this process has seated. Pairing lives in MongoDB. */
export function createLobby(rollDie: () => number) {
  const seats = new Map<PlayerId, Seat>();

  function leave(id: PlayerId): PlayerId | null {
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

  function seat(id: PlayerId): SeatView | null {
    const found = seats.get(id);
    if (!found) return null;
    const update = found.match.view();
    return { you: found.player, state: update.state, canUndo: update.canUndo };
  }

  function snapshot(id: PlayerId): MatchSnapshot | null {
    const found = seats.get(id);
    if (!found) return null;
    return { id: found.match.id, ids: [...found.match.ids], session: found.match.exportSession() };
  }

  function restore(first: PlayerId, second: PlayerId, session: Session, id: string) {
    if (seats.has(first) || seats.has(second)) return false;
    const match = new Match(first, second, rollDie, session, id);
    seats.set(first, { match, player: 0 });
    seats.set(second, { match, player: 1 });
    return true;
  }

  return { leave, act, seat, snapshot, restore };
}

class Match {
  readonly ids: [PlayerId, PlayerId];
  private session: Session;

  constructor(
    first: PlayerId,
    second: PlayerId,
    private rollDie: () => number,
    session: Session = initialPresentedSession(),
    readonly id: string = crypto.randomUUID(),
  ) {
    this.ids = [first, second];
    this.session = structuredClone(session);
  }

  exportSession(): Session {
    return structuredClone(this.session);
  }

  view(): Update {
    return {
      state: structuredClone(this.session.state),
      canUndo: this.session.history.length > 0,
    };
  }

  private resolve(command: SessionCommand, input = this.session): Session | null {
    const result = transitionSession(input, command);
    if (!result.ok) return null;
    const message = sessionMessage(result.session.state, result.events);
    if (message !== null) result.session.state.message = message;
    return result.session;
  }

  private apply(command: SessionCommand): boolean {
    const next = this.resolve(command);
    if (!next) return false;
    this.session = next;
    return true;
  }

  act(player: Player, command: Command, sender: PlayerId): ActResult {
    const everyone = () => ({ to: [...this.ids], update: this.view() });
    const rejected = () => ({ to: [sender], update: this.view() });
    if (command.type === 'restart') {
      this.apply({ type: 'restart' });
      return { to: [...this.ids], update: { ...this.view(), resetDice: true } };
    }
    if (player !== this.session.state.active) return rejected();
    if (command.type === 'roll') {
      const started = this.resolve({ type: 'beginRoll' });
      if (!started) return rejected();
      const dice: [number, number] = [this.rollDie(), this.rollDie()];
      const rolled = this.resolve({ type: 'receiveRoll', values: dice }, started);
      if (!rolled) return rejected();
      this.session = rolled;
      return { to: [...this.ids], update: { ...this.view(), dice } };
    }
    if (command.type === 'move') {
      if (!this.apply({ type: 'move', sequence: command.sequence })) return rejected();
      return { to: [...this.ids], update: { ...this.view(), sequence: command.sequence } };
    }
    if (command.type === 'undo') {
      if (!this.apply({ type: 'undo' })) return rejected();
      return everyone();
    }
    if (!this.apply({ type: 'endTurn' })) return rejected();
    return everyone();
  }
}
