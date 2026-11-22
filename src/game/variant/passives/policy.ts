import type { Move, Player, Position } from '../../rules/position';
import type { GameState } from '../../session/state';
import type { AbilityId, PowerupsState, ResolvedVariantConfig } from '../types';
import type { PassiveLifecycleEvent } from './capabilities';
import {
  advanceConfiguredPassivesAtTurnEnd,
  clearConfiguredPassiveState,
  configuredCanUsePowerup,
  configuredMovementTokens,
  configuredOpponentStalledEvents,
  configuredPassiveMoveAllowed,
  configuredPassivePolicy,
  configuredPowerupCapacity,
  configuredRollSource,
  generateConfiguredMovementRoll,
  hasConfiguredPassive,
  notifyConfiguredPowerupUsed,
} from './behavior-registry';
import {
  OPPORTUNIST_FOCUS,
  passiveCounter,
  QUARTERMASTER_COOLDOWN,
  setPassiveCounter,
} from './counters';

export { OPPORTUNIST_FOCUS, QUARTERMASTER_COOLDOWN } from './counters';

/** Compatibility façade over the typed passive behavior registry. */
export function hasPassive(
  powerups: PowerupsState | null,
  player: Player,
  abilityId: AbilityId,
): boolean {
  return hasConfiguredPassive(powerups, player, abilityId);
}

export function powerupCapacity(
  powerups: PowerupsState,
  player: Player,
  config: ResolvedVariantConfig,
): number {
  return configuredPowerupCapacity(powerups, player, config);
}

export function inventoryCapacity(
  powerups: PowerupsState,
  player: Player,
  kind: 'POWERUP' | 'PASSIVE',
  config: ResolvedVariantConfig,
): number {
  return kind === 'POWERUP'
    ? configuredPowerupCapacity(powerups, player, config)
    : config.inventory.passiveSlots;
}

export function quartermasterCooldown(powerups: PowerupsState, player: Player): number {
  return passiveCounter(powerups, player, QUARTERMASTER_COOLDOWN);
}

export function opportunistFocus(powerups: PowerupsState, player: Player): number {
  return passiveCounter(powerups, player, OPPORTUNIST_FOCUS);
}

export function gainOpportunistFocus(
  powerups: PowerupsState,
  stalledPlayer: Player,
  config: ResolvedVariantConfig,
): { player: Player; focus: number } | null {
  const event = configuredOpponentStalledEvents(powerups, stalledPlayer, config)[0];

  return event ? { player: event.player, focus: event.focus } : null;
}

export function passiveStallEvents(
  powerups: PowerupsState,
  stalledPlayer: Player,
  config: ResolvedVariantConfig,
): PassiveLifecycleEvent[] {
  return configuredOpponentStalledEvents(powerups, stalledPlayer, config);
}

export function spendOpportunistFocus(powerups: PowerupsState, player: Player): boolean {
  const current = opportunistFocus(powerups, player);

  if (current <= 0) return false;

  setPassiveCounter(powerups, player, OPPORTUNIST_FOCUS, current - 1);

  return true;
}

export function canUsePowerup(
  powerups: PowerupsState,
  player: Player,
  config: ResolvedVariantConfig,
): boolean {
  return (
    powerups.powerupsUsedThisTurn < config.inventory.powerupsPerTurn &&
    configuredCanUsePowerup(powerups, player, config)
  );
}

export function recordPowerupUse(
  powerups: PowerupsState,
  player: Player,
  config: ResolvedVariantConfig,
): void {
  powerups.powerupsUsedThisTurn++;
  notifyConfiguredPowerupUsed(powerups, player, config);
}

export function advancePassiveCountersAtTurnEnd(
  powerups: PowerupsState,
  player: Player,
  usedPowerupThisTurn: boolean,
  config: ResolvedVariantConfig,
): void {
  advanceConfiguredPassivesAtTurnEnd(powerups, player, usedPowerupThisTurn, config);
}

export function clearPassiveCounters(
  powerups: PowerupsState,
  player: Player,
  abilityId: AbilityId,
): void {
  clearConfiguredPassiveState(powerups, player, abilityId);
}

/** Rebuilds the public, config-resolved policy snapshot after a passive inventory change. */
export function rebuildPassivePolicies(
  powerups: PowerupsState,
  player: Player,
  config: ResolvedVariantConfig,
): void {
  powerups.passivePolicies[player] = configuredPassivePolicy(powerups, player, config);
}

/** Applies persistent movement restrictions from public passive-policy state. */
export function moveAllowedByPassives(position: Position, player: Player, move: Move): boolean {
  return configuredPassiveMoveAllowed(position, player, move);
}

/** Generates an authoritative movement roll using the equipped passive roll capability. */
export function generateMovementRoll(
  state: GameState,
  player: Player,
  config: ResolvedVariantConfig,
  rollDie: () => number,
  randomInt: (maximum: number) => number,
): [number, number] {
  return generateConfiguredMovementRoll(state, player, config, rollDie, randomInt);
}

export function movementTokensForRoll(
  state: GameState,
  player: Player,
  values: [number, number],
  config: ResolvedVariantConfig,
): number[] {
  return configuredMovementTokens(state, player, values, config);
}

export function movementRollSource(state: GameState, player: Player): GameState['rollSource'] {
  return configuredRollSource(state, player);
}
