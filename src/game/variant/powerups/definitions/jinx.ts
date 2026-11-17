import { other } from '../../../rules/position';
import { defineAbility } from '../../abilities/define';
import {
  baseConfig,
  boolean,
  duration,
  exactKeys,
  integer,
  oneOf,
  record,
} from '../../abilities/validation';
import type { AbilityConfigBase, EffectDuration } from '../../base';

export type JinxConfig = AbilityConfigBase & {
  duration: EffectDuration;
  penalty: number;
  minimumToken: number;
  targetToken: 'HIGHEST' | 'LOWEST';
  affectDoubles: boolean;
  unaffectedDoubleConsumes: boolean;
  doubleHandling: 'CHANGE_ONE_TOKEN' | 'CHANGE_MATCHING_TOKENS';
};

export const jinx = defineAbility<'jinx', JinxConfig>({
  id: 'jinx',
  kind: 'POWERUP',
  timing: 'WITH_END_TURN',
  validateConfig(value) {
    const input = record(value, 'jinx');
    exactKeys(
      input,
      [
        'enabled',
        'offerWeight',
        'duration',
        'penalty',
        'minimumToken',
        'targetToken',
        'affectDoubles',
        'unaffectedDoubleConsumes',
        'doubleHandling',
      ],
      'jinx',
    );
    const minimumToken = integer(input.minimumToken, 'jinx.minimumToken', 1);
    if (minimumToken > 6) throw new Error('jinx.minimumToken must be <= 6');
    return {
      ...baseConfig(input, 'jinx'),
      duration: duration(input.duration, 'jinx.duration', ['NEXT_DRAFT']),
      penalty: integer(input.penalty, 'jinx.penalty', 1),
      minimumToken,
      targetToken: oneOf(input.targetToken, ['HIGHEST', 'LOWEST'], 'jinx.targetToken'),
      affectDoubles: boolean(input.affectDoubles, 'jinx.affectDoubles'),
      unaffectedDoubleConsumes: boolean(
        input.unaffectedDoubleConsumes,
        'jinx.unaffectedDoubleConsumes',
      ),
      doubleHandling: oneOf(
        input.doubleHandling,
        ['CHANGE_ONE_TOKEN', 'CHANGE_MATCHING_TOKENS'],
        'jinx.doubleHandling',
      ),
    };
  },
  copy(config) {
    return {
      name: { key: 'ability.jinx.name' },
      summary: {
        key:
          config.targetToken === 'HIGHEST'
            ? 'ability.jinx.summary.highest'
            : 'ability.jinx.summary.lowest',
        params: { penalty: config.penalty },
      },
    };
  },
  behavior: {
    id: 'jinx',
    targets(_state, player) {
      return [{ type: 'PLAYER', player: other(player) }];
    },
    effect(_state, activation, player, config) {
      return {
        abilityId: 'jinx',
        source: player,
        affectedPlayer: other(player),
        target: activation.target,
        tags: ['DICE_PENALTY'],
        modifiers: {
          dicePenalty: {
            penalty: config.penalty,
            minimumToken: config.minimumToken,
            targetToken: config.targetToken,
            affectDoubles: config.affectDoubles,
            unaffectedDoubleConsumes: config.unaffectedDoubleConsumes,
            doubleHandling: config.doubleHandling,
          },
        },
        duration: config.duration,
        remaining: config.duration.count,
      };
    },
  },
});
