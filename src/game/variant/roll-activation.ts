import type { Player } from '../rules/position';
import type { GameState } from '../session/state';
import {
  applyConfiguredAfterRoll,
  commitConfiguredAfterRoll,
  configuredAfterRollCanActivate,
  configuredAfterRollOptions,
  configuredAfterRollRandomCount,
  hasAfterRollAbilityBehavior,
  type AfterRollAbilityId,
} from './abilities/behavior-registry';
import { abilityRegistry } from './abilities/registry';
import { canUsePowerup, movementTokensForRoll, recordPowerupUse } from './passives/policy';
import type {
  AbilityActivation,
  AbilityInstance,
  DiceModifier,
  ResolvedVariantConfig,
  RollAbilityOption,
} from './types';

type RollAbilityInstance = AbilityInstance & { abilityId: AfterRollAbilityId };

export function rollAbilityOptions(
  state: GameState,
  player: Player,
  instanceId: string,
  config: ResolvedVariantConfig,
): RollAbilityOption[] {
  const powerups = state.powerups;
  if (
    state.phase !== 'WAITING_FOR_MOVE' ||
    state.active !== player ||
    state.roll.length !== 2 ||
    !powerups ||
    powerups.checkerMovedThisTurn
  )
    return [];
  const loadout = powerups.loadouts[player];
  const powerup = loadout.powerups.find((candidate) => candidate.instanceId === instanceId);
  const passive = loadout.passives.find((candidate) => candidate.instanceId === instanceId);
  const instance = powerup ?? passive;
  if (
    !instance ||
    abilityRegistry[instance.abilityId].timing !== 'AFTER_ROLL_BEFORE_MOVE' ||
    !hasAfterRollAbilityBehavior(instance.abilityId) ||
    (powerup && !canUsePowerup(powerups, player, config)) ||
    !configuredAfterRollCanActivate(instance.abilityId, state, player, config)
  )
    return [];
  const availableDice = ([0, 1] as const).filter(
    (index) =>
      !state.diceModifiers.some((modifier) => modifier.dieIndex === index) &&
      state.remaining.includes(state.roll[index]),
  );
  return configuredAfterRollOptions(instance.abilityId, state, player, availableDice, config);
}

export function rollAbilityRandomCount(
  state: GameState,
  player: Player,
  activation: AbilityActivation,
  config: ResolvedVariantConfig,
): number | null {
  const instance = rollAbilityInstance(state, player, activation, config);
  return instance ? configuredAfterRollRandomCount(instance.abilityId, config) : null;
}

export function activateRollAbility(
  state: GameState,
  player: Player,
  activation: AbilityActivation,
  randomValues: number[],
  config: ResolvedVariantConfig,
): DiceModifier | null {
  const instance = rollAbilityInstance(state, player, activation, config);
  const target = activation.target;
  if (!instance || target.type !== 'DIE') return null;
  const expectedRandom = configuredAfterRollRandomCount(instance.abilityId, config);
  if (
    randomValues.length !== expectedRandom ||
    randomValues.some((value) => !Number.isInteger(value) || value < 1 || value > 6)
  )
    return null;

  const applied = applyConfiguredAfterRoll(
    instance.abilityId,
    state,
    player,
    activation,
    randomValues,
    config,
    { movementTokensForRoll },
  );
  if (!applied) return null;
  const powerups = state.powerups!;
  const inventory = powerups.loadouts[player].powerups;
  const inventoryIndex = inventory.findIndex(
    (candidate) => candidate.instanceId === activation.instanceId,
  );
  if (inventoryIndex >= 0) {
    inventory.splice(inventoryIndex, 1);
    recordPowerupUse(powerups, player, config);
  } else commitConfiguredAfterRoll(instance.abilityId, state, player, config);

  const modifier: DiceModifier = {
    instanceId: activation.instanceId,
    abilityId: instance.abilityId,
    source: player,
    dieIndex: target.index,
    before: applied.before,
    after: applied.after,
    randomResults: [...randomValues],
    ...(activation.option ? { option: activation.option } : {}),
    allowBearingOff: applied.allowBearingOff,
  };
  state.diceModifiers.push(modifier);
  return modifier;
}

function rollAbilityInstance(
  state: GameState,
  player: Player,
  activation: AbilityActivation,
  config: ResolvedVariantConfig,
): RollAbilityInstance | null {
  const option = rollAbilityOptions(state, player, activation.instanceId, config).find(
    (candidate) =>
      candidate.target.index ===
        (activation.target.type === 'DIE' ? activation.target.index : -1) &&
      candidate.option === activation.option,
  );
  if (!option) return null;
  const loadout = state.powerups!.loadouts[player];
  const instance = [...loadout.powerups, ...loadout.passives].find(
    (candidate) => candidate.instanceId === activation.instanceId,
  );
  return instance && hasAfterRollAbilityBehavior(instance.abilityId)
    ? (instance as RollAbilityInstance)
    : null;
}
