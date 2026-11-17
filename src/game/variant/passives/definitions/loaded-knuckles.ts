import { defineAbility } from '../../abilities/define';
import {
  baseConfig,
  exactKeys,
  integer,
  oneOf,
  probability,
  record,
} from '../../abilities/validation';
import type { AbilityConfigBase, Probability } from '../../base';

export type LoadedKnucklesConfig = AbilityConfigBase & {
  matchChance: Probability;
  nonMatchDistribution: 'UNIFORM';
  doubleMoveTokens: number;
};

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
  copy(config) {
    return {
      name: { key: 'ability.loadedKnuckles.name' },
      summary: { key: 'ability.loadedKnuckles.summary' },
      benefit: {
        key: 'ability.loadedKnuckles.benefit',
        params: {
          numerator: config.matchChance.numerator,
          denominator: config.matchChance.denominator,
        },
      },
      drawback: {
        key: 'ability.loadedKnuckles.drawback',
        params: { tokens: config.doubleMoveTokens },
      },
    };
  },
  behavior: {
    id: 'loadedKnuckles',
    roll: {
      source: 'loadedKnuckles',
      generate(_state, _player, config, rollDie, randomInt) {
        const first = checkedDie(rollDie());
        const chance = config.matchChance;
        const chanceRoll = checkedRandom(randomInt(chance.denominator), chance.denominator);
        if (chanceRoll < chance.numerator) return [first, first];

        const alternatives = [1, 2, 3, 4, 5, 6].filter((value) => value !== first);
        return [
          first,
          alternatives[checkedRandom(randomInt(alternatives.length), alternatives.length)],
        ];
      },
      movementTokens(_state, _player, values, config) {
        return Array(config.doubleMoveTokens).fill(values[0]);
      },
    },
  },
});

function checkedDie(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 6)
    throw new Error('die source returned an out-of-range value');
  return value;
}

function checkedRandom(value: number, maximum: number): number {
  if (!Number.isInteger(value) || value < 0 || value >= maximum)
    throw new Error('random source returned an out-of-range value');
  return value;
}
