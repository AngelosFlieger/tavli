import type { OpportunistConfig } from '../../types';
import { defineAbility } from '../../abilities/define';
import {
  baseConfig,
  boolean,
  exactKeys,
  integer,
  oneOf,
  record,
  uniqueList,
} from '../../abilities/validation';

export const opportunist = defineAbility<'opportunist', OpportunistConfig>({
  id: 'opportunist',
  kind: 'PASSIVE',
  validateConfig(value) {
    const input = record(value, 'opportunist');
    exactKeys(
      input,
      [
        'enabled',
        'offerWeight',
        'trigger',
        'focusCap',
        'focusGain',
        'focusAdjustment',
        'focusUsesPerRoll',
        'focusDirections',
        'allowedRolls',
        'allowBearingOff',
        'createdMatchBecomesDouble',
        'equippedPowerupSlots',
      ],
      'opportunist',
    );
    const focusDirections = uniqueList(
      input.focusDirections,
      ['INCREASE', 'DECREASE'],
      'opportunist.focusDirections',
    );
    if (!focusDirections.length) throw new Error('opportunist.focusDirections must not be empty');
    const result = {
      ...baseConfig(input, 'opportunist'),
      trigger: oneOf(input.trigger, ['OPPONENT_NO_LEGAL_MOVES'], 'opportunist.trigger'),
      focusCap: integer(input.focusCap, 'opportunist.focusCap', 1),
      focusGain: integer(input.focusGain, 'opportunist.focusGain', 1),
      focusAdjustment: integer(input.focusAdjustment, 'opportunist.focusAdjustment', 1),
      focusUsesPerRoll: integer(input.focusUsesPerRoll, 'opportunist.focusUsesPerRoll', 1),
      focusDirections,
      allowedRolls: oneOf(input.allowedRolls, ['ANY', 'NON_DOUBLE'], 'opportunist.allowedRolls'),
      allowBearingOff: boolean(input.allowBearingOff, 'opportunist.allowBearingOff'),
      createdMatchBecomesDouble: boolean(
        input.createdMatchBecomesDouble,
        'opportunist.createdMatchBecomesDouble',
      ),
      equippedPowerupSlots: integer(input.equippedPowerupSlots, 'opportunist.equippedPowerupSlots'),
    };
    if (result.focusUsesPerRoll > 2) throw new Error('opportunist.focusUsesPerRoll must be 1 or 2');
    return result;
  },
  describe(config) {
    return {
      name: 'Opportunist',
      benefit: `Gain ${config.focusGain} Focus up to ${config.focusCap}; spend it to adjust a die by ${config.focusAdjustment}.`,
      drawback: `Powerup capacity becomes ${config.equippedPowerupSlots}.`,
      summary: 'Turn an opponent’s stalled roll into a later dice adjustment.',
    };
  },
});
