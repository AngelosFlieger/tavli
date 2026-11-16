import type { HomeGuardConfig } from '../../types';
import { other, owner } from '../../../rules/position';
import { defineAbility } from '../../abilities/define';
import { PLAYER_HOME_POINTS, START_POINTS } from '../../abilities/board-regions';
import { baseConfig, boolean, exactKeys, record } from '../../abilities/validation';
import { definePassiveAbilityBehavior } from '../capabilities';

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

export const homeGuardPassive = definePassiveAbilityBehavior({
  id: 'homeGuard',
  movement: {
    policy(config) {
      return {
        homeGuard: {
          protectOwnHome: config.protectOwnHome,
          restrictOpponentHome: config.restrictOpponentHome,
          excludeStartPoints: config.excludeStartPoints,
        },
      };
    },
    allows(position, player, move) {
      if (move.to === -1) return true;
      const powerups = (
        position as typeof position & {
          powerups?: import('../../types').PowerupsState | null;
        }
      ).powerups;
      if (!powerups) return true;
      const destination = position.board[move.to];
      if (destination.length !== 1 || owner(destination[0]) === player) return true;
      const defender = other(player);
      const attackerGuard = powerups.passivePolicies[player].homeGuard;
      const defenderGuard = powerups.passivePolicies[defender].homeGuard;
      if (
        (attackerGuard?.excludeStartPoints || defenderGuard?.excludeStartPoints) &&
        START_POINTS.has(move.to)
      )
        return true;
      if (!PLAYER_HOME_POINTS[defender].has(move.to)) return true;
      return !attackerGuard?.restrictOpponentHome && !defenderGuard?.protectOwnHome;
    },
  },
});
