import type { ClearSkiesConfig } from '../../types';
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
