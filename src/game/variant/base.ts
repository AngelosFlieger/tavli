import type { Player } from '../rules/position';

/** Variant primitives. This module must not import the ability catalog or any registry. */

export type AbilityKind = 'POWERUP' | 'PASSIVE';

export type PowerTiming = 'BEFORE_ROLL' | 'AFTER_ROLL_BEFORE_MOVE' | 'WITH_END_TURN';

export type Probability = { numerator: number; denominator: number };

export type EffectBoundary = 'SOURCE_TURN_END' | 'TARGET_TURN_END' | 'NEXT_DRAFT';

export type EffectDuration = { boundary: EffectBoundary; count: number };

export type RollKind = 'ANY' | 'NON_DOUBLE';

export type EffectTag = 'CONTROL' | 'DICE_PENALTY' | 'PROTECTION';

/**
 * Public, serializable effect data. Rules interpret these; the UI renders them. A new effect that
 * reuses an existing kind needs no interpreter change, and adding a kind makes every interpreter
 * exhaustiveness-check fail until it is handled.
 */
export type EffectConstraint =
  | { kind: 'BLOCK_LEAVING' }
  | { kind: 'BLOCK_LANDING' }
  | { kind: 'ANCHOR_CHECKER'; checker: number }
  | {
      kind: 'DICE_PENALTY';
      penalty: number;
      minimumToken: number;
      targetToken: 'HIGHEST' | 'LOWEST';
      affectDoubles: boolean;
      unaffectedDoubleConsumes: boolean;
      doubleHandling: 'CHANGE_ONE_TOKEN' | 'CHANGE_MATCHING_TOKENS';
    };

export type AbilityConfigBase = {
  enabled: boolean;
  offerWeight: number;
};

export type AbilityTarget =
  | { type: 'PLAYER'; player: Player }
  | { type: 'POINT'; point: number }
  | { type: 'CHECKER'; checker: number }
  | { type: 'DIE'; index: 0 | 1 }
  | { type: 'EFFECT'; instanceId: string };

export type AbilityActivation = {
  instanceId: string;
  target: AbilityTarget;
  option?: 'INCREASE' | 'DECREASE';
};

export type RollAbilityOption = {
  target: Extract<AbilityTarget, { type: 'DIE' }>;
  option?: AbilityActivation['option'];
};

export type ActiveEffect<Id extends string = string> = {
  instanceId: string;
  abilityId: Id;
  source: Player;
  affectedPlayer: Player;
  target: AbilityTarget;
  tags: EffectTag[];
  constraints: readonly EffectConstraint[];
  duration: EffectDuration;
  remaining: number;
};

/** Rendered copy for one ability in the active locale. */
export type AbilityCopy = {
  name: string;
  summary: string;
  benefit?: string;
  drawback?: string;
};

/** A catalog reference: copy is data in the rules layer and text in the UI layer. */
export type TextRef = { key: string; params?: Record<string, string | number> };

export type AbilityCopyDescriptor = {
  name: TextRef;
  summary: TextRef;
  benefit?: TextRef;
  drawback?: TextRef;
};
