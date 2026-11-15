import type { RecastConfig } from '../../types';
import { defineAbility } from '../../abilities/define';
import { baseConfig, boolean, exactKeys, integer, oneOf, record } from '../../abilities/validation';

export const recast = defineAbility<'recast', RecastConfig>({
  id: 'recast',
  kind: 'POWERUP',
  timing: 'AFTER_ROLL_BEFORE_MOVE',
  validateConfig(value) {
    const input = record(value, 'recast');
    exactKeys(
      input,
      [
        'enabled',
        'offerWeight',
        'rerollCount',
        'acceptResult',
        'allowedRolls',
        'createdMatchBecomesDouble',
        'originalDoubleHandling',
      ],
      'recast',
    );
    const result = {
      ...baseConfig(input, 'recast'),
      rerollCount: integer(input.rerollCount, 'recast.rerollCount', 1),
      acceptResult: boolean(input.acceptResult, 'recast.acceptResult'),
      allowedRolls: oneOf(input.allowedRolls, ['ANY', 'NON_DOUBLE'], 'recast.allowedRolls'),
      createdMatchBecomesDouble: boolean(
        input.createdMatchBecomesDouble,
        'recast.createdMatchBecomesDouble',
      ),
      originalDoubleHandling: oneOf(
        input.originalDoubleHandling,
        ['CHANGE_ONE_TOKEN', 'CHANGE_MATCHING_TOKENS'],
        'recast.originalDoubleHandling',
      ),
    };
    if (!result.acceptResult)
      throw new Error(
        'recast.acceptResult must be true until optional reroll acceptance is modeled',
      );
    return result;
  },
  describe(config) {
    return {
      name: 'Recast',
      summary: `Reroll one die ${config.rerollCount} time${config.rerollCount === 1 ? '' : 's'} and use the final result.`,
    };
  },
});
