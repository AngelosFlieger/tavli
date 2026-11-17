import { other, owner } from '../../../rules/position';
import { PLAYER_HOME_POINTS, START_POINTS } from '../../abilities/board-regions';
import { defineAbility } from '../../abilities/define';
import { baseConfig, boolean, exactKeys, record } from '../../abilities/validation';
import type { AbilityConfigBase } from '../../base';

export type HomeGuardConfig = AbilityConfigBase & {
  protectOwnHome: boolean;
  restrictOpponentHome: boolean;
  excludeStartPoints: boolean;
};

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
  copy(config) {
    return {
      name: { key: 'ability.homeGuard.name' },
      summary: {
        key:
          config.protectOwnHome && config.restrictOpponentHome
            ? 'ability.homeGuard.summary.both'
            : config.protectOwnHome
              ? 'ability.homeGuard.summary.defense'
              : 'ability.homeGuard.summary.offense',
      },
      ...(config.protectOwnHome ? { benefit: { key: 'ability.homeGuard.benefit' } } : {}),
      ...(config.restrictOpponentHome ? { drawback: { key: 'ability.homeGuard.drawback' } } : {}),
    };
  },
  behavior: {
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
  },
});
