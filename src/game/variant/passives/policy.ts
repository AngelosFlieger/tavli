import { PATHS } from '../../points';
import { other, owner, type Move, type Player, type Position } from '../../rules/position';
import type { GameState } from '../../session/state';
import type { AbilityId, PowerupsState, ResolvedVariantConfig } from '../types';

export const QUARTERMASTER_COOLDOWN = 'quartermasterCooldown';
export const OPPORTUNIST_FOCUS = 'opportunistFocus';

const startPoints = new Set(PATHS.map((path) => path[0]));
const homePoints = PATHS.map((path) => new Set(path.slice(18)));

export function hasPassive(
  powerups: PowerupsState | null,
  player: Player,
  abilityId: AbilityId,
): boolean {
  return Boolean(
    powerups?.loadouts[player].passives.some((instance) => instance.abilityId === abilityId),
  );
}

export function powerupCapacity(
  powerups: PowerupsState,
  player: Player,
  config: ResolvedVariantConfig,
): number {
  if (hasPassive(powerups, player, 'opportunist'))
    return config.abilities.opportunist.equippedPowerupSlots;
  return (
    config.inventory.powerupSlots +
    (hasPassive(powerups, player, 'quartermaster')
      ? config.abilities.quartermaster.extraPowerupSlots
      : 0)
  );
}

export function inventoryCapacity(
  powerups: PowerupsState,
  player: Player,
  kind: 'POWERUP' | 'PASSIVE',
  config: ResolvedVariantConfig,
): number {
  return kind === 'POWERUP'
    ? powerupCapacity(powerups, player, config)
    : config.inventory.passiveSlots;
}

export function quartermasterCooldown(powerups: PowerupsState, player: Player): number {
  return powerups.passiveCounters[player][QUARTERMASTER_COOLDOWN] ?? 0;
}

export function opportunistFocus(powerups: PowerupsState, player: Player): number {
  return powerups.passiveCounters[player][OPPORTUNIST_FOCUS] ?? 0;
}

export function gainOpportunistFocus(
  powerups: PowerupsState,
  stalledPlayer: Player,
  config: ResolvedVariantConfig,
): { player: Player; focus: number } | null {
  const player = other(stalledPlayer);
  if (!hasPassive(powerups, player, 'opportunist')) return null;
  const current = opportunistFocus(powerups, player);
  const focus = Math.min(
    config.abilities.opportunist.focusCap,
    current + config.abilities.opportunist.focusGain,
  );
  if (focus === current) return null;
  powerups.passiveCounters[player][OPPORTUNIST_FOCUS] = focus;
  return { player, focus };
}

export function spendOpportunistFocus(powerups: PowerupsState, player: Player): boolean {
  const current = opportunistFocus(powerups, player);
  if (current <= 0) return false;
  powerups.passiveCounters[player][OPPORTUNIST_FOCUS] = current - 1;
  return true;
}

export function canUsePowerup(
  powerups: PowerupsState,
  player: Player,
  config: ResolvedVariantConfig,
): boolean {
  return (
    powerups.powerupsUsedThisTurn < config.inventory.powerupsPerTurn &&
    quartermasterCooldown(powerups, player) === 0
  );
}

export function recordPowerupUse(
  powerups: PowerupsState,
  player: Player,
  config: ResolvedVariantConfig,
): void {
  powerups.powerupsUsedThisTurn++;
  if (hasPassive(powerups, player, 'quartermaster'))
    powerups.passiveCounters[player][QUARTERMASTER_COOLDOWN] =
      config.abilities.quartermaster.cooldownOwnTurns;
}

/**
 * Advances counters after one of the owner's turns. The turn that starts a cooldown does not
 * consume one of its blocked future turns.
 */
export function advancePassiveCountersAtTurnEnd(
  powerups: PowerupsState,
  player: Player,
  usedPowerupThisTurn: boolean,
): void {
  const remaining = quartermasterCooldown(powerups, player);
  if (!usedPowerupThisTurn && remaining > 0)
    powerups.passiveCounters[player][QUARTERMASTER_COOLDOWN] = remaining - 1;
}

export function clearPassiveCounters(
  powerups: PowerupsState,
  player: Player,
  abilityId: AbilityId,
): void {
  if (abilityId === 'quartermaster')
    delete powerups.passiveCounters[player][QUARTERMASTER_COOLDOWN];
  if (abilityId === 'opportunist') delete powerups.passiveCounters[player][OPPORTUNIST_FOCUS];
}

/** Rebuilds the public, config-resolved policy snapshot after a passive inventory change. */
export function rebuildPassivePolicies(
  powerups: PowerupsState,
  player: Player,
  config: ResolvedVariantConfig,
): void {
  const policies = powerups.passivePolicies[player];
  delete policies.homeGuard;
  if (hasPassive(powerups, player, 'homeGuard')) {
    const homeGuard = config.abilities.homeGuard;
    policies.homeGuard = {
      protectOwnHome: homeGuard.protectOwnHome,
      restrictOpponentHome: homeGuard.restrictOpponentHome,
      excludeStartPoints: homeGuard.excludeStartPoints,
    };
  }
}

/** Applies persistent movement restrictions from public passive-policy state. */
export function moveAllowedByPassives(position: Position, player: Player, move: Move): boolean {
  if (move.to === -1) return true;
  const powerups = (position as Position & { powerups?: PowerupsState | null }).powerups;
  if (!powerups) return true;
  const destination = position.board[move.to];
  if (destination.length !== 1 || owner(destination[0]) === player) return true;
  const defender = other(player);
  const attackerGuard = powerups.passivePolicies[player].homeGuard;
  const defenderGuard = powerups.passivePolicies[defender].homeGuard;
  if (
    (attackerGuard?.excludeStartPoints || defenderGuard?.excludeStartPoints) &&
    startPoints.has(move.to)
  )
    return true;
  if (!homePoints[defender].has(move.to)) return true;
  if (attackerGuard?.restrictOpponentHome) return false;
  if (defenderGuard?.protectOwnHome) return false;
  return true;
}

/** Generates an authoritative movement roll, applying Loaded Knuckles when equipped. */
export function generateMovementRoll(
  state: GameState,
  player: Player,
  config: ResolvedVariantConfig,
  rollDie: () => number,
  randomInt: (maximum: number) => number,
): [number, number] {
  if (state.opening || !hasPassive(state.powerups, player, 'loadedKnuckles'))
    return [checkedDie(rollDie()), checkedDie(rollDie())];

  const first = checkedDie(rollDie());
  const chance = config.abilities.loadedKnuckles.matchChance;
  const chanceRoll = checkedRandom(randomInt(chance.denominator), chance.denominator);
  if (chanceRoll < chance.numerator) return [first, first];

  const alternatives = [1, 2, 3, 4, 5, 6].filter((value) => value !== first);
  return [first, alternatives[checkedRandom(randomInt(alternatives.length), alternatives.length)]];
}

export function movementTokensForRoll(
  state: GameState,
  player: Player,
  values: [number, number],
  config: ResolvedVariantConfig,
): number[] {
  if (values[0] !== values[1]) return [...values];
  const count = hasPassive(state.powerups, player, 'loadedKnuckles')
    ? config.abilities.loadedKnuckles.doubleMoveTokens
    : 4;
  return Array(count).fill(values[0]);
}

function checkedDie(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 6)
    throw new Error('die source returned an out-of-range value');
  return value;
}

function checkedRandom(value: number, maximum: number): number {
  if (!Number.isInteger(value) || value < 0 || value >= maximum)
    throw new Error('random source returned an out-of-range value');
  return value;
}
