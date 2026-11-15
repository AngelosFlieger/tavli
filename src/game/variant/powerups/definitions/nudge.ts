import type { NudgeConfig } from '../../types';
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

export const nudge = defineAbility<'nudge', NudgeConfig>({
  id: 'nudge',
  kind: 'POWERUP',
  timing: 'AFTER_ROLL_BEFORE_MOVE',
  validateConfig(value) {
    const input = record(value, 'nudge');
    exactKeys(
      input,
      [
        'enabled',
        'offerWeight',
        'adjustment',
        'directions',
        'allowedRolls',
        'allowBearingOff',
        'createdMatchBecomesDouble',
      ],
      'nudge',
    );
    const directions = uniqueList(input.directions, ['INCREASE', 'DECREASE'], 'nudge.directions');
    if (!directions.length) throw new Error('nudge.directions must not be empty');
    return {
      ...baseConfig(input, 'nudge'),
      adjustment: integer(input.adjustment, 'nudge.adjustment', 1),
      directions,
      allowedRolls: oneOf(input.allowedRolls, ['ANY', 'NON_DOUBLE'], 'nudge.allowedRolls'),
      allowBearingOff: boolean(input.allowBearingOff, 'nudge.allowBearingOff'),
      createdMatchBecomesDouble: boolean(
        input.createdMatchBecomesDouble,
        'nudge.createdMatchBecomesDouble',
      ),
    };
  },
  describe(config) {
    const sign =
      config.directions.length === 2 ? '±' : config.directions[0] === 'INCREASE' ? '+' : '−';
    return { name: 'Nudge', summary: `Adjust one movement die by ${sign}${config.adjustment}.` };
  },
});
