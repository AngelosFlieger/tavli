import type { Player } from '../rules/position';
import { abilityRegistry } from './abilities/registry';
import {
  ABILITY_IDS,
  type AbilityId,
  type DraftState,
  type PowerupsState,
  type ResolvedVariantConfig,
} from './types';
import { clearPassiveCounters, inventoryCapacity, rebuildPassivePolicies } from './passives/policy';

export function validateDraftOffer(
  powerups: PowerupsState,
  offer: AbilityId[],
  config: ResolvedVariantConfig,
): boolean {
  const expectedSize = config.draft.offer.powerups + config.draft.offer.passives;
  if (offer.length !== expectedSize || new Set(offer).size !== offer.length) return false;
  const held = new Set(
    powerups.loadouts.flatMap((loadout) =>
      [...loadout.powerups, ...loadout.passives].map((instance) => instance.abilityId),
    ),
  );
  let powerupCount = 0;
  let passiveCount = 0;
  for (const abilityId of offer) {
    const ability = config.abilities[abilityId];
    if (!ability?.enabled || (config.draft.excludeHeldAbilities && held.has(abilityId)))
      return false;
    if (abilityRegistry[abilityId].kind === 'POWERUP') powerupCount++;
    else passiveCount++;
  }
  return (
    powerupCount === config.draft.offer.powerups && passiveCount === config.draft.offer.passives
  );
}

export function sampleDraftOffer(
  powerups: PowerupsState,
  config: ResolvedVariantConfig,
  randomInt: (maximum: number) => number,
): AbilityId[] {
  const held = new Set(
    powerups.loadouts.flatMap((loadout) =>
      [...loadout.powerups, ...loadout.passives].map((instance) => instance.abilityId),
    ),
  );
  const available = ABILITY_IDS.filter(
    (id) => config.abilities[id].enabled && !(config.draft.excludeHeldAbilities && held.has(id)),
  );
  return [
    ...weightedSample(
      available.filter((id) => abilityRegistry[id].kind === 'POWERUP'),
      config.draft.offer.powerups,
      config,
      randomInt,
    ),
    ...weightedSample(
      available.filter((id) => abilityRegistry[id].kind === 'PASSIVE'),
      config.draft.offer.passives,
      config,
      randomInt,
    ),
  ];
}

function weightedSample(
  candidates: AbilityId[],
  count: number,
  config: ResolvedVariantConfig,
  randomInt: (maximum: number) => number,
): AbilityId[] {
  if (candidates.length < count) throw new Error('not enough eligible abilities for draft offer');
  const remaining = [...candidates];
  const result: AbilityId[] = [];
  while (result.length < count) {
    const total = remaining.reduce((sum, id) => sum + config.abilities[id].offerWeight, 0);
    const roll = randomInt(total);
    if (!Number.isInteger(roll) || roll < 0 || roll >= total)
      throw new Error('draft random source returned an out-of-range value');
    let cursor = roll;
    let selected = 0;
    for (; selected < remaining.length; selected++) {
      cursor -= config.abilities[remaining[selected]].offerWeight;
      if (cursor < 0) break;
    }
    result.push(remaining.splice(selected, 1)[0]);
  }
  return result;
}

export function resolveDraftOrder(
  draft: Extract<DraftState, { stage: 'ORDER_ROLL' }>,
  rolls: [number, number],
  config: ResolvedVariantConfig,
): { tied: true; draft: DraftState } | { tied: false; draft: DraftState; first: Player } {
  if (
    rolls.some((roll) => !Number.isInteger(roll) || roll < 1 || roll > config.draft.orderDieSides)
  )
    throw new Error('invalid draft order roll');
  const attempts = [...draft.attempts, rolls];
  if (rolls[0] === rolls[1]) {
    if (!config.draft.rerollOrderTies) throw new Error('tied draft order has no resolution rule');
    return { tied: true, draft: { ...draft, attempts } };
  }
  const first: Player = rolls[0] > rolls[1] ? 0 : 1;
  const second: Player = first === 0 ? 1 : 0;
  return {
    tied: false,
    first,
    draft: {
      stage: 'PICKING',
      offer: [...draft.offer],
      resumePlayer: draft.resumePlayer,
      attempts,
      pickOrder: [
        ...Array<Player>(config.draft.picksPerPlayer).fill(first),
        ...Array<Player>(config.draft.picksPerPlayer).fill(second),
      ],
      currentPick: 0,
      picks: [],
    },
  };
}

export type DraftPickResult =
  | { ok: false }
  | {
      ok: true;
      powerups: PowerupsState;
      replacedAbilityId?: AbilityId;
      finished: boolean;
      resumePlayer: Player;
    };

export function pickDraftAbility(
  powerups: PowerupsState,
  player: Player,
  abilityId: AbilityId,
  replaceInstanceId: string | undefined,
  config: ResolvedVariantConfig,
): DraftPickResult {
  const draft = powerups.draft;
  if (
    draft?.stage !== 'PICKING' ||
    draft.pickOrder[draft.currentPick] !== player ||
    !draft.offer.includes(abilityId)
  )
    return { ok: false };
  const definition = abilityRegistry[abilityId];
  const loadout = powerups.loadouts[player];
  const inventory = definition.kind === 'POWERUP' ? loadout.powerups : loadout.passives;
  const capacity = inventoryCapacity(powerups, player, definition.kind, config);
  if (
    !config.inventory.allowDuplicateAbilities &&
    [...loadout.powerups, ...loadout.passives].some((instance) => instance.abilityId === abilityId)
  )
    return { ok: false };

  let replacedAbilityId: AbilityId | undefined;
  if (inventory.length >= capacity) {
    const replacement = inventory.findIndex(
      (instance) => instance.instanceId === replaceInstanceId,
    );
    if (replacement < 0) return { ok: false };
    replacedAbilityId = inventory[replacement].abilityId;
    inventory.splice(replacement, 1);
    clearPassiveCounters(powerups, player, replacedAbilityId);
  } else if (replaceInstanceId !== undefined) return { ok: false };

  inventory.push({ instanceId: `ability-${powerups.nextAbilityInstance++}`, abilityId });
  rebuildPassivePolicies(powerups, player, config);
  draft.offer.splice(draft.offer.indexOf(abilityId), 1);
  draft.picks.push({ player, abilityId });
  draft.currentPick++;
  const finished = draft.currentPick === draft.pickOrder.length;
  return { ok: true, powerups, replacedAbilityId, finished, resumePlayer: draft.resumePlayer };
}
