import { defineAbility } from '../../abilities/define';
import { applyNumericAdjustment, numericAdjustmentOptions } from '../../abilities/roll-adjustment';
import {
  baseConfig,
  boolean,
  exactKeys,
  integer,
  oneOf,
  record,
  uniqueList,
} from '../../abilities/validation';
import type { AbilityConfigBase, RollKind } from '../../base';

export type NudgeConfig = AbilityConfigBase & {
  adjustment: number;
  directions: ('INCREASE' | 'DECREASE')[];
  allowedRolls: RollKind;
  allowBearingOff: boolean;
  createdMatchBecomesDouble: boolean;
};

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
  copy(config) {
    const sign =
      config.directions.length === 2 ? '±' : config.directions[0] === 'INCREASE' ? '+' : '−';
    return {
      name: { key: 'ability.nudge.name' },
      summary: { key: 'ability.nudge.summary', params: { amount: `${sign}${config.adjustment}` } },
    };
  },
  behavior: {
    id: 'nudge',
    options(state, _player, availableDice, config) {
      return numericAdjustmentOptions(state, availableDice, {
        adjustment: config.adjustment,
        directions: config.directions,
        allowedRolls: config.allowedRolls,
        allowBearingOff: config.allowBearingOff,
        createdMatchBecomesDouble: config.createdMatchBecomesDouble,
      });
    },
    randomCount() {
      return 0;
    },
    apply(state, player, activation, _randomValues, config, resolvedConfig, services) {
      return applyNumericAdjustment(
        state,
        activation,
        {
          adjustment: config.adjustment,
          directions: config.directions,
          allowedRolls: config.allowedRolls,
          allowBearingOff: config.allowBearingOff,
          createdMatchBecomesDouble: config.createdMatchBecomesDouble,
        },
        (after) => services.movementTokensForRoll(state, player, [after, after], resolvedConfig),
      );
    },
  },
});
