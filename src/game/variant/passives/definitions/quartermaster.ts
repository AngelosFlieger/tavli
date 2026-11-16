import type { QuartermasterConfig } from '../../types';
import { defineAbility } from '../../abilities/define';
import { baseConfig, exactKeys, integer, record, turns } from '../../abilities/validation';
import { definePassiveAbilityBehavior } from '../capabilities';
import {
  clearPassiveCounter,
  passiveCounter,
  QUARTERMASTER_COOLDOWN,
  setPassiveCounter,
} from '../counters';

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
  describe(config) {
    return {
      name: 'Quartermaster',
      benefit: `Hold ${config.extraPowerupSlots} extra powerup${config.extraPowerupSlots === 1 ? '' : 's'}.`,
      drawback: `Using one starts a ${turns(config.cooldownOwnTurns)} cooldown.`,
      summary: 'Carry more powerups, but use them less frequently.',
    };
  },
});

export const quartermasterPassive = definePassiveAbilityBehavior({
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
});
