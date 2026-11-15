import type { QuartermasterConfig } from '../../types';
import { defineAbility } from '../../abilities/define';
import { baseConfig, exactKeys, integer, record, turns } from '../../abilities/validation';

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
