import { PATHS } from '../points';
import { outcome } from './outcome';
import { applyMove, canBearOff, owner, type Move, type Player, type Position } from './position';

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
export const spendDie = (dice: number[], die: number) => {
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
        best = Math.max(best, 1 + count(applyMove(pos, player, move), spendDie(left, die)));
    memo.set(key, best);
    return best;
  }
  const candidates = [...new Set(dice)].flatMap((die) =>
    rawMoves(position, player, die).map((move) => {
      const next = applyMove(position, player, move);
      return { move, winning: !!outcome(next), count: 1 + count(next, spendDie(dice, die)) };
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
      if (move.to !== -1 && !outcome(next))
        visit(next, spendDie(left, move.die), move.to, nextPath);
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
