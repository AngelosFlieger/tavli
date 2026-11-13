import { PATHS } from '../points';
import { other, owner, type Outcome, type Player, type Position } from './position';

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
