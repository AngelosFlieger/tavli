import type { Player, Position } from '../../rules/position';
import type { GameState } from '../../session/state';
import { abilityDefinitions, type AbilityId, type DefinitionOf } from './catalog';
import type {
  AbilityActivation,
  AbilityConfigBase,
  AbilityConfigMap,
  AbilityTarget,
  ActiveEffect,
  ResolvedVariantConfig,
  RollAbilityOption,
} from '../types';
import type {
  AfterRollAbilityApplication,
  AfterRollAbilityBehavior,
  AfterRollAbilityServices,
  BeforeRollAbilityBehavior,
  EndTurnAbilityBehavior,
} from './capabilities';

/**
 * Capability maps are derived from the catalog: a definition carries the behavior its kind and
 * timing require, so adding an ability does not mean editing a second registry.
 */
export type EndTurnAbilityId = {
  [Id in AbilityId]: DefinitionOf<Id> extends { kind: 'POWERUP'; timing: 'WITH_END_TURN' }
    ? Id
    : never;
}[AbilityId];

export type BeforeRollAbilityId = {
  [Id in AbilityId]: DefinitionOf<Id> extends { kind: 'POWERUP'; timing: 'BEFORE_ROLL' }
    ? Id
    : never;
}[AbilityId];

export type AfterRollAbilityId = {
  [Id in AbilityId]: DefinitionOf<Id> extends {
    kind: 'POWERUP';
    timing: 'AFTER_ROLL_BEFORE_MOVE';
  }
    ? Id
    : DefinitionOf<Id> extends { afterRoll: unknown }
      ? Id
      : never;
}[AbilityId];

type AnyBehavior =
  | EndTurnAbilityBehavior<string, AbilityConfigBase>
  | BeforeRollAbilityBehavior<string, AbilityConfigBase>
  | AfterRollAbilityBehavior<string, AbilityConfigBase>;

const behaviors: Partial<Record<string, AnyBehavior>> = {};

for (const [id, definition] of Object.entries(abilityDefinitions) as [
  AbilityId,
  DefinitionOf<AbilityId>,
][]) {
  if (definition.kind === 'POWERUP') behaviors[id] = definition.behavior as unknown as AnyBehavior;
  else if (definition.afterRoll)
    behaviors[id] = definition.afterRoll as unknown as AfterRollAbilityBehavior<
      string,
      AbilityConfigBase
    >;
}

const powerupTiming = (id: string): string | undefined =>
  abilityDefinitions[id as AbilityId].kind === 'POWERUP'
    ? abilityDefinitions[id as AbilityId].timing
    : undefined;

export const endTurnAbilityBehaviors = Object.freeze(
  Object.fromEntries(
    Object.entries(behaviors).filter(([id]) => powerupTiming(id) === 'WITH_END_TURN'),
  ),
) as Record<EndTurnAbilityId, EndTurnAbilityBehavior<EndTurnAbilityId, AbilityConfigBase>>;

export const beforeRollAbilityBehaviors = Object.freeze(
  Object.fromEntries(
    Object.entries(behaviors).filter(([id]) => powerupTiming(id) === 'BEFORE_ROLL'),
  ),
) as Record<BeforeRollAbilityId, BeforeRollAbilityBehavior<BeforeRollAbilityId, AbilityConfigBase>>;

export const afterRollAbilityBehaviors = Object.freeze(
  Object.fromEntries(
    Object.entries(behaviors).filter(([id]) => {
      const timing = powerupTiming(id);

      return timing === 'AFTER_ROLL_BEFORE_MOVE' || timing === undefined;
    }),
  ),
) as Record<AfterRollAbilityId, AfterRollAbilityBehavior<AfterRollAbilityId, AbilityConfigBase>>;

export function hasAfterRollAbilityBehavior(id: AbilityId): id is AfterRollAbilityId {
  return id in afterRollAbilityBehaviors;
}

export function configuredAfterRollCanActivate<Id extends AfterRollAbilityId>(
  id: Id,
  state: GameState,
  player: Player,
  config: ResolvedVariantConfig,
): boolean {
  return afterRollBehavior(id).canActivate?.(state, player, config.abilities[id]) ?? true;
}

export function configuredAfterRollOptions<Id extends AfterRollAbilityId>(
  id: Id,
  state: GameState,
  player: Player,
  availableDice: readonly (0 | 1)[],
  config: ResolvedVariantConfig,
): RollAbilityOption[] {
  return afterRollBehavior(id).options(state, player, availableDice, config.abilities[id]);
}

export function configuredAfterRollRandomCount<Id extends AfterRollAbilityId>(
  id: Id,
  config: ResolvedVariantConfig,
): number {
  return afterRollBehavior(id).randomCount(config.abilities[id]);
}

export function applyConfiguredAfterRoll<Id extends AfterRollAbilityId>(
  id: Id,
  state: GameState,
  player: Player,
  activation: AbilityActivation,
  randomValues: number[],
  config: ResolvedVariantConfig,
  services: AfterRollAbilityServices,
): AfterRollAbilityApplication | null {
  return afterRollBehavior(id).apply(
    state,
    player,
    activation,
    randomValues,
    config.abilities[id],
    config,
    services,
  );
}

export function commitConfiguredAfterRoll<Id extends AfterRollAbilityId>(
  id: Id,
  state: GameState,
  player: Player,
  config: ResolvedVariantConfig,
): void {
  afterRollBehavior(id).commit?.(state, player, config.abilities[id]);
}

export function hasBeforeRollAbilityBehavior(id: AbilityId): id is BeforeRollAbilityId {
  return id in beforeRollAbilityBehaviors;
}

export function configuredBeforeRollTargets<Id extends BeforeRollAbilityId>(
  id: Id,
  state: GameState,
  player: Player,
  config: ResolvedVariantConfig,
): AbilityTarget[] {
  return beforeRollBehavior(id).targets(state, player, config.abilities[id]);
}

export function applyConfiguredBeforeRoll<Id extends BeforeRollAbilityId>(
  id: Id,
  state: GameState,
  player: Player,
  target: AbilityTarget,
  config: ResolvedVariantConfig,
): ActiveEffect[] {
  return beforeRollBehavior(id).apply(
    state,
    player,
    target,
    config.abilities[id],
  ) as ActiveEffect[];
}

export function hasEndTurnAbilityBehavior(id: AbilityId): id is EndTurnAbilityId {
  return id in endTurnAbilityBehaviors;
}

export function configuredEndTurnTargets<Id extends EndTurnAbilityId>(
  id: Id,
  state: GameState,
  player: Player,
  config: ResolvedVariantConfig,
): AbilityTarget[] {
  return endTurnBehavior(id).targets(state, player, config.abilities[id]);
}

export function createConfiguredEndTurnEffect<Id extends EndTurnAbilityId>(
  id: Id,
  state: GameState,
  activation: AbilityActivation,
  player: Player,
  config: ResolvedVariantConfig,
): Omit<ActiveEffect<Id>, 'instanceId'> {
  return endTurnBehavior(id).effect(state, activation, player, config.abilities[id]);
}

export function activeEffectIsValid(position: Position, effect: ActiveEffect): boolean {
  if (!hasEndTurnAbilityBehavior(effect.abilityId)) return true;

  const typed = effect as ActiveEffect<EndTurnAbilityId>;

  return endTurnBehavior(typed.abilityId).effectIsValid?.(position, typed) ?? true;
}

/** Contains the only cast needed to preserve ID/config correlation in the derived registry. */
function endTurnBehavior<Id extends EndTurnAbilityId>(
  id: Id,
): EndTurnAbilityBehavior<Id, AbilityConfigMap[Id]> {
  return endTurnAbilityBehaviors[id] as unknown as EndTurnAbilityBehavior<Id, AbilityConfigMap[Id]>;
}

function beforeRollBehavior<Id extends BeforeRollAbilityId>(
  id: Id,
): BeforeRollAbilityBehavior<Id, AbilityConfigMap[Id]> {
  return beforeRollAbilityBehaviors[id] as unknown as BeforeRollAbilityBehavior<
    Id,
    AbilityConfigMap[Id]
  >;
}

function afterRollBehavior<Id extends AfterRollAbilityId>(
  id: Id,
): AfterRollAbilityBehavior<Id, AbilityConfigMap[Id]> {
  return afterRollAbilityBehaviors[id] as unknown as AfterRollAbilityBehavior<
    Id,
    AbilityConfigMap[Id]
  >;
}
