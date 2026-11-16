import { defineAfterRollAbilityBehavior } from '../../abilities/capabilities';
import { defineAbility } from '../../abilities/define';
import { replaceOneMovementToken } from '../../abilities/roll-adjustment';
import type { RecastConfig } from '../../types';
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

export const recastAfterRoll = defineAfterRollAbilityBehavior({
  id: 'recast',
  options(state, _player, availableDice, config) {
    if (!config.acceptResult) return [];
    if (config.allowedRolls === 'NON_DOUBLE' && state.roll[0] === state.roll[1]) return [];
    return availableDice.map((index) => ({ target: { type: 'DIE', index } }));
  },
  randomCount(config) {
    return config.rerollCount;
  },
  apply(state, player, activation, randomValues, config, resolvedConfig, services) {
    if (activation.target.type !== 'DIE') return null;
    const before = state.roll[activation.target.index];
    const after = randomValues.at(-1);
    if (after === undefined) return null;
    const wasDouble = state.roll[0] === state.roll[1];
    if (wasDouble && config.originalDoubleHandling === 'CHANGE_MATCHING_TOKENS')
      state.remaining = state.remaining.map((token) => (token === before ? after : token));
    else if (!replaceOneMovementToken(state.remaining, before, after)) return null;
    state.roll[activation.target.index] = after;
    if (!wasDouble && state.roll[0] === state.roll[1] && config.createdMatchBecomesDouble)
      state.remaining = services.movementTokensForRoll(
        state,
        player,
        [after, after],
        resolvedConfig,
      );
    return { before, after, allowBearingOff: true };
  },
});
