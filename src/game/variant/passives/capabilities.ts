import type { Move, Player, Position } from '../../rules/position';
import type { GameState } from '../../session/state';
import type { AbilityConfigMap, AbilityId, PassivePolicyState, PowerupsState } from '../types';

export type PassiveCapacityAdjustment =
  | { mode: 'ADD'; slots: number }
  | { mode: 'REPLACE'; slots: number };

export type PassiveLifecycleEvent = { type: 'FocusGained'; player: Player; focus: number };

/** Rule hooks owned by one equipped passive. All hooks are deterministic for resolved config. */
export type PassiveAbilityBehavior<Id extends AbilityId> = Readonly<{
  id: Id;
  inventory?: Readonly<{
    powerupCapacity?: (config: AbilityConfigMap[Id]) => PassiveCapacityAdjustment;
  }>;
  powerupUse?: Readonly<{
    canUse?: (powerups: PowerupsState, player: Player, config: AbilityConfigMap[Id]) => boolean;
    used?: (powerups: PowerupsState, player: Player, config: AbilityConfigMap[Id]) => void;
    ownerTurnEnded?: (
      powerups: PowerupsState,
      player: Player,
      usedPowerupThisTurn: boolean,
      config: AbilityConfigMap[Id],
    ) => void;
  }>;
  roll?: Readonly<{
    source: NonNullable<GameState['rollSource']>;
    generate: (
      state: GameState,
      player: Player,
      config: AbilityConfigMap[Id],
      rollDie: () => number,
      randomInt: (maximum: number) => number,
    ) => [number, number];
    movementTokens: (
      state: GameState,
      player: Player,
      values: [number, number],
      config: AbilityConfigMap[Id],
    ) => number[];
  }>;
  movement?: Readonly<{
    policy: (config: AbilityConfigMap[Id]) => Partial<PassivePolicyState>;
    allows: (position: Position, player: Player, move: Move) => boolean;
  }>;
  opponentStalled?: (
    powerups: PowerupsState,
    owner: Player,
    stalledPlayer: Player,
    config: AbilityConfigMap[Id],
  ) => PassiveLifecycleEvent | null;
  unequipped?: (powerups: PowerupsState, player: Player) => void;
}>;

export function definePassiveAbilityBehavior<Id extends AbilityId>(
  behavior: PassiveAbilityBehavior<Id>,
): PassiveAbilityBehavior<Id> {
  return Object.freeze(behavior);
}
