import { defineAbility } from '../../abilities/define';
import { baseConfig, exactKeys, integer, record } from '../../abilities/validation';
import type { AbilityConfigBase } from '../../base';
import {
  clearPassiveCounter,
  passiveCounter,
  QUARTERMASTER_COOLDOWN,
  setPassiveCounter,
} from '../counters';

export type QuartermasterConfig = AbilityConfigBase & {
  extraPowerupSlots: number;
  cooldownOwnTurns: number;
};

export const quartermaster = defineAbility<'quartermaster', QuartermasterConfig>({
  id: 'quartermaster',
  kind: 'PASSIVE',
  validateConfig(value) {
    const input = record(value, 'quartermaster');
    exactKeys(
      input,
      ['enabled', 'offerWeight', 'extraPowerupSlots', 'cooldownOwnTurns'],
      'quartermaster',
    );
    return {
      ...baseConfig(input, 'quartermaster'),
      extraPowerupSlots: integer(input.extraPowerupSlots, 'quartermaster.extraPowerupSlots', 1),
      cooldownOwnTurns: integer(input.cooldownOwnTurns, 'quartermaster.cooldownOwnTurns', 1),
    };
  },
  copy(config) {
    return {
      name: { key: 'ability.quartermaster.name' },
      summary: { key: 'ability.quartermaster.summary' },
      benefit: {
        key: 'ability.quartermaster.benefit',
        params: { count: config.extraPowerupSlots },
      },
      drawback: {
        key: 'ability.quartermaster.drawback',
        params: { count: config.cooldownOwnTurns },
      },
    };
  },
  behavior: {
    id: 'quartermaster',
    inventory: {
      powerupCapacity(config) {
        return { mode: 'ADD', slots: config.extraPowerupSlots };
      },
    },
    powerupUse: {
      canUse(powerups, player) {
        return passiveCounter(powerups, player, QUARTERMASTER_COOLDOWN) === 0;
      },
      used(powerups, player, config) {
        setPassiveCounter(powerups, player, QUARTERMASTER_COOLDOWN, config.cooldownOwnTurns);
      },
      ownerTurnEnded(powerups, player, usedPowerupThisTurn) {
        const remaining = passiveCounter(powerups, player, QUARTERMASTER_COOLDOWN);
        if (!usedPowerupThisTurn && remaining > 0)
          setPassiveCounter(powerups, player, QUARTERMASTER_COOLDOWN, remaining - 1);
      },
    },
    unequipped(powerups, player) {
      clearPassiveCounter(powerups, player, QUARTERMASTER_COOLDOWN);
    },
  },
});
