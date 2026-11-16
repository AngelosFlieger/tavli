import type { Player, Position } from '../../rules/position';
import type { GameState } from '../../session/state';
import { bastionEndTurn } from '../powerups/definitions/bastion';
import { clearSkiesBeforeRoll } from '../powerups/definitions/clear-skies';
import { frostSealEndTurn } from '../powerups/definitions/frost-seal';
import { jinxEndTurn } from '../powerups/definitions/jinx';
import { nudgeAfterRoll } from '../powerups/definitions/nudge';
import { recastAfterRoll } from '../powerups/definitions/recast';
import { opportunistAfterRoll } from '../passives/definitions/opportunist';
import type {
  AbilityActivation,
  AbilityId,
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

export const afterRollAbilityBehaviors = Object.freeze({
  recast: recastAfterRoll,
  nudge: nudgeAfterRoll,
  opportunist: opportunistAfterRoll,
});

export type AfterRollAbilityId = keyof typeof afterRollAbilityBehaviors;

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

export const beforeRollAbilityBehaviors = Object.freeze({
  clearSkies: clearSkiesBeforeRoll,
});

export type BeforeRollAbilityId = keyof typeof beforeRollAbilityBehaviors;

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
  return beforeRollBehavior(id).apply(state, player, target, config.abilities[id]);
}

export const endTurnAbilityBehaviors = Object.freeze({
  frostSeal: frostSealEndTurn,
  bastion: bastionEndTurn,
  jinx: jinxEndTurn,
});

export type EndTurnAbilityId = keyof typeof endTurnAbilityBehaviors;

export function hasEndTurnAbilityBehavior(id: AbilityId): id is EndTurnAbilityId {
  return id in endTurnAbilityBehaviors;
}

export function configuredEndTurnTargets<Id extends EndTurnAbilityId>(
  id: Id,
  state: GameState,
  player: Player,
  config: ResolvedVariantConfig,
): AbilityTarget[] {
  return behavior(id).targets(state, player, config.abilities[id]);
}

export function createConfiguredEndTurnEffect<Id extends EndTurnAbilityId>(
  id: Id,
  state: GameState,
  activation: AbilityActivation,
  player: Player,
  config: ResolvedVariantConfig,
): Omit<ActiveEffect, 'instanceId'> & { abilityId: Id } {
  return behavior(id).effect(state, activation, player, config.abilities[id]);
}

export function activeEffectIsValid(position: Position, effect: ActiveEffect): boolean {
  if (!hasEndTurnAbilityBehavior(effect.abilityId)) return true;
  return behavior(effect.abilityId).effectIsValid?.(position, effect) ?? true;
}

/** Contains the only cast needed to preserve ID/config correlation in the heterogeneous registry. */
function behavior<Id extends EndTurnAbilityId>(id: Id): EndTurnAbilityBehavior<Id> {
  return endTurnAbilityBehaviors[id] as unknown as EndTurnAbilityBehavior<Id>;
}

function beforeRollBehavior<Id extends BeforeRollAbilityId>(id: Id): BeforeRollAbilityBehavior<Id> {
  return beforeRollAbilityBehaviors[id] as unknown as BeforeRollAbilityBehavior<Id>;
}

function afterRollBehavior<Id extends AfterRollAbilityId>(id: Id): AfterRollAbilityBehavior<Id> {
  return afterRollAbilityBehaviors[id] as unknown as AfterRollAbilityBehavior<Id>;
}
