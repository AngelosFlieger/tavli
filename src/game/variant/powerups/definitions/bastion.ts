import { other, owner } from '../../../rules/position';
import { HOME_POINTS, START_POINTS } from '../../abilities/board-regions';
import { defineAbility } from '../../abilities/define';
import {
  baseConfig,
  boolean,
  duration,
  exactKeys,
  integer,
  record,
} from '../../abilities/validation';
import type { AbilityConfigBase, EffectDuration } from '../../base';

export type BastionConfig = AbilityConfigBase & {
  duration: EffectDuration;
  requiredOwnCheckers: number;
  allowHomePoints: boolean;
  allowStartPoints: boolean;
  blockLanding: boolean;
};

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
  copy(config) {
    return {
      name: { key: 'ability.bastion.name' },
      summary: { key: 'ability.bastion.summary', params: { count: config.duration.count } },
    };
  },
  behavior: {
    id: 'bastion',
    targets(state, player, config) {
      return state.board.flatMap((stack, point) => {
        if (
          stack.length !== config.requiredOwnCheckers ||
          stack.some((checker) => owner(checker) !== player)
        )
          return [];
        if (!config.allowStartPoints && START_POINTS.has(point)) return [];
        if (!config.allowHomePoints && HOME_POINTS.has(point)) return [];
        return [{ type: 'POINT' as const, point }];
      });
    },
    effect(state, activation, player, config) {
      const point = activation.target.type === 'POINT' ? activation.target.point : -1;
      return {
        abilityId: 'bastion',
        source: player,
        affectedPlayer: other(player),
        target: activation.target,
        tags: ['PROTECTION'],
        constraints: [
          ...(config.blockLanding ? [{ kind: 'BLOCK_LANDING' as const }] : []),
          ...(state.board[point]?.at(-1) === undefined
            ? []
            : [{ kind: 'ANCHOR_CHECKER' as const, checker: state.board[point]!.at(-1)! }]),
        ],
        duration: config.duration,
        remaining: config.duration.count,
      };
    },
    effectIsValid(position, effect) {
      if (effect.target.type !== 'POINT') return true;
      const anchor = effect.constraints.find((constraint) => constraint.kind === 'ANCHOR_CHECKER');
      if (!anchor) return false;
      return position.board[effect.target.point].includes(anchor.checker);
    },
  },
});
