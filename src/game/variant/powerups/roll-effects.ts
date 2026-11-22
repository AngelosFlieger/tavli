import type { Player } from '../../rules/position';
import type { GameState } from '../../session/state';
import type { ActiveEffect, DiceModifier } from '../types';

export type RollEffectResolution = {
  modifiers: DiceModifier[];
  consumed: ActiveEffect[];
};

/**
 * Applies delayed public DICE_PENALTY constraints to movement tokens while preserving the physical
 * dice result. The loop is constraint-driven, so another penalty ability needs no change here.
 */
export function resolvePendingRollEffects(state: GameState, player: Player): RollEffectResolution {
  const powerups = state.powerups;

  if (!powerups || state.roll.length !== 2) return { modifiers: [], consumed: [] };

  const modifiers: DiceModifier[] = [];
  const consumed: ActiveEffect[] = [];
  const consumedIds = new Set<string>();

  for (const effect of powerups.activeEffects) {
    if (effect.affectedPlayer !== player) continue;

    const penalty = effect.constraints.find((constraint) => constraint.kind === 'DICE_PENALTY');

    if (!penalty) continue;

    const double = state.roll[0] === state.roll[1];

    if (double && !penalty.affectDoubles) {
      if (penalty.unaffectedDoubleConsumes) {
        consumed.push(effect);
        consumedIds.add(effect.instanceId);
      }

      continue;
    }

    const dieIndex = targetDieIndex(state.roll as [number, number], penalty.targetToken);
    const before = state.roll[dieIndex];
    const after = Math.min(before, Math.max(penalty.minimumToken, before - penalty.penalty));

    if (double && penalty.doubleHandling === 'CHANGE_MATCHING_TOKENS')
      state.remaining = state.remaining.map((token) => (token === before ? after : token));
    else replaceOneToken(state.remaining, before, after);

    const modifier: DiceModifier = {
      instanceId: effect.instanceId,
      abilityId: effect.abilityId as DiceModifier['abilityId'],
      source: effect.source,
      dieIndex,
      before,
      after,
      randomResults: [],
      allowBearingOff: true,
    };

    state.diceModifiers.push(modifier);
    modifiers.push(modifier);
    consumed.push(effect);
    consumedIds.add(effect.instanceId);
  }

  if (consumedIds.size)
    powerups.activeEffects = powerups.activeEffects.filter(
      (effect) => !consumedIds.has(effect.instanceId),
    );

  return { modifiers, consumed };
}

function targetDieIndex(roll: [number, number], target: 'HIGHEST' | 'LOWEST'): 0 | 1 {
  if (roll[0] === roll[1]) return 0;
  if (target === 'HIGHEST') return roll[0] > roll[1] ? 0 : 1;

  return roll[0] < roll[1] ? 0 : 1;
}

function replaceOneToken(tokens: number[], before: number, after: number): void {
  const index = tokens.indexOf(before);

  if (index < 0) throw new Error('delayed roll effect token is missing');

  tokens[index] = after;
}
