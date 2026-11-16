import type { AbilityConfigMap, AbilityId, ResolvedVariantConfig } from '../types';
import type { AbilityDefinition } from './define';
import { bastion } from '../powerups/definitions/bastion';
import { clearSkies } from '../powerups/definitions/clear-skies';
import { frostSeal } from '../powerups/definitions/frost-seal';
import { jinx } from '../powerups/definitions/jinx';
import { nudge } from '../powerups/definitions/nudge';
import { recast } from '../powerups/definitions/recast';
import { homeGuard } from '../passives/definitions/home-guard';
import { loadedKnuckles } from '../passives/definitions/loaded-knuckles';
import { opportunist } from '../passives/definitions/opportunist';
import { quartermaster } from '../passives/definitions/quartermaster';

type AbilityRegistry = {
  [Id in AbilityId]: AbilityDefinition<Id, AbilityConfigMap[Id]>;
};

export const abilityRegistry = Object.freeze({
  frostSeal,
  bastion,
  jinx,
  clearSkies,
  recast,
  nudge,
  loadedKnuckles,
  quartermaster,
  homeGuard,
  opportunist,
}) satisfies AbilityRegistry;

export function describeAbility<Id extends AbilityId>(id: Id, config: AbilityConfigMap[Id]) {
  const definition = abilityRegistry[id] as unknown as AbilityDefinition<Id, AbilityConfigMap[Id]>;
  return definition.describe(config);
}

/** Keeps config lookup and the heterogeneous registry correlation in one central helper. */
export function describeConfiguredAbility(id: AbilityId, config: ResolvedVariantConfig) {
  const definition = abilityRegistry[id] as AbilityDefinition<
    AbilityId,
    AbilityConfigMap[AbilityId]
  >;
  return definition.describe(config.abilities[id]);
}
