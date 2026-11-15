import type { BastionConfig } from '../../types';
import { defineAbility } from '../../abilities/define';
import {
  baseConfig,
  boolean,
  duration,
  exactKeys,
  integer,
  record,
  turns,
} from '../../abilities/validation';

export const bastion = defineAbility<'bastion', BastionConfig>({
  id: 'bastion',
  kind: 'POWERUP',
  timing: 'WITH_END_TURN',
  validateConfig(value) {
    const input = record(value, 'bastion');
    exactKeys(
      input,
      [
        'enabled',
        'offerWeight',
        'duration',
        'requiredOwnCheckers',
        'allowHomePoints',
        'allowStartPoints',
        'blockLanding',
      ],
      'bastion',
    );
    return {
      ...baseConfig(input, 'bastion'),
      duration: duration(input.duration, 'bastion.duration', ['TARGET_TURN_END']),
      requiredOwnCheckers: integer(input.requiredOwnCheckers, 'bastion.requiredOwnCheckers', 1),
      allowHomePoints: boolean(input.allowHomePoints, 'bastion.allowHomePoints'),
      allowStartPoints: boolean(input.allowStartPoints, 'bastion.allowStartPoints'),
      blockLanding: boolean(input.blockLanding, 'bastion.blockLanding'),
    };
  },
  describe(config) {
    return {
      name: 'Bastion',
      summary: `Protect one point for ${turns(config.duration.count, 'opponent turn')}.`,
    };
  },
});
