import type { AbilityConfigBase } from '../base';
import { homeGuard } from '../passives/definitions/home-guard';
import { loadedKnuckles } from '../passives/definitions/loaded-knuckles';
import { opportunist } from '../passives/definitions/opportunist';
import { quartermaster } from '../passives/definitions/quartermaster';
import { bastion } from '../powerups/definitions/bastion';
import { clearSkies } from '../powerups/definitions/clear-skies';
import { frostSeal } from '../powerups/definitions/frost-seal';
import { jinx } from '../powerups/definitions/jinx';
import { nudge } from '../powerups/definitions/nudge';
import { recast } from '../powerups/definitions/recast';

/**
 * The single ability registry. Adding an ability means writing one definition module, adding it
 * here, and giving each balance profile an entry; behavior maps, ID unions, and config maps are
 * derived from this object.
 *
 * Order is a public contract: seeded draft offers and persisted reports depend on it.
 */
export const abilityDefinitions = {
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
};

export type AbilityId = keyof typeof abilityDefinitions;

export type DefinitionOf<Id extends AbilityId> = (typeof abilityDefinitions)[Id];

type ConfigOf<Definition> = Definition extends {
  validateConfig: (value: unknown) => infer Config extends AbilityConfigBase;
}
  ? Config
  : never;

export type AbilityConfigMap = { [Id in AbilityId]: ConfigOf<DefinitionOf<Id>> };

export const ABILITY_IDS: readonly AbilityId[] = Object.freeze(
  Object.keys(abilityDefinitions) as AbilityId[],
);

/** Metadata access (kind/timing) used by rules, schema validation, and the UI. */
export const abilityRegistry = abilityDefinitions;

export function abilityDefinition<Id extends AbilityId>(id: Id): DefinitionOf<Id> {
  return abilityDefinitions[id];
}

/**
 * Renders one definition's copy references. The cast lives here, beside the registry, so callers
 * receive a descriptor without repeating ID/config correlation.
 */
export function abilityCopy(
  id: AbilityId,
  abilities: AbilityConfigMap,
): import('../base').AbilityCopyDescriptor {
  const definition = abilityDefinitions[id] as unknown as {
    copy: (config: AbilityConfigBase) => import('../base').AbilityCopyDescriptor;
  };

  return definition.copy(abilities[id]);
}
