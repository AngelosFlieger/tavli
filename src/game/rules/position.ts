import { PATHS } from '../points';

export type Player = 0 | 1;
export type Move = { from: number; to: number; die: number }; // -1 means bear off.
export type Outcome = { winner: Player | null; points: number; reason: string };
export type Position = { board: number[][]; off: [number[], number[]] };
export const owner = (id: number): Player => (id < 15 ? 0 : 1);
export const other = (player: Player): Player => (player === 0 ? 1 : 0);
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
export function applyMove(position: Position, player: Player, move: Move): Position {
  const next = structuredClone(position),
    id = next.board[move.from].pop()!;
  if (move.to === -1) next.off[player].push(id);
  else next.board[move.to].push(id);
  return next;
}
