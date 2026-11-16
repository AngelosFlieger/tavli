import { other, owner } from '../../../rules/position';
import { HOME_POINTS, START_POINTS } from '../../abilities/board-regions';
import { defineEndTurnAbilityBehavior } from '../../abilities/capabilities';
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

export const frostSealEndTurn = defineEndTurnAbilityBehavior({
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
      modifiers: {
        blockLeaving: config.blockLeaving,
        blockLanding: config.blockLanding,
      },
      duration: config.duration,
      remaining: config.duration.count,
    };
  },
  effectIsValid(position, effect) {
    if (effect.target.type !== 'POINT') return true;
    const stack = position.board[effect.target.point];
    return stack.length > 0 && owner(stack.at(-1)!) === effect.affectedPlayer;
  },
});
