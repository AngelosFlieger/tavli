import type { HomeGuardConfig } from '../../types';
import { defineAbility } from '../../abilities/define';
import { baseConfig, boolean, exactKeys, record } from '../../abilities/validation';

export const homeGuard = defineAbility<'homeGuard', HomeGuardConfig>({
  id: 'homeGuard',
  kind: 'PASSIVE',
  validateConfig(value) {
    const input = record(value, 'homeGuard');
    exactKeys(
      input,
      ['enabled', 'offerWeight', 'protectOwnHome', 'restrictOpponentHome', 'excludeStartPoints'],
      'homeGuard',
    );
    const result = {
      ...baseConfig(input, 'homeGuard'),
      protectOwnHome: boolean(input.protectOwnHome, 'homeGuard.protectOwnHome'),
      restrictOpponentHome: boolean(input.restrictOpponentHome, 'homeGuard.restrictOpponentHome'),
      excludeStartPoints: boolean(input.excludeStartPoints, 'homeGuard.excludeStartPoints'),
    };
    if (!result.protectOwnHome && !result.restrictOpponentHome)
      throw new Error('homeGuard must enable its protection, restriction, or both');
    return result;
  },
  describe(config) {
    return {
      name: 'Home Guard',
      ...(config.protectOwnHome ? { benefit: 'Your home singletons cannot be pinned.' } : {}),
      ...(config.restrictOpponentHome
        ? { drawback: 'You cannot pin in the opponent’s home.' }
        : {}),
      summary:
        config.protectOwnHome && config.restrictOpponentHome
          ? 'Trade home-board offense for home-board defense.'
          : config.protectOwnHome
            ? 'Protect your home-board singletons.'
            : 'Give up pins in the opponent’s home board.',
    };
  },
});
