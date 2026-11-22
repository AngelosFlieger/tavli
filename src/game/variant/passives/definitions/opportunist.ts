import { other } from '../../../rules/position';
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
import {
  clearPassiveCounter,
  OPPORTUNIST_FOCUS,
  passiveCounter,
  setPassiveCounter,
} from '../counters';

export type OpportunistConfig = AbilityConfigBase & {
  trigger: 'OPPONENT_NO_LEGAL_MOVES';
  focusCap: number;
  focusGain: number;
  focusAdjustment: number;
  focusUsesPerRoll: number;
  focusDirections: ('INCREASE' | 'DECREASE')[];
  allowedRolls: RollKind;
  allowBearingOff: boolean;
  createdMatchBecomesDouble: boolean;
  equippedPowerupSlots: number;
};

export const opportunist = defineAbility<'opportunist', OpportunistConfig>({
  id: 'opportunist',
  kind: 'PASSIVE',
  timing: 'AFTER_ROLL_BEFORE_MOVE',
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
  copy(config) {
    return {
      name: { key: 'ability.opportunist.name' },
      summary: { key: 'ability.opportunist.summary' },
      benefit: {
        key: 'ability.opportunist.benefit',
        params: {
          gain: config.focusGain,
          cap: config.focusCap,
          adjustment: config.focusAdjustment,
        },
      },
      drawback: {
        key: 'ability.opportunist.drawback',
        params: { slots: config.equippedPowerupSlots },
      },
    };
  },
  behavior: {
    id: 'opportunist',
    inventory: {
      powerupCapacity(config) {
        return { mode: 'REPLACE', slots: config.equippedPowerupSlots };
      },
    },
    opponentStalled(powerups, owner, stalledPlayer, config) {
      if (owner !== other(stalledPlayer)) return null;

      const current = passiveCounter(powerups, owner, OPPORTUNIST_FOCUS);
      const focus = Math.min(config.focusCap, current + config.focusGain);

      if (focus === current) return null;

      setPassiveCounter(powerups, owner, OPPORTUNIST_FOCUS, focus);

      return { type: 'FocusGained', player: owner, focus };
    },
    unequipped(powerups, player) {
      clearPassiveCounter(powerups, player, OPPORTUNIST_FOCUS);
    },
  },
  afterRoll: {
    id: 'opportunist',
    canActivate(state, player, config) {
      const used = state.diceModifiers.filter(
        (modifier) => modifier.abilityId === 'opportunist' && modifier.source === player,
      ).length;

      return (
        passiveCounter(state.powerups!, player, OPPORTUNIST_FOCUS) > 0 &&
        used < config.focusUsesPerRoll
      );
    },
    options(state, _player, availableDice, config) {
      return numericAdjustmentOptions(state, availableDice, {
        adjustment: config.focusAdjustment,
        directions: config.focusDirections,
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
          adjustment: config.focusAdjustment,
          directions: config.focusDirections,
          allowedRolls: config.allowedRolls,
          allowBearingOff: config.allowBearingOff,
          createdMatchBecomesDouble: config.createdMatchBecomesDouble,
        },
        (after) => services.movementTokensForRoll(state, player, [after, after], resolvedConfig),
      );
    },
    commit(state, player) {
      const focus = passiveCounter(state.powerups!, player, OPPORTUNIST_FOCUS);

      if (focus > 0) setPassiveCounter(state.powerups!, player, OPPORTUNIST_FOCUS, focus - 1);
    },
  },
});
