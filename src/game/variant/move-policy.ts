import type { Move, Player, Position } from '../rules/position';
import { owner } from '../rules/position';
import type { PowerupsState } from './types';
import { moveAllowedByPassives } from './passives/policy';

type EffectPosition = Position & {
  powerups?: PowerupsState | null;
  roll?: number[];
  diceModifiers?: import('./types').DiceModifier[];
};

/** Applies active variant effects after baseline Plakoto has produced raw legal landings. */
export function moveAllowedByActiveEffects(
  position: Position,
  player: Player,
  move: Move,
): boolean {
  if (!moveAllowedByPassives(position, player, move)) return false;
  const powerups = (position as EffectPosition).powerups;
  const variantPosition = position as EffectPosition;
  if (
    move.to === -1 &&
    variantPosition.diceModifiers?.some(
      (modifier) =>
        !modifier.allowBearingOff &&
        modifier.after === move.die &&
        !variantPosition.roll?.some(
          (value, index) => index !== modifier.dieIndex && value === modifier.after,
        ),
    )
  )
    return false;
  if (!powerups) return true;
  return powerups.activeEffects.every((effect) => {
    if (effect.affectedPlayer !== player || effect.target.type !== 'POINT') return true;
    const stack = position.board[effect.target.point];
    if (
      (effect.abilityId === 'frostSeal' &&
        (!stack.length || owner(stack.at(-1)!) !== effect.affectedPlayer)) ||
      (effect.abilityId === 'bastion' &&
        (effect.modifiers.anchorChecker === undefined ||
          !stack.includes(effect.modifiers.anchorChecker)))
    )
      return true;
    if (effect.modifiers.blockLeaving && move.from === effect.target.point) return false;
    if (effect.modifiers.blockLanding && move.to === effect.target.point) return false;
    return true;
  });
}
