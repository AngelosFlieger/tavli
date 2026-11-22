import type { AbilityConfigBase, AbilityCopyDescriptor, PowerTiming } from '../base';
import type { PassiveAbilityBehavior } from '../passives/capabilities';
import type {
  AfterRollAbilityBehavior,
  BeforeRollAbilityBehavior,
  EndTurnAbilityBehavior,
} from './capabilities';

/** Metadata every ability owns, independent of its timing. */
export type AbilityDefinitionBase<Id extends string, Config extends AbilityConfigBase> = Readonly<{
  id: Id;
  validateConfig: (value: unknown) => Config;
  /** Catalog references instead of prose: the UI renders them in the active locale. */
  copy: (config: Config) => AbilityCopyDescriptor;
}>;

type BehaviorFor<
  Timing extends PowerTiming,
  Id extends string,
  Config extends AbilityConfigBase,
> = Timing extends 'WITH_END_TURN'
  ? EndTurnAbilityBehavior<Id, Config>
  : Timing extends 'BEFORE_ROLL'
    ? BeforeRollAbilityBehavior<Id, Config>
    : AfterRollAbilityBehavior<Id, Config>;

/** A powerup must carry the behavior its timing requires; the type system enforces it. */
export type PowerupDefinition<
  Id extends string,
  Config extends AbilityConfigBase,
  Timing extends PowerTiming,
> = AbilityDefinitionBase<Id, Config> &
  Readonly<{
    kind: 'POWERUP';
    timing: Timing;
    behavior: BehaviorFor<Timing, Id, Config>;
  }>;

export type PassiveDefinition<
  Id extends string,
  Config extends AbilityConfigBase,
> = AbilityDefinitionBase<Id, Config> &
  Readonly<{
    kind: 'PASSIVE';
    /** Present only for passives that also act after a roll, such as Opportunist. */
    timing?: 'AFTER_ROLL_BEFORE_MOVE';
    behavior: PassiveAbilityBehavior<Id, Config>;
    afterRoll?: AfterRollAbilityBehavior<Id, Config>;
  }>;

export type AbilityDefinition<Id extends string, Config extends AbilityConfigBase> =
  | PowerupDefinition<Id, Config, 'WITH_END_TURN'>
  | PowerupDefinition<Id, Config, 'BEFORE_ROLL'>
  | PowerupDefinition<Id, Config, 'AFTER_ROLL_BEFORE_MOVE'>
  | PassiveDefinition<Id, Config>;

export function defineAbility<Id extends string, Config extends AbilityConfigBase>(
  definition: PowerupDefinition<Id, Config, 'WITH_END_TURN'>,
): PowerupDefinition<Id, Config, 'WITH_END_TURN'>;

export function defineAbility<Id extends string, Config extends AbilityConfigBase>(
  definition: PowerupDefinition<Id, Config, 'BEFORE_ROLL'>,
): PowerupDefinition<Id, Config, 'BEFORE_ROLL'>;

export function defineAbility<Id extends string, Config extends AbilityConfigBase>(
  definition: PowerupDefinition<Id, Config, 'AFTER_ROLL_BEFORE_MOVE'>,
): PowerupDefinition<Id, Config, 'AFTER_ROLL_BEFORE_MOVE'>;

export function defineAbility<Id extends string, Config extends AbilityConfigBase>(
  definition: PassiveDefinition<Id, Config>,
): PassiveDefinition<Id, Config>;

export function defineAbility(definition: object) {
  return Object.freeze(definition);
}
