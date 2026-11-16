import type { Player } from '../../../rules/position';
import type { GameState } from '../../../session/state';
import { defineBeforeRollAbilityBehavior } from '../../abilities/capabilities';
import type { ActiveEffect, ClearSkiesConfig } from '../../types';
import { defineAbility } from '../../abilities/define';
import {
  baseConfig,
  boolean,
  exactKeys,
  integer,
  record,
  uniqueList,
} from '../../abilities/validation';

export const clearSkies = defineAbility<'clearSkies', ClearSkiesConfig>({
  id: 'clearSkies',
  kind: 'POWERUP',
  timing: 'BEFORE_ROLL',
  validateConfig(value) {
    const input = record(value, 'clearSkies');
    exactKeys(
      input,
      ['enabled', 'offerWeight', 'maxEffects', 'removableTags', 'canTargetOpponentPositive'],
      'clearSkies',
    );
    const removableTags = uniqueList(
      input.removableTags,
      ['CONTROL', 'DICE_PENALTY', 'PROTECTION'],
      'clearSkies.removableTags',
    );
    if (!removableTags.length) throw new Error('clearSkies.removableTags must not be empty');
    return {
      ...baseConfig(input, 'clearSkies'),
      maxEffects: integer(input.maxEffects, 'clearSkies.maxEffects', 1),
      removableTags,
      canTargetOpponentPositive: boolean(
        input.canTargetOpponentPositive,
        'clearSkies.canTargetOpponentPositive',
      ),
    };
  },
  describe(config) {
    return {
      name: 'Clear Skies',
      summary: `Remove up to ${config.maxEffects} hostile effect${config.maxEffects === 1 ? '' : 's'}.`,
    };
  },
});

export const clearSkiesBeforeRoll = defineBeforeRollAbilityBehavior({
  id: 'clearSkies',
  targets(state, player, config) {
    return removableEffects(state, player, config).map((effect) => ({
      type: 'EFFECT',
      instanceId: effect.instanceId,
    }));
  },
  apply(state, player, target, config) {
    if (target.type !== 'EFFECT') return [];
    const eligible = removableEffects(state, player, config);
    const selected = eligible.find((effect) => effect.instanceId === target.instanceId);
    if (!selected) return [];
    const removed = [selected, ...eligible.filter((effect) => effect !== selected)].slice(
      0,
      config.maxEffects,
    );
    const removedIds = new Set(removed.map((effect) => effect.instanceId));
    state.powerups!.activeEffects = state.powerups!.activeEffects.filter(
      (effect) => !removedIds.has(effect.instanceId),
    );
    return removed;
  },
});

function removableEffects(
  state: GameState,
  player: Player,
  config: ClearSkiesConfig,
): ActiveEffect[] {
  return (state.powerups?.activeEffects ?? []).filter((effect) => {
    if (effect.source === player) return false;
    const matchedTags = effect.tags.filter((tag) => config.removableTags.includes(tag));
    const hostile =
      effect.affectedPlayer === player && matchedTags.some((tag) => tag !== 'PROTECTION');
    const opponentPositive = config.canTargetOpponentPositive && matchedTags.includes('PROTECTION');
    return hostile || opponentPositive;
  });
}
