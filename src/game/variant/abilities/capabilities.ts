import type { Player, Position } from '../../rules/position';
import type { GameState } from '../../session/state';
import type {
  AbilityActivation,
  AbilityConfigBase,
  AbilityTarget,
  ActiveEffect,
  RollAbilityOption,
} from '../base';
import type { ResolvedVariantConfig } from '../types';

/** Pure rule behavior implemented by a powerup used atomically with End Turn. */
export type EndTurnAbilityBehavior<Id extends string, Config extends AbilityConfigBase> = Readonly<{
  id: Id;
  targets: (state: GameState, player: Player, config: Config) => AbilityTarget[];
  effect: (
    state: GameState,
    activation: AbilityActivation,
    player: Player,
    config: Config,
  ) => Omit<ActiveEffect<Id>, 'instanceId'>;
  effectIsValid?: (position: Position, effect: ActiveEffect<Id>) => boolean;
}>;

/** Pure rule behavior implemented by a powerup used before movement dice are rolled. */
export type BeforeRollAbilityBehavior<
  Id extends string,
  Config extends AbilityConfigBase,
> = Readonly<{
  id: Id;
  targets: (state: GameState, player: Player, config: Config) => AbilityTarget[];
  apply: (
    state: GameState,
    player: Player,
    target: AbilityTarget,
    config: Config,
  ) => ActiveEffect[];
}>;

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
export type AfterRollAbilityBehavior<
  Id extends string,
  Config extends AbilityConfigBase,
> = Readonly<{
  id: Id;
  options: (
    state: GameState,
    player: Player,
    availableDice: readonly (0 | 1)[],
    config: Config,
  ) => RollAbilityOption[];
  randomCount: (config: Config) => number;
  apply: (
    state: GameState,
    player: Player,
    activation: AbilityActivation,
    randomValues: number[],
    config: Config,
    resolvedConfig: ResolvedVariantConfig,
    services: AfterRollAbilityServices,
  ) => AfterRollAbilityApplication | null;
  canActivate?: (state: GameState, player: Player, config: Config) => boolean;
  commit?: (state: GameState, player: Player, config: Config) => void;
}>;
