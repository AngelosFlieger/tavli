import { PATHS } from './points';
export type Player = 0 | 1;
export type Phase =
  | 'OPENING_ROLL'
  | 'WAITING_FOR_ROLL'
  | 'ROLLING'
  | 'WAITING_FOR_MOVE'
  | 'ANIMATING_MOVE'
  | 'TURN_COMPLETE'
  | 'GAME_OVER';
export type Move = { from: number; to: number; die: number }; // -1 means bear off.
export type Outcome = { winner: Player | null; points: number; reason: string };
export type Position = { board: number[][]; off: [number[], number[]] };
export type GameState = Position & {
  phase: Phase;
  active: Player | null;
  remaining: number[];
  roll: number[];
  openingRolls: [number[] | null, number[] | null];
  outcome: Outcome | null;
  message: string;
  opening: boolean;
};
export const owner = (id: number): Player => (id < 15 ? 0 : 1);
export const other = (player: Player): Player => (player === 0 ? 1 : 0);
const copy = <T>(value: T): T => structuredClone(value);
export function initialPosition(): Position {
  const board: number[][] = Array.from({ length: 24 }, () => []);
  board[0] = Array.from({ length: 15 }, (_, i) => i);
  board[12] = Array.from({ length: 15 }, (_, i) => 15 + i);
  return { board, off: [[], []] };
}
export function pinned(position: Position, player: Player) {
  return position.board.some(
    (stack) => stack.length > 1 && owner(stack[0]) === player && owner(stack.at(-1)!) !== player,
  );
}
export function canBearOff(position: Position, player: Player) {
  return (
    !pinned(position, player) &&
    position.board.every(
      (stack, point) =>
        !stack.some((id) => owner(id) === player) || PATHS[player].indexOf(point) >= 18,
    )
  );
}
export function outcome(position: Position): Outcome | null {
  const motherPinned = ([0, 1] as Player[]).map((player) => {
    const stack = position.board[PATHS[player][0]];
    return (
      stack.filter((id) => owner(id) === player).length === 1 && owner(stack.at(-1)!) !== player
    );
  });
  if (motherPinned[0] && motherPinned[1])
    return { winner: null, points: 0, reason: 'Both mothers pinned — draw' };
  for (const player of [0, 1] as Player[]) {
    if (
      motherPinned[other(player)] &&
      !position.board[PATHS[player][0]].some((id) => owner(id) === player)
    )
      return { winner: player, points: 2, reason: 'Mother victory' };
    if (position.off[player].length === 15)
      return {
        winner: player,
        points: position.off[other(player)].length ? 1 : 2,
        reason: position.off[other(player)].length ? 'All checkers borne off' : 'Mars',
      };
  }
  return null;
}
export function rawMoves(position: Position, player: Player, die: number): Move[] {
  const path = PATHS[player],
    bearing = canBearOff(position, player);
  const highest = Math.max(
    0,
    ...position.board.map((stack, point) =>
      stack.some((id) => owner(id) === player) ? 24 - path.indexOf(point) : 0,
    ),
  );
  const moves: Move[] = [];
  for (let index = 0; index < 24; index++) {
    const from = path[index],
      stack = position.board[from];
    if (!stack.length || owner(stack.at(-1)!) !== player) continue;
    const target = index + die;
    if (target >= 24) {
      const distance = 24 - index;
      if (bearing && (die === distance || (die > distance && highest === distance)))
        moves.push({ from, to: -1, die });
    } else {
      const to = path[target],
        dest = position.board[to];
      if (!dest.length || owner(dest.at(-1)!) === player || dest.length === 1)
        moves.push({ from, to, die });
    }
  }
  return moves;
}
export function applyMove(position: Position, player: Player, move: Move): Position {
  const next = copy(position),
    id = next.board[move.from].pop()!;
  if (move.to === -1) next.off[player].push(id);
  else next.board[move.to].push(id);
  return next;
}
const without = (dice: number[], die: number) => {
  const result = [...dice];
  result.splice(result.indexOf(die), 1);
  return result;
};
// Exhaust all distinct dice orders and intermediate landings, memoizing equivalent point ownership.
export function legalMoves(position: Position, player: Player, dice: number[]): Move[] {
  const memo = new Map<string, number>();
  function count(pos: Position, left: number[]): number {
    if (!left.length || outcome(pos)) return 0;
    const key =
      pos.board.map((stack) => stack.map(owner).join('')).join('/') +
      '|' +
      left.slice().sort().join(',');
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let best = 0;
    for (const die of new Set(left))
      for (const move of rawMoves(pos, player, die))
        best = Math.max(best, 1 + count(applyMove(pos, player, move), without(left, die)));
    memo.set(key, best);
    return best;
  }
  const candidates = [...new Set(dice)].flatMap((die) =>
    rawMoves(position, player, die).map((move) => {
      const next = applyMove(position, player, move);
      return { move, winning: !!outcome(next), count: 1 + count(next, without(dice, die)) };
    }),
  );
  const max = Math.max(0, ...candidates.map((c) => c.count));
  let allowed = candidates.filter((c) => c.winning || c.count === max);
  if (max === 1 && new Set(dice).size === 2) {
    const higher = Math.max(...allowed.map((c) => c.move.die));
    allowed = allowed.filter((c) => c.winning || c.move.die === higher);
  }
  return allowed.map((c) => c.move);
}
// Single-checker sequences, including summed dice and two to four steps for doubles.
export function moveSequences(
  position: Position,
  player: Player,
  dice: number[],
  from: number,
): Move[][] {
  const sequences: Move[][] = [];
  function visit(pos: Position, left: number[], point: number, path: Move[]) {
    for (const move of legalMoves(pos, player, left).filter((move) => move.from === point)) {
      const nextPath = [...path, move];
      sequences.push(nextPath);
      const next = applyMove(pos, player, move);
      if (move.to !== -1 && !outcome(next)) visit(next, without(left, move.die), move.to, nextPath);
    }
  }
  visit(position, dice, from, []);
  // Equivalent dice orders produce the same final point and consume the same movements.
  const unique = new Map<string, Move[]>();
  for (const sequence of sequences) {
    const key =
      sequence.at(-1)!.to +
      '|' +
      sequence
        .map((move) => move.die)
        .sort()
        .join(',');
    if (!unique.has(key)) unique.set(key, sequence);
  }
  return [...unique.values()];
}
export class Game {
  state: GameState;
  history: GameState[] = [];
  constructor() {
    this.state = {
      ...initialPosition(),
      phase: 'OPENING_ROLL',
      active: 0,
      remaining: [],
      roll: [],
      openingRolls: [null, null],
      outcome: null,
      message: 'Player 1 rolls both dice to start.',
      opening: true,
    };
  }
  private moveKey = '';
  private cachedMoves: Move[] = [];
  moves() {
    if (this.state.active === null || this.state.phase !== 'WAITING_FOR_MOVE') return [];
    const key = JSON.stringify([this.state.board, this.state.remaining, this.state.active]);
    if (key !== this.moveKey) {
      this.moveKey = key;
      this.cachedMoves = legalMoves(this.state, this.state.active, this.state.remaining);
    }
    return this.cachedMoves;
  }
  beginRoll() {
    if (!['OPENING_ROLL', 'WAITING_FOR_ROLL'].includes(this.state.phase)) return false;
    this.state.phase = 'ROLLING';
    this.state.message = this.state.opening
      ? `Player ${this.state.active! + 1} · opening roll`
      : 'Rolling…';
    return true;
  }
  receiveRoll(values: number[]) {
    if (
      this.state.phase !== 'ROLLING' ||
      values.length !== 2 ||
      values.some((v) => !Number.isInteger(v) || v < 1 || v > 6)
    )
      return;
    this.state.roll = [...values];
    this.history = [];
    if (this.state.opening) {
      this.state.openingRolls[this.state.active!] = [...values];
      if (this.state.active === 0) {
        this.state.active = 1;
        this.state.phase = 'OPENING_ROLL';
        this.state.message = 'Player 2 rolls both dice.';
        return;
      }
      const totals = this.state.openingRolls.map((pair) =>
        pair!.reduce((sum, value) => sum + value, 0),
      );
      if (totals[0] === totals[1]) {
        this.state.active = 0;
        this.state.openingRolls = [null, null];
        this.state.phase = 'OPENING_ROLL';
        this.state.message = 'Tie · Player 1 rolls both dice again.';
        return;
      }
      this.state.active = totals[0] > totals[1] ? 0 : 1;
      this.state.opening = false;
      this.state.phase = 'WAITING_FOR_ROLL';
      this.state.message = `Player ${this.state.active + 1} starts · roll both dice for your first turn.`;
      return;
    }
    this.state.openingRolls = [null, null];
    this.state.remaining = values[0] === values[1] ? Array(4).fill(values[0]) : [...values];
    this.state.phase = 'WAITING_FOR_MOVE';
    if (!this.moves().length) {
      this.holdTurn('No legal moves · End your turn.');
      return;
    }
    this.state.message = 'Select a highlighted checker, then a destination.';
  }
  move(move: Move) {
    if (!this.moves().some((m) => m.from === move.from && m.to === move.to && m.die === move.die))
      return false;
    this.history.push(copy(this.state));
    Object.assign(this.state, applyMove(this.state, this.state.active!, move));
    this.state.remaining = without(this.state.remaining, move.die);
    this.state.phase = 'ANIMATING_MOVE';
    return true;
  }
  moveSequence(sequence: Move[]): Position[] | null {
    if (this.state.phase !== 'WAITING_FOR_MOVE' || !sequence.length) return null;
    const player = this.state.active!,
      stages: Position[] = [];
    let position: Position = { board: this.state.board, off: this.state.off },
      left = [...this.state.remaining];
    const checker = this.state.board[sequence[0].from].at(-1);
    for (const move of sequence) {
      if (
        position.board[move.from].at(-1) !== checker ||
        !legalMoves(position, player, left).some(
          (m) => m.from === move.from && m.to === move.to && m.die === move.die,
        )
      )
        return null;
      position = applyMove(position, player, move);
      left = without(left, move.die);
      stages.push(position);
      if (outcome(position) && stages.length !== sequence.length) return null;
    }
    this.history.push(copy(this.state));
    this.state.board = position.board;
    this.state.off = position.off;
    this.state.remaining = left;
    this.state.phase = 'ANIMATING_MOVE';
    return stages;
  }
  finishAnimation() {
    if (this.state.phase !== 'ANIMATING_MOVE') return;
    const result = outcome(this.state);
    if (result) {
      this.state.outcome = result;
      this.state.phase = 'GAME_OVER';
      this.state.message =
        result.winner === null
          ? result.reason
          : `Player ${result.winner + 1} wins · ${result.reason}`;
      return;
    }
    this.state.phase = 'WAITING_FOR_MOVE';
    if (!this.moves().length) this.holdTurn('Moves complete · End Turn, or Undo to reconsider.');
    else this.state.message = 'Select a highlighted checker, then a destination.';
  }
  undo() {
    if (!['WAITING_FOR_MOVE', 'TURN_COMPLETE'].includes(this.state.phase) || !this.history.length)
      return false;
    this.state = this.history.pop()!;
    return true;
  }
  private holdTurn(message: string) {
    this.state.phase = 'TURN_COMPLETE';
    this.state.message = message;
  }
  private pass() {
    const player = this.state.active!;
    this.state.active = other(player);
    this.state.phase = 'WAITING_FOR_ROLL';
    this.state.remaining = [];
    this.history = [];
    this.state.message = `Player ${player + 1} has no legal moves · Player ${this.state.active + 1}, roll.`;
  }
  endTurn() {
    if (this.state.phase !== 'TURN_COMPLETE') return false;
    this.pass();
    this.state.message = `Player ${this.state.active! + 1} · roll both dice.`;
    return true;
  }
  reset() {
    this.state = new Game().state;
    this.history = [];
  }
}
