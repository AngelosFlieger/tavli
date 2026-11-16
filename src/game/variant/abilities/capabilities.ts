import type { Player, Position } from '../../rules/position';
import type { GameState } from '../../session/state';
import type {
  AbilityActivation,
  AbilityConfigMap,
  AbilityId,
  AbilityTarget,
  ActiveEffect,
  ResolvedVariantConfig,
  RollAbilityOption,
} from '../types';

/** Pure rule behavior implemented by a powerup used atomically with End Turn. */
export type EndTurnAbilityBehavior<Id extends AbilityId> = Readonly<{
  id: Id;
  targets: (state: GameState, player: Player, config: AbilityConfigMap[Id]) => AbilityTarget[];
  effect: (
    state: GameState,
    activation: AbilityActivation,
    player: Player,
    config: AbilityConfigMap[Id],
  ) => Omit<ActiveEffect, 'instanceId'> & { abilityId: Id };
  effectIsValid?: (position: Position, effect: ActiveEffect) => boolean;
}>;

export function defineEndTurnAbilityBehavior<Id extends AbilityId>(
  behavior: EndTurnAbilityBehavior<Id>,
): EndTurnAbilityBehavior<Id> {
  return Object.freeze(behavior);
}

/** Pure rule behavior implemented by a powerup used before movement dice are rolled. */
export type BeforeRollAbilityBehavior<Id extends AbilityId> = Readonly<{
  id: Id;
  targets: (state: GameState, player: Player, config: AbilityConfigMap[Id]) => AbilityTarget[];
  apply: (
    state: GameState,
    player: Player,
    target: AbilityTarget,
    config: AbilityConfigMap[Id],
  ) => ActiveEffect[];
}>;

export function defineBeforeRollAbilityBehavior<Id extends AbilityId>(
  behavior: BeforeRollAbilityBehavior<Id>,
): BeforeRollAbilityBehavior<Id> {
  return Object.freeze(behavior);
}

export type AfterRollAbilityApplication = {
  before: number;
  after: number;
  allowBearingOff: boolean;
};

export type AfterRollAbilityServices = Readonly<{
  movementTokensForRoll: (
    state: GameState,
    player: Player,
    values: [number, number],
    config: ResolvedVariantConfig,
  ) => number[];
}>;

/** Pure option/result behavior for a powerup or active passive used after a movement roll. */
export type AfterRollAbilityBehavior<Id extends AbilityId> = Readonly<{
  id: Id;
  options: (
    state: GameState,
    player: Player,
    availableDice: readonly (0 | 1)[],
    config: AbilityConfigMap[Id],
  ) => RollAbilityOption[];
  randomCount: (config: AbilityConfigMap[Id]) => number;
  apply: (
    state: GameState,
    player: Player,
    activation: AbilityActivation,
    randomValues: number[],
    config: AbilityConfigMap[Id],
    resolvedConfig: ResolvedVariantConfig,
    services: AfterRollAbilityServices,
  ) => AfterRollAbilityApplication | null;
  canActivate?: (state: GameState, player: Player, config: AbilityConfigMap[Id]) => boolean;
  commit?: (state: GameState, player: Player, config: AbilityConfigMap[Id]) => void;
}>;

export function defineAfterRollAbilityBehavior<Id extends AbilityId>(
  behavior: AfterRollAbilityBehavior<Id>,
): AfterRollAbilityBehavior<Id> {
  return Object.freeze(behavior);
}
