import type { Move, Player, Position } from '../../rules/position';
import type { GameState } from '../../session/state';
import type { AbilityConfigBase, PassivePolicyState, PowerupsState } from '../types';

export type PassiveCapacityAdjustment =
  { mode: 'ADD'; slots: number } | { mode: 'REPLACE'; slots: number };

export type PassiveLifecycleEvent = { type: 'FocusGained'; player: Player; focus: number };

/** Rule hooks owned by one equipped passive. All hooks are deterministic for resolved config. */
export type PassiveAbilityBehavior<Id extends string, Config extends AbilityConfigBase> = Readonly<{
  id: Id;
  inventory?: Readonly<{
    powerupCapacity?: (config: Config) => PassiveCapacityAdjustment;
  }>;
  powerupUse?: Readonly<{
    canUse?: (powerups: PowerupsState, player: Player, config: Config) => boolean;
    used?: (powerups: PowerupsState, player: Player, config: Config) => void;
    ownerTurnEnded?: (
      powerups: PowerupsState,
      player: Player,
      usedPowerupThisTurn: boolean,
      config: Config,
    ) => void;
  }>;
  roll?: Readonly<{
    source: NonNullable<GameState['rollSource']>;
    generate: (
      state: GameState,
      player: Player,
      config: Config,
      rollDie: () => number,
      randomInt: (maximum: number) => number,
    ) => [number, number];
    movementTokens: (
      state: GameState,
      player: Player,
      values: [number, number],
      config: Config,
    ) => number[];
  }>;
  movement?: Readonly<{
    policy: (config: Config) => Partial<PassivePolicyState>;
    allows: (position: Position, player: Player, move: Move) => boolean;
  }>;
  opponentStalled?: (
    powerups: PowerupsState,
    owner: Player,
    stalledPlayer: Player,
    config: Config,
  ) => PassiveLifecycleEvent | null;
  unequipped?: (powerups: PowerupsState, player: Player) => void;
}>;
