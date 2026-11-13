import { legalMoves } from '../game/rules/moves';
import type { Move, Player, Position } from '../game/rules/position';
import { initialPresentedSession, sessionMessage } from '../game/session/messages';
import type { GameState, Session } from '../game/session/state';
import {
  transitionSession,
  type SessionCommand,
  type SessionResult,
} from '../game/session/transition';
import type { Command } from '../net/messages';
import { PickupSelection } from './pickup-selection';

type RemoteState = { epoch: number; state: GameState; canUndo: boolean };

export type LocalMoveRequest = {
  type: 'local';
  start: Position;
  stages: Position[];
  checker: number;
  player: Player;
};
export type MoveRequest = LocalMoveRequest | { type: 'sent' };

/** Routes user commands to local rules or the online authority, independent of rendering. */
export class GameController {
  readonly pickup = new PickupSelection();
  private session: Session = initialPresentedSession();
  private moveKey = '';
  private cachedMoves: Move[] = [];
  private online: { you: Player; send: (command: Command) => void } | null = null;
  private remoteCanUndo = false;
  private rollBusy = false;
  private moveBusy = false;
  private remoteAnimation = false;
  private epoch = 0;
  private pendingRoll: RemoteState | null = null;
  private remoteResult: RemoteState | null = null;

  get state(): GameState {
    return this.session.state;
  }

  get seat(): Player | null {
    return this.online?.you ?? null;
  }

  get scripted(): boolean {
    return this.online !== null;
  }

  get canUndo(): boolean {
    return this.online ? this.remoteCanUndo : this.session.history.length > 0;
  }

  get busy(): boolean {
    return this.rollBusy || this.moveBusy || this.remoteAnimation;
  }

  get throwingPlayer(): Player {
    return this.state.active ?? 0;
  }

  mine(): boolean {
    return !this.online || this.online.you === this.state.active;
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

  private dispatchLocal(command: SessionCommand): SessionResult {
    const result = transitionSession(this.session, command);
    if (!result.ok) return result;
    this.session = result.session;
    const message = sessionMessage(this.state, result.events);
    if (message !== null) this.state.message = message;
    return result;
  }

  pickAt(point: number): number | null {
    if (this.busy || !this.mine()) return null;
    return this.pickup.pickAt(point, this.state);
  }

  releaseLastPickup(): number | undefined {
    return this.pickup.releaseLast();
  }

  clearPickup(): void {
    this.pickup.clear();
  }

  join(you: Player, send: (command: Command) => void): void {
    this.online = { you, send };
    this.remoteCanUndo = false;
  }

  leaveOnline(): void {
    this.online = null;
    this.adopt(initialPresentedSession().state, false);
  }

  beginRoll(locked = false): boolean {
    if (locked || this.busy || !this.mine()) return false;
    if (this.online) {
      if (!['OPENING_ROLL', 'WAITING_FOR_ROLL'].includes(this.state.phase)) return false;
      this.rollBusy = true;
      this.online.send({ type: 'roll' });
      return true;
    }
    const accepted = this.dispatchLocal({ type: 'beginRoll' }).ok;
    if (accepted) this.rollBusy = true;
    return accepted;
  }

  receiveRoll(values: number[]): void {
    if (this.rollBusy && !this.online) this.dispatchLocal({ type: 'receiveRoll', values });
    this.rollBusy = false;
    this.pickup.clear();
  }

  requestMove(sequence: Move[], locked = false): MoveRequest | null {
    if (locked || this.busy || !this.mine() || this.state.phase !== 'WAITING_FOR_MOVE') return null;
    if (this.online) {
      this.moveBusy = true;
      this.online.send({ type: 'move', sequence });
      return { type: 'sent' };
    }
    const from = sequence[0]?.from;
    const checker = from === undefined ? undefined : this.state.board[from]?.at(-1);
    if (checker === undefined || this.state.active === null) return null;
    const start: Position = { board: this.state.board, off: this.state.off };
    const player = this.state.active;
    const result = this.dispatchLocal({ type: 'move', sequence });
    if (!result.ok) return null;
    this.moveBusy = true;
    this.pickup.consume(checker);
    return { type: 'local', start, stages: result.stages!, checker, player };
  }

  finishLocalMove(): void {
    this.moveBusy = false;
    this.pickup.revalidate(this.state);
  }

  get hasLocalMove(): boolean {
    return !this.online && this.moveBusy;
  }

  undo(locked = false): boolean {
    if (locked || this.busy || !this.mine()) return false;
    if (this.online) {
      this.online.send({ type: 'undo' });
      return true;
    }
    const undone = this.dispatchLocal({ type: 'undo' }).ok;
    if (undone) this.pickup.clear();
    return undone;
  }

  endTurn(locked = false): boolean {
    if (locked || this.busy || !this.mine() || this.state.phase !== 'TURN_COMPLETE') return false;
    if (this.online) {
      this.online.send({ type: 'end' });
      return true;
    }
    const ended = this.dispatchLocal({ type: 'endTurn' }).ok;
    if (ended) this.pickup.clear();
    return ended;
  }

  canRestart(locked = false): boolean {
    return !locked && !this.busy;
  }

  restart(locked = false): 'local' | 'sent' | null {
    if (!this.canRestart(locked)) return null;
    if (this.online) {
      this.online.send({ type: 'restart' });
      return 'sent';
    }
    this.dispatchLocal({ type: 'restart' });
    this.pickup.clear();
    return 'local';
  }

  queueRoll(state: GameState, canUndo: boolean): void {
    this.pendingRoll = { epoch: this.epoch, state, canUndo };
  }

  presentedRoll(): { state: GameState; canUndo: boolean } | null {
    const result = this.pendingRoll;
    this.pendingRoll = null;
    return result && result.epoch === this.epoch ? result : null;
  }

  beginRemoteMove(sequence: Move[], state: GameState, canUndo: boolean): number | null {
    this.moveBusy = false;
    const checker = this.state.board[sequence[0]?.from]?.at(-1);
    if (checker === undefined) return null;
    this.pickup.consume(checker);
    this.remoteResult = { epoch: this.epoch, state, canUndo };
    this.remoteAnimation = true;
    return checker;
  }

  finishRemoteMove(): { state: GameState; canUndo: boolean } | null {
    const result = this.remoteResult;
    this.remoteResult = null;
    this.remoteAnimation = false;
    return result && result.epoch === this.epoch ? result : null;
  }

  get hasRemoteMove(): boolean {
    return this.remoteResult?.epoch === this.epoch;
  }

  adopt(state: GameState, canUndo: boolean, preservePickup = false): void {
    this.epoch++;
    this.pendingRoll = null;
    this.remoteResult = null;
    this.remoteAnimation = false;
    this.rollBusy = false;
    this.moveBusy = false;
    this.remoteCanUndo = canUndo;
    this.session = { state: structuredClone(state), history: [] };
    this.moveKey = '';
    if (preservePickup) this.pickup.revalidate(this.state);
    else this.pickup.clear();
  }
}
