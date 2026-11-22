import type { Player } from '../../rules/position';
import type { PowerupsState } from '../types';

export const QUARTERMASTER_COOLDOWN = 'quartermasterCooldown';

export const OPPORTUNIST_FOCUS = 'opportunistFocus';

export function passiveCounter(powerups: PowerupsState, player: Player, key: string): number {
  return powerups.passiveCounters[player][key] ?? 0;
}

export function setPassiveCounter(
  powerups: PowerupsState,
  player: Player,
  key: string,
  value: number,
): void {
  powerups.passiveCounters[player][key] = value;
}

export function clearPassiveCounter(powerups: PowerupsState, player: Player, key: string): void {
  delete powerups.passiveCounters[player][key];
}
