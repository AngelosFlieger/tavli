import type { Player } from '../rules/position';
import type { AbilityActivation, ActiveEffect as BaseActiveEffect } from './base';
import type { AbilityConfigMap, AbilityId } from './abilities/catalog';

/**
 * Public variant type surface. Ability IDs, config maps, and primitives are derived from the
 * catalog and base modules so there is one source for them.
 */
export type { AbilityId, AbilityConfigMap } from './abilities/catalog';
export { ABILITY_IDS, abilityRegistry } from './abilities/catalog';
export type {
  AbilityActivation,
  AbilityConfigBase,
  AbilityCopy,
  AbilityCopyDescriptor,
  AbilityKind,
  AbilityTarget,
  EffectBoundary,
  EffectDuration,
  EffectTag,
  PowerTiming,
  Probability,
  RollAbilityOption,
  RollKind,
  TextRef,
} from './base';

export type Ruleset = 'CLASSIC' | 'POWERUPS_V1';

export type ActiveEffect<Id extends string = AbilityId> = BaseActiveEffect<Id>;

export type AbilityInstance = {
  instanceId: string;
  abilityId: AbilityId;
};

export type DiceModifier = {
  instanceId: string;
  abilityId: 'recast' | 'nudge' | 'opportunist' | 'jinx';
  source: Player;
  dieIndex: 0 | 1;
  before: number;
  after: number;
  randomResults: number[];
  option?: AbilityActivation['option'];
  allowBearingOff: boolean;
};

export type DraftState =
  | {
      stage: 'AWAITING_OFFER';
      resumePlayer: Player;
    }
  | {
      stage: 'ORDER_ROLL';
      offer: AbilityId[];
      resumePlayer: Player;
      attempts: [number, number][];
    }
  | {
      stage: 'PICKING';
      offer: AbilityId[];
      resumePlayer: Player;
      attempts: [number, number][];
      pickOrder: Player[];
      currentPick: number;
      picks: { player: Player; abilityId: AbilityId }[];
    };

export type PlayerLoadout = {
  powerups: AbilityInstance[];
  passives: AbilityInstance[];
};

export type PassivePolicyState = {
  homeGuard?: {
    protectOwnHome: boolean;
    restrictOpponentHome: boolean;
    excludeStartPoints: boolean;
  };
};

export type PowerupsState = {
  completedRounds: number;
  actedThisRound: [boolean, boolean];
  loadouts: [PlayerLoadout, PlayerLoadout];
  activeEffects: ActiveEffect[];
  passiveCounters: [Record<string, number>, Record<string, number>];
  passivePolicies: [PassivePolicyState, PassivePolicyState];
  powerupsUsedThisTurn: number;
  checkerMovedThisTurn: boolean;
  nextAbilityInstance: number;
  draft: DraftState | null;
};

export type VariantConfig = {
  id: string;
  version: number;
  inventory: {
    powerupSlots: number;
    passiveSlots: number;
    powerupsPerTurn: number;
    allowDuplicateAbilities: boolean;
  };
  draft: {
    intervalRounds: number;
    offer: { powerups: number; passives: number };
    picksPerPlayer: number;
    orderDieSides: number;
    rerollOrderTies: boolean;
    excludeHeldAbilities: boolean;
  };
  abilities: AbilityConfigMap;
};

export type ResolvedVariantConfig = Readonly<VariantConfig & { hash: string }>;

export type ClassicRulesContext = { ruleset: 'CLASSIC'; variantConfig: null };
export type PowerupsRulesContext = {
  ruleset: 'POWERUPS_V1';
  variantConfig: ResolvedVariantConfig;
};
export type RulesContext = ClassicRulesContext | PowerupsRulesContext;

export const CLASSIC_RULES: ClassicRulesContext = Object.freeze({
  ruleset: 'CLASSIC',
  variantConfig: null,
});

export function powerupsRules(variantConfig: ResolvedVariantConfig): PowerupsRulesContext {
  return Object.freeze({ ruleset: 'POWERUPS_V1', variantConfig });
}
