import type { FrostSealConfig } from '../../types';
import { defineAbility } from '../../abilities/define';
import {
  baseConfig,
  boolean,
  duration,
  exactKeys,
  record,
  turns,
} from '../../abilities/validation';

export const frostSeal = defineAbility<'frostSeal', FrostSealConfig>({
  id: 'frostSeal',
  kind: 'POWERUP',
  timing: 'WITH_END_TURN',
  validateConfig(value) {
    const input = record(value, 'frostSeal');
    exactKeys(
      input,
      [
        'enabled',
        'offerWeight',
        'duration',
        'allowHomePoints',
        'allowStartPoints',
        'allowPinnedStacks',
        'blockLeaving',
        'blockLanding',
      ],
      'frostSeal',
    );
    const result = {
      ...baseConfig(input, 'frostSeal'),
      duration: duration(input.duration, 'frostSeal.duration', ['TARGET_TURN_END']),
      allowHomePoints: boolean(input.allowHomePoints, 'frostSeal.allowHomePoints'),
      allowStartPoints: boolean(input.allowStartPoints, 'frostSeal.allowStartPoints'),
      allowPinnedStacks: boolean(input.allowPinnedStacks, 'frostSeal.allowPinnedStacks'),
      blockLeaving: boolean(input.blockLeaving, 'frostSeal.blockLeaving'),
      blockLanding: boolean(input.blockLanding, 'frostSeal.blockLanding'),
    };
    if (!result.blockLeaving && !result.blockLanding)
      throw new Error('frostSeal must block leaving, landing, or both');
    return result;
  },
  describe(config) {
    return {
      name: 'Frost Seal',
      summary: `Freeze a point for ${turns(config.duration.count, 'opponent turn')}.`,
    };
  },
});
