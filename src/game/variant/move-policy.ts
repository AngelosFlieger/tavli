import type { Move, Player, Position } from '../rules/position';
import { activeEffectIsValid } from './abilities/behavior-registry';
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
    if (!activeEffectIsValid(position, effect)) return true;

    const point = effect.target.point;

    return effect.constraints.every((constraint) => {
      switch (constraint.kind) {
        case 'BLOCK_LEAVING':
          return move.from !== point;
        case 'BLOCK_LANDING':
          return move.to !== point;
        case 'ANCHOR_CHECKER':
        case 'DICE_PENALTY':
          return true;
      }
    });
  });
}
