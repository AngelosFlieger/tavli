import { other, owner } from '../../../rules/position';
import { HOME_POINTS, START_POINTS } from '../../abilities/board-regions';
import { defineAbility } from '../../abilities/define';
import { baseConfig, boolean, duration, exactKeys, record } from '../../abilities/validation';
import type { AbilityConfigBase, EffectDuration } from '../../base';

export type FrostSealConfig = AbilityConfigBase & {
  duration: EffectDuration;
  allowHomePoints: boolean;
  allowStartPoints: boolean;
  allowPinnedStacks: boolean;
  blockLeaving: boolean;
  blockLanding: boolean;
};

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
  copy(config) {
    return {
      name: { key: 'ability.frostSeal.name' },
      summary: { key: 'ability.frostSeal.summary', params: { count: config.duration.count } },
    };
  },
  behavior: {
    id: 'frostSeal',
    targets(state, player, config) {
      const opponent = other(player);

      return state.board.flatMap((stack, point) => {
        if (!stack.length || owner(stack.at(-1)!) !== opponent) return [];
        if (!config.allowStartPoints && START_POINTS.has(point)) return [];
        if (!config.allowHomePoints && HOME_POINTS.has(point)) return [];
        if (!config.allowPinnedStacks && stack.some((checker) => owner(checker) !== opponent))
          return [];

        return [{ type: 'POINT' as const, point }];
      });
    },
    effect(_state, activation, player, config) {
      return {
        abilityId: 'frostSeal',
        source: player,
        affectedPlayer: other(player),
        target: activation.target,
        tags: ['CONTROL'],
        constraints: [
          ...(config.blockLeaving ? [{ kind: 'BLOCK_LEAVING' as const }] : []),
          ...(config.blockLanding ? [{ kind: 'BLOCK_LANDING' as const }] : []),
        ],
        duration: config.duration,
        remaining: config.duration.count,
      };
    },
    effectIsValid(position, effect) {
      if (effect.target.type !== 'POINT') return true;

      const stack = position.board[effect.target.point];

      return stack.length > 0 && owner(stack.at(-1)!) === effect.affectedPlayer;
    },
  },
});
