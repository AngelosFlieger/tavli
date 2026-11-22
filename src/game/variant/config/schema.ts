import { abilityRegistry } from '../abilities/registry';
import { boolean, exactKeys, integer, nonEmptyString, record } from '../abilities/validation';
import {
  ABILITY_IDS,
  type AbilityConfigBase,
  type AbilityConfigMap,
  type AbilityId,
  type ResolvedVariantConfig,
  type VariantConfig,
} from '../types';

export function resolveVariantConfig(value: unknown): ResolvedVariantConfig {
  const input = record(value, 'variant config');
  const suppliedHash = 'hash' in input ? nonEmptyString(input.hash, 'variant config.hash') : null;

  exactKeys(
    input,
    ['id', 'version', 'inventory', 'draft', 'abilities', ...(suppliedHash ? ['hash'] : [])],
    'variant config',
  );

  const id = nonEmptyString(input.id, 'variant config.id');

  if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
    throw new Error('variant config.id must use lowercase letters, digits, and hyphens');

  const version = integer(input.version, 'variant config.version', 1);

  const inventoryInput = record(input.inventory, 'variant config.inventory');

  exactKeys(
    inventoryInput,
    ['powerupSlots', 'passiveSlots', 'powerupsPerTurn', 'allowDuplicateAbilities'],
    'variant config.inventory',
  );

  const inventory = {
    powerupSlots: integer(inventoryInput.powerupSlots, 'inventory.powerupSlots'),
    passiveSlots: integer(inventoryInput.passiveSlots, 'inventory.passiveSlots'),
    powerupsPerTurn: integer(inventoryInput.powerupsPerTurn, 'inventory.powerupsPerTurn'),
    allowDuplicateAbilities: boolean(
      inventoryInput.allowDuplicateAbilities,
      'inventory.allowDuplicateAbilities',
    ),
  };

  const draftInput = record(input.draft, 'variant config.draft');

  exactKeys(
    draftInput,
    [
      'intervalRounds',
      'offer',
      'picksPerPlayer',
      'orderDieSides',
      'rerollOrderTies',
      'excludeHeldAbilities',
    ],
    'variant config.draft',
  );

  const offerInput = record(draftInput.offer, 'variant config.draft.offer');

  exactKeys(offerInput, ['powerups', 'passives'], 'variant config.draft.offer');

  const draft = {
    intervalRounds: integer(draftInput.intervalRounds, 'draft.intervalRounds', 1),
    offer: {
      powerups: integer(offerInput.powerups, 'draft.offer.powerups'),
      passives: integer(offerInput.passives, 'draft.offer.passives'),
    },
    picksPerPlayer: integer(draftInput.picksPerPlayer, 'draft.picksPerPlayer', 1),
    orderDieSides: integer(draftInput.orderDieSides, 'draft.orderDieSides', 2),
    rerollOrderTies: boolean(draftInput.rerollOrderTies, 'draft.rerollOrderTies'),
    excludeHeldAbilities: boolean(draftInput.excludeHeldAbilities, 'draft.excludeHeldAbilities'),
  };

  if (!draft.rerollOrderTies)
    throw new Error('rerollOrderTies must remain enabled until another tiebreak rule exists');

  const abilitiesInput = record(input.abilities, 'variant config.abilities');

  exactKeys(abilitiesInput, ABILITY_IDS, 'variant config.abilities');

  const validated = {} as Record<AbilityId, AbilityConfigBase>;

  for (const abilityId of ABILITY_IDS) {
    const definition = abilityRegistry[abilityId] as {
      validateConfig: (candidate: unknown) => AbilityConfigBase;
    };

    validated[abilityId] = definition.validateConfig(abilitiesInput[abilityId]);
  }

  const abilities = validated as AbilityConfigMap;

  validateComposition(inventory, draft, abilities);

  const config: VariantConfig = { id, version, inventory, draft, abilities };
  const hash = hashVariantConfig(config);

  if (suppliedHash !== null && suppliedHash !== hash)
    throw new Error(`variant config hash mismatch: expected ${hash}, received ${suppliedHash}`);

  return deepFreeze({ ...config, hash });
}

function validateComposition(
  inventory: VariantConfig['inventory'],
  draft: VariantConfig['draft'],
  abilities: AbilityConfigMap,
) {
  const offerSize = draft.offer.powerups + draft.offer.passives;

  if (offerSize < draft.picksPerPlayer * 2)
    throw new Error('draft offer must contain enough cards for both players');
  if (draft.offer.powerups && !inventory.powerupSlots)
    throw new Error('draft cannot offer powerups when powerupSlots is zero');
  if (draft.offer.passives && !inventory.passiveSlots)
    throw new Error('draft cannot offer passives when passiveSlots is zero');
  if (inventory.powerupsPerTurn > inventory.powerupSlots)
    throw new Error('powerupsPerTurn cannot exceed powerupSlots');

  let enabledPowerups = 0;
  let enabledPassives = 0;

  for (const abilityId of ABILITY_IDS) {
    if (!abilities[abilityId].enabled) continue;
    if (abilityRegistry[abilityId].kind === 'POWERUP') enabledPowerups++;
    else enabledPassives++;
  }
  if (enabledPowerups < draft.offer.powerups)
    throw new Error('not enough enabled powerups for the configured offer');
  if (enabledPassives < draft.offer.passives)
    throw new Error('not enough enabled passives for the configured offer');
}

export function hashVariantConfig(config: VariantConfig): string {
  const bytes = new TextEncoder().encode(canonicalJson(config));
  let hash = 0x811c9dc5;

  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }

  return `v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

  const input = value as Record<string, unknown>;

  return `{${Object.keys(input)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(input[key])}`)
    .join(',')}}`;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);

  return Object.freeze(value);
}
