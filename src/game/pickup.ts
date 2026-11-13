import { legalMoves, moveSequences, spendDie } from './rules/moves';
import { outcome } from './rules/outcome';
import { applyMove, type Move, type Player, type Position } from './rules/position';

/** A pickup queue is feasible only if each checker can use a die in pickup order. */
export function canPlaceQueue(
  position: Position,
  player: Player,
  dice: number[],
  checkerIds: number[],
): boolean {
  if (!checkerIds.length) return true;
  if (checkerIds.length > dice.length) return false;
  const [checker, ...rest] = checkerIds;
  for (const move of legalMoves(position, player, dice)) {
    if (position.board[move.from].at(-1) !== checker) continue;
    const next = applyMove(position, player, move);
    if (outcome(next) && rest.length) continue;
    if (canPlaceQueue(next, player, spendDie(dice, move.die), rest)) return true;
  }
  return false;
}

/** Legal destinations for the first held checker that leave the rest placeable. */
export function queuedSequences(
  position: Position,
  player: Player,
  dice: number[],
  checkerIds: number[],
): Move[][] {
  const checker = checkerIds[0];
  if (checker === undefined) return [];
  const from = position.board.findIndex((stack) => stack.at(-1) === checker);
  if (from < 0) return [];
  return moveSequences(position, player, dice, from).filter((sequence) => {
    let next = position;
    let left = dice;
    for (const move of sequence) {
      next = applyMove(next, player, move);
      left = spendDie(left, move.die);
    }
    return canPlaceQueue(next, player, left, checkerIds.slice(1));
  });
}
