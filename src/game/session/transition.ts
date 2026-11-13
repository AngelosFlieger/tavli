import { legalMoves, spendDie } from '../rules/moves';
import { outcome } from '../rules/outcome';
import {
  applyMove,
  other,
  owner,
  type Move,
  type Outcome,
  type Player,
  type Position,
} from '../rules/position';
import { canUndoInPhase, nextPhase } from './phase';
import { initialGameState, type GameState, type Session } from './state';

export type SessionCommand =
  | { type: 'beginRoll' }
  | { type: 'receiveRoll'; values: number[] }
  | { type: 'move'; sequence: Move[] }
  | { type: 'undo' }
  | { type: 'endTurn' }
  | { type: 'restart' };

export type SessionEvent =
  | { type: 'GameReset' }
  | { type: 'RollStarted'; player: Player }
  | { type: 'OpeningRollPassed' }
  | { type: 'OpeningRollTied' }
  | { type: 'OpeningWinnerChosen'; player: Player }
  | { type: 'DiceRolled'; player: Player; values: number[] }
  | { type: 'NoLegalMoves' }
  | { type: 'MovesAvailable' }
  | { type: 'CheckerMoved'; checker: number; from: number; to: number; die: number }
  | { type: 'CheckerPinned'; checker: number; victim: number; point: number }
  | { type: 'CheckerBorneOff'; checker: number; player: Player }
  | { type: 'MovesComplete' }
  | { type: 'GameEnded'; outcome: Outcome }
  | { type: 'MoveUndone' }
  | { type: 'TurnEnded'; player: Player; next: Player };

export type SessionResult =
  | { ok: true; session: Session; events: SessionEvent[]; stages?: Position[] }
  | { ok: false; reason: 'phase' | 'invalid_roll' | 'illegal_move' | 'no_history' };

const rejected = (reason: Extract<SessionResult, { ok: false }>['reason']): SessionResult => ({
  ok: false,
  reason,
});

// The only authoritative session mutation path. Inputs and saved history are never changed.
export function transitionSession(input: Session, command: SessionCommand): SessionResult {
  if (command.type === 'restart')
    return {
      ok: true,
      session: { state: initialGameState(), history: [] },
      events: [{ type: 'GameReset' }],
    };

  const state: GameState = structuredClone(input.state);
  const history = [...input.history];
  const active = state.active;

  if (command.type === 'beginRoll') {
    const phase = nextPhase(state.phase, 'beginRoll');
    if (!phase || active === null) return rejected('phase');
    state.phase = phase;
    return {
      ok: true,
      session: { state, history },
      events: [{ type: 'RollStarted', player: active }],
    };
  }

  if (command.type === 'receiveRoll') {
    if (!['OPENING_ROLL', 'WAITING_FOR_ROLL'].includes(state.phase) || active === null)
      return rejected('phase');
    const values = command.values;
    if (values.length !== 2 || values.some((v) => !Number.isInteger(v) || v < 1 || v > 6))
      return rejected('invalid_roll');
    state.roll = [...values];
    if (state.opening) {
      state.openingRolls[active] = [...values];
      if (active === 0) {
        state.active = 1;
        state.phase = nextPhase(state.phase, 'needOpeningRoll')!;
        return {
          ok: true,
          session: { state, history: [] },
          events: [{ type: 'OpeningRollPassed' }],
        };
      }
      const totals = state.openingRolls.map((pair) => pair!.reduce((sum, value) => sum + value, 0));
      if (totals[0] === totals[1]) {
        state.active = 0;
        state.openingRolls = [null, null];
        state.phase = nextPhase(state.phase, 'needOpeningRoll')!;
        return { ok: true, session: { state, history: [] }, events: [{ type: 'OpeningRollTied' }] };
      }
      state.active = totals[0] > totals[1] ? 0 : 1;
      state.opening = false;
      state.phase = nextPhase(state.phase, 'openingComplete')!;
      return {
        ok: true,
        session: { state, history: [] },
        events: [{ type: 'OpeningWinnerChosen', player: state.active }],
      };
    }
    state.openingRolls = [null, null];
    state.remaining = values[0] === values[1] ? Array(4).fill(values[0]) : [...values];
    state.phase = nextPhase(state.phase, 'rollReady')!;
    const events: SessionEvent[] = [{ type: 'DiceRolled', player: active, values: [...values] }];
    if (legalMoves(state, active, state.remaining).length) events.push({ type: 'MovesAvailable' });
    else {
      state.phase = nextPhase(state.phase, 'movesExhausted')!;
      events.push({ type: 'NoLegalMoves' });
    }
    return { ok: true, session: { state, history: [] }, events };
  }

  if (command.type === 'move') {
    if (state.phase !== 'WAITING_FOR_MOVE' || active === null) return rejected('phase');
    const sequence = command.sequence;
    if (!sequence.length) return rejected('illegal_move');
    const first = sequence[0];
    if (!Number.isInteger(first.from) || first.from < 0 || first.from >= state.board.length)
      return rejected('illegal_move');
    const checker = state.board[first.from].at(-1);
    if (checker === undefined || owner(checker) !== active) return rejected('illegal_move');
    const stages: Position[] = [];
    const events: SessionEvent[] = [];
    let position: Position = { board: state.board, off: state.off };
    let left = [...state.remaining];
    for (const move of sequence) {
      if (
        !Number.isInteger(move.from) ||
        move.from < 0 ||
        move.from >= position.board.length ||
        !Number.isInteger(move.to) ||
        move.to < -1 ||
        move.to >= position.board.length ||
        position.board[move.from].at(-1) !== checker ||
        !legalMoves(position, active, left).some(
          (allowed) =>
            allowed.from === move.from && allowed.to === move.to && allowed.die === move.die,
        )
      )
        return rejected('illegal_move');
      const victim = move.to === -1 ? undefined : position.board[move.to].at(-1);
      const pins =
        move.to !== -1 &&
        position.board[move.to].length === 1 &&
        victim !== undefined &&
        owner(victim) !== active;
      position = applyMove(position, active, move);
      left = spendDie(left, move.die);
      stages.push(position);
      events.push({ type: 'CheckerMoved', checker, ...move });
      if (pins) events.push({ type: 'CheckerPinned', checker, victim: victim!, point: move.to });
      if (move.to === -1) events.push({ type: 'CheckerBorneOff', checker, player: active });
      if (outcome(position) && stages.length !== sequence.length) return rejected('illegal_move');
    }
    history.push(structuredClone(input.state));
    state.board = position.board;
    state.off = position.off;
    state.remaining = left;
    const result = outcome(state);
    if (result) {
      state.outcome = result;
      state.phase = nextPhase(state.phase, 'gameFinished')!;
      events.push({ type: 'GameEnded', outcome: result });
    } else if (legalMoves(state, active, state.remaining).length) {
      events.push({ type: 'MovesAvailable' });
    } else {
      state.phase = nextPhase(state.phase, 'movesExhausted')!;
      events.push({ type: 'MovesComplete' });
    }
    return { ok: true, session: { state, history }, events, stages };
  }

  if (command.type === 'undo') {
    if (!canUndoInPhase(state.phase)) return rejected('phase');
    if (!history.length) return rejected('no_history');
    return {
      ok: true,
      session: { state: structuredClone(history.at(-1)!), history: history.slice(0, -1) },
      events: [{ type: 'MoveUndone' }],
    };
  }

  if (command.type === 'endTurn') {
    const phase = nextPhase(state.phase, 'endTurn');
    if (!phase || active === null) return rejected('phase');
    const next = other(active);
    state.phase = phase;
    state.active = next;
    state.remaining = [];
    return {
      ok: true,
      session: { state, history: [] },
      events: [{ type: 'TurnEnded', player: active, next }],
    };
  }
  return rejected('phase');
}
