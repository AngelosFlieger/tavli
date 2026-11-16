import type { Move, Player, Position } from '../../rules/position';
import type { GameState } from '../../session/state';
import type { AbilityId, PassivePolicyState, PowerupsState, ResolvedVariantConfig } from '../types';
import { homeGuardPassive } from './definitions/home-guard';
import { loadedKnucklesPassive } from './definitions/loaded-knuckles';
import { opportunistPassive } from './definitions/opportunist';
import { quartermasterPassive } from './definitions/quartermaster';
import type { PassiveAbilityBehavior, PassiveLifecycleEvent } from './capabilities';

export const passiveAbilityBehaviors = Object.freeze({
  loadedKnuckles: loadedKnucklesPassive,
  quartermaster: quartermasterPassive,
  homeGuard: homeGuardPassive,
  opportunist: opportunistPassive,
});

export type PassiveBehaviorId = keyof typeof passiveAbilityBehaviors;

export function hasPassiveBehavior(id: AbilityId): id is PassiveBehaviorId {
  return id in passiveAbilityBehaviors;
}

export function hasConfiguredPassive(
  powerups: PowerupsState | null,
  player: Player,
  abilityId: AbilityId,
): boolean {
  return Boolean(
    powerups?.loadouts[player].passives.some((instance) => instance.abilityId === abilityId),
  );
}

export function configuredPowerupCapacity(
  powerups: PowerupsState,
  player: Player,
  config: ResolvedVariantConfig,
): number {
  const adjustments = activeBehaviors(powerups, player).flatMap((id) => {
    const adjustment = passiveBehavior(id).inventory?.powerupCapacity?.(config.abilities[id]);
    return adjustment ? [adjustment] : [];
  });
  const replacements = adjustments
    .filter((adjustment) => adjustment.mode === 'REPLACE')
    .map((adjustment) => adjustment.slots);
  if (replacements.length) return Math.min(...replacements);
  return (
    config.inventory.powerupSlots +
    adjustments
      .filter((adjustment) => adjustment.mode === 'ADD')
      .reduce((sum, adjustment) => sum + adjustment.slots, 0)
  );
}

export function configuredCanUsePowerup(
  powerups: PowerupsState,
  player: Player,
  config: ResolvedVariantConfig,
): boolean {
  return activeBehaviors(powerups, player).every((id) => {
    const canUse = passiveBehavior(id).powerupUse?.canUse;
    return canUse ? canUse(powerups, player, config.abilities[id]) : true;
  });
}

export function notifyConfiguredPowerupUsed(
  powerups: PowerupsState,
  player: Player,
  config: ResolvedVariantConfig,
): void {
  for (const id of activeBehaviors(powerups, player))
    passiveBehavior(id).powerupUse?.used?.(powerups, player, config.abilities[id]);
}

export function advanceConfiguredPassivesAtTurnEnd(
  powerups: PowerupsState,
  player: Player,
  usedPowerupThisTurn: boolean,
  config: ResolvedVariantConfig,
): void {
  for (const id of activeBehaviors(powerups, player))
    passiveBehavior(id).powerupUse?.ownerTurnEnded?.(
      powerups,
      player,
      usedPowerupThisTurn,
      config.abilities[id],
    );
}

export function clearConfiguredPassiveState(
  powerups: PowerupsState,
  player: Player,
  abilityId: AbilityId,
): void {
  if (hasPassiveBehavior(abilityId)) passiveBehavior(abilityId).unequipped?.(powerups, player);
}

export function configuredPassivePolicy(
  powerups: PowerupsState,
  player: Player,
  config: ResolvedVariantConfig,
): PassivePolicyState {
  return activeBehaviors(powerups, player).reduce<PassivePolicyState>((policy, id) => {
    const contribution = passiveBehavior(id).movement?.policy(config.abilities[id]);
    return contribution ? { ...policy, ...contribution } : policy;
  }, {});
}

export function configuredPassiveMoveAllowed(
  position: Position,
  player: Player,
  move: Move,
): boolean {
  return (Object.keys(passiveAbilityBehaviors) as PassiveBehaviorId[]).every((id) => {
    const allows = passiveBehavior(id).movement?.allows;
    return allows ? allows(position, player, move) : true;
  });
}

export function generateConfiguredMovementRoll(
  state: GameState,
  player: Player,
  config: ResolvedVariantConfig,
  rollDie: () => number,
  randomInt: (maximum: number) => number,
): [number, number] {
  if (state.opening || !state.powerups) return [checkedDie(rollDie()), checkedDie(rollDie())];
  const id = activeBehaviors(state.powerups, player).find(
    (candidate) => passiveBehavior(candidate).roll,
  );
  return id
    ? passiveBehavior(id).roll!.generate(state, player, config.abilities[id], rollDie, randomInt)
    : [checkedDie(rollDie()), checkedDie(rollDie())];
}

export function configuredMovementTokens(
  state: GameState,
  player: Player,
  values: [number, number],
  config: ResolvedVariantConfig,
): number[] {
  if (values[0] !== values[1]) return [...values];
  if (!state.powerups) return Array(4).fill(values[0]);
  const id = activeBehaviors(state.powerups, player).find(
    (candidate) => passiveBehavior(candidate).roll,
  );
  return id
    ? passiveBehavior(id).roll!.movementTokens(state, player, values, config.abilities[id])
    : Array(4).fill(values[0]);
}

export function configuredRollSource(state: GameState, player: Player): GameState['rollSource'] {
  if (!state.powerups) return null;
  const id = activeBehaviors(state.powerups, player).find(
    (candidate) => passiveBehavior(candidate).roll,
  );
  return id ? passiveBehavior(id).roll!.source : null;
}

export function configuredOpponentStalledEvents(
  powerups: PowerupsState,
  stalledPlayer: Player,
  config: ResolvedVariantConfig,
): PassiveLifecycleEvent[] {
  const events: PassiveLifecycleEvent[] = [];
  for (const owner of [0, 1] as const)
    for (const id of activeBehaviors(powerups, owner)) {
      const event = passiveBehavior(id).opponentStalled?.(
        powerups,
        owner,
        stalledPlayer,
        config.abilities[id],
      );
      if (event) events.push(event);
    }
  return events;
}

function activeBehaviors(powerups: PowerupsState, player: Player): PassiveBehaviorId[] {
  return [
    ...new Set(
      powerups.loadouts[player].passives
        .map((instance) => instance.abilityId)
        .filter(hasPassiveBehavior),
    ),
  ];
}

/** Contains the only cast needed to preserve ID/config correlation in the heterogeneous registry. */
function passiveBehavior<Id extends PassiveBehaviorId>(id: Id): PassiveAbilityBehavior<Id> {
  return passiveAbilityBehaviors[id] as unknown as PassiveAbilityBehavior<Id>;
}

function checkedDie(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 6)
    throw new Error('die source returned an out-of-range value');
  return value;
}
