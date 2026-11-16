import type { Player } from '../rules/position';

export const ABILITY_IDS = [
  'frostSeal',
  'bastion',
  'jinx',
  'clearSkies',
  'recast',
  'nudge',
  'loadedKnuckles',
  'quartermaster',
  'homeGuard',
  'opportunist',
] as const;

export type AbilityId = (typeof ABILITY_IDS)[number];
export type AbilityKind = 'POWERUP' | 'PASSIVE';
export type PowerTiming = 'BEFORE_ROLL' | 'AFTER_ROLL_BEFORE_MOVE' | 'WITH_END_TURN';
export type Ruleset = 'CLASSIC' | 'POWERUPS_V1';

export type Probability = { numerator: number; denominator: number };
export type EffectBoundary = 'SOURCE_TURN_END' | 'TARGET_TURN_END' | 'NEXT_DRAFT';
export type EffectDuration = { boundary: EffectBoundary; count: number };
export type RollKind = 'ANY' | 'NON_DOUBLE';

export type AbilityConfigBase = {
  enabled: boolean;
  offerWeight: number;
};

export type FrostSealConfig = AbilityConfigBase & {
  duration: EffectDuration;
  allowHomePoints: boolean;
  allowStartPoints: boolean;
  allowPinnedStacks: boolean;
  blockLeaving: boolean;
  blockLanding: boolean;
};

export type BastionConfig = AbilityConfigBase & {
  duration: EffectDuration;
  requiredOwnCheckers: number;
  allowHomePoints: boolean;
  allowStartPoints: boolean;
  blockLanding: boolean;
};

export type JinxConfig = AbilityConfigBase & {
  duration: EffectDuration;
  penalty: number;
  minimumToken: number;
  targetToken: 'HIGHEST' | 'LOWEST';
  affectDoubles: boolean;
  unaffectedDoubleConsumes: boolean;
  doubleHandling: 'CHANGE_ONE_TOKEN' | 'CHANGE_MATCHING_TOKENS';
};

export type ClearSkiesConfig = AbilityConfigBase & {
  maxEffects: number;
  removableTags: ('CONTROL' | 'DICE_PENALTY' | 'PROTECTION')[];
  canTargetOpponentPositive: boolean;
};

export type RecastConfig = AbilityConfigBase & {
  rerollCount: number;
  acceptResult: boolean;
  allowedRolls: RollKind;
  createdMatchBecomesDouble: boolean;
  originalDoubleHandling: 'CHANGE_ONE_TOKEN' | 'CHANGE_MATCHING_TOKENS';
};

export type NudgeConfig = AbilityConfigBase & {
  adjustment: number;
  directions: ('INCREASE' | 'DECREASE')[];
  allowedRolls: RollKind;
  allowBearingOff: boolean;
  createdMatchBecomesDouble: boolean;
};

export type LoadedKnucklesConfig = AbilityConfigBase & {
  matchChance: Probability;
  nonMatchDistribution: 'UNIFORM';
  doubleMoveTokens: number;
};

export type QuartermasterConfig = AbilityConfigBase & {
  extraPowerupSlots: number;
  cooldownOwnTurns: number;
};

export type HomeGuardConfig = AbilityConfigBase & {
  protectOwnHome: boolean;
  restrictOpponentHome: boolean;
  excludeStartPoints: boolean;
};

export type OpportunistConfig = AbilityConfigBase & {
  trigger: 'OPPONENT_NO_LEGAL_MOVES';
  focusCap: number;
  focusGain: number;
  focusAdjustment: number;
  focusUsesPerRoll: number;
  focusDirections: ('INCREASE' | 'DECREASE')[];
  allowedRolls: RollKind;
  allowBearingOff: boolean;
  createdMatchBecomesDouble: boolean;
  equippedPowerupSlots: number;
};

export type AbilityConfigMap = {
  frostSeal: FrostSealConfig;
  bastion: BastionConfig;
  jinx: JinxConfig;
  clearSkies: ClearSkiesConfig;
  recast: RecastConfig;
  nudge: NudgeConfig;
  loadedKnuckles: LoadedKnucklesConfig;
  quartermaster: QuartermasterConfig;
  homeGuard: HomeGuardConfig;
  opportunist: OpportunistConfig;
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

export type AbilityCopy = {
  name: string;
  summary: string;
  benefit?: string;
  drawback?: string;
};

export type AbilityInstance = {
  instanceId: string;
  abilityId: AbilityId;
};

export type AbilityTarget =
  | { type: 'PLAYER'; player: Player }
  | { type: 'POINT'; point: number }
  | { type: 'CHECKER'; checker: number }
  | { type: 'DIE'; index: 0 | 1 }
  | { type: 'EFFECT'; instanceId: string };

export type ActiveEffect = {
  instanceId: string;
  abilityId: AbilityId;
  source: Player;
  affectedPlayer: Player;
  target: AbilityTarget;
  tags: ('CONTROL' | 'DICE_PENALTY' | 'PROTECTION')[];
  modifiers: {
    blockLeaving?: boolean;
    blockLanding?: boolean;
    anchorChecker?: number;
    dicePenalty?: {
      penalty: number;
      minimumToken: number;
      targetToken: 'HIGHEST' | 'LOWEST';
      affectDoubles: boolean;
      unaffectedDoubleConsumes: boolean;
      doubleHandling: 'CHANGE_ONE_TOKEN' | 'CHANGE_MATCHING_TOKENS';
    };
  };
  duration: EffectDuration;
  remaining: number;
};

export type AbilityActivation = {
  instanceId: string;
  target: AbilityTarget;
  option?: 'INCREASE' | 'DECREASE';
};

export type RollAbilityOption = {
  target: Extract<AbilityTarget, { type: 'DIE' }>;
  option?: AbilityActivation['option'];
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
