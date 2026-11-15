import type { LoadedKnucklesConfig } from '../../types';
import { defineAbility } from '../../abilities/define';
import {
  baseConfig,
  exactKeys,
  integer,
  oneOf,
  probability,
  record,
} from '../../abilities/validation';

export const loadedKnuckles = defineAbility<'loadedKnuckles', LoadedKnucklesConfig>({
  id: 'loadedKnuckles',
  kind: 'PASSIVE',
  validateConfig(value) {
    const input = record(value, 'loadedKnuckles');
    exactKeys(
      input,
      ['enabled', 'offerWeight', 'matchChance', 'nonMatchDistribution', 'doubleMoveTokens'],
      'loadedKnuckles',
    );
    return {
      ...baseConfig(input, 'loadedKnuckles'),
      matchChance: probability(input.matchChance, 'loadedKnuckles.matchChance'),
      nonMatchDistribution: oneOf(
        input.nonMatchDistribution,
        ['UNIFORM'],
        'loadedKnuckles.nonMatchDistribution',
      ),
      doubleMoveTokens: integer(input.doubleMoveTokens, 'loadedKnuckles.doubleMoveTokens', 1),
    };
  },
  describe(config) {
    return {
      name: 'Loaded Knuckles',
      benefit: `Doubles chance becomes ${config.matchChance.numerator}/${config.matchChance.denominator}.`,
      drawback: `Doubles grant ${config.doubleMoveTokens} movement tokens.`,
      summary: 'Roll doubles more often, but receive fewer double moves.',
    };
  },
});
