import type { GameState } from '../session/state';
import type { Player } from '../rules/position';
import { abilityRegistry } from './abilities/registry';
import type {
  AbilityActivation,
  AbilityInstance,
  DiceModifier,
  ResolvedVariantConfig,
  RollAbilityOption,
} from './types';
import {
  canUsePowerup,
  movementTokensForRoll,
  opportunistFocus,
  recordPowerupUse,
  spendOpportunistFocus,
} from './passives/policy';

type RollAbilityInstance = AbilityInstance & {
  abilityId: 'recast' | 'nudge' | 'opportunist';
};

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
  if (!instance) return [];
  if (powerup) {
    if (
      !canUsePowerup(powerups, player, config) ||
      abilityRegistry[instance.abilityId].timing !== 'AFTER_ROLL_BEFORE_MOVE'
    )
      return [];
  } else if (instance.abilityId !== 'opportunist' || opportunistFocus(powerups, player) <= 0)
    return [];
  if (
    instance.abilityId === 'opportunist' &&
    state.diceModifiers.filter(
      (modifier) => modifier.abilityId === 'opportunist' && modifier.source === player,
    ).length >= config.abilities.opportunist.focusUsesPerRoll
  )
    return [];
  const availableDice = ([0, 1] as const).filter(
    (index) =>
      !state.diceModifiers.some((modifier) => modifier.dieIndex === index) &&
      state.remaining.includes(state.roll[index]),
  );
  const double = state.roll[0] === state.roll[1];
  if (instance.abilityId === 'recast') {
    const recast = config.abilities.recast;
    if (!recast.acceptResult || (recast.allowedRolls === 'NON_DOUBLE' && double)) return [];
    return availableDice.map((index) => ({ target: { type: 'DIE', index } }));
  }
  if (instance.abilityId === 'nudge') {
    const nudge = config.abilities.nudge;
    if (nudge.allowedRolls === 'NON_DOUBLE' && double) return [];
    return availableDice.flatMap((index) =>
      nudge.directions.flatMap((direction) => {
        const after =
          state.roll[index] + (direction === 'INCREASE' ? nudge.adjustment : -nudge.adjustment);
        return after >= 1 && after <= 6
          ? [{ target: { type: 'DIE' as const, index }, option: direction }]
          : [];
      }),
    );
  }
  if (instance.abilityId === 'opportunist') {
    const opportunist = config.abilities.opportunist;
    if (opportunist.allowedRolls === 'NON_DOUBLE' && double) return [];
    return availableDice.flatMap((index) =>
      opportunist.focusDirections.flatMap((direction) => {
        const after =
          state.roll[index] +
          (direction === 'INCREASE' ? opportunist.focusAdjustment : -opportunist.focusAdjustment);
        return after >= 1 && after <= 6
          ? [{ target: { type: 'DIE' as const, index }, option: direction }]
          : [];
      }),
    );
  }
  return [];
}

export function rollAbilityRandomCount(
  state: GameState,
  player: Player,
  activation: AbilityActivation,
  config: ResolvedVariantConfig,
): number | null {
  const instance = rollAbilityInstance(state, player, activation, config);
  if (!instance) return null;
  return instance.abilityId === 'recast' ? config.abilities.recast.rerollCount : 0;
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
  const expectedRandom = instance.abilityId === 'recast' ? config.abilities.recast.rerollCount : 0;
  if (
    randomValues.length !== expectedRandom ||
    randomValues.some((value) => !Number.isInteger(value) || value < 1 || value > 6)
  )
    return null;

  const powerups = state.powerups!;
  const inventory = powerups.loadouts[player].powerups;
  const before = state.roll[target.index];
  const wasDouble = state.roll[0] === state.roll[1];
  let after: number;
  let allowBearingOff = true;
  if (instance.abilityId === 'recast') {
    after = randomValues.at(-1)!;
    const recast = config.abilities.recast;
    if (wasDouble && recast.originalDoubleHandling === 'CHANGE_MATCHING_TOKENS')
      state.remaining = state.remaining.map((token) => (token === before ? after : token));
    else replaceOneToken(state.remaining, before, after);
    state.roll[target.index] = after;
    if (!wasDouble && state.roll[0] === state.roll[1] && recast.createdMatchBecomesDouble)
      state.remaining = movementTokensForRoll(state, player, [after, after], config);
  } else {
    const adjustment =
      instance.abilityId === 'nudge'
        ? config.abilities.nudge.adjustment
        : config.abilities.opportunist.focusAdjustment;
    const allowCreatedDouble =
      instance.abilityId === 'nudge'
        ? config.abilities.nudge.createdMatchBecomesDouble
        : config.abilities.opportunist.createdMatchBecomesDouble;
    const direction = activation.option!;
    after = before + (direction === 'INCREASE' ? adjustment : -adjustment);
    replaceOneToken(state.remaining, before, after);
    allowBearingOff =
      instance.abilityId === 'nudge'
        ? config.abilities.nudge.allowBearingOff
        : config.abilities.opportunist.allowBearingOff;
    if (!wasDouble && after === state.roll[target.index === 0 ? 1 : 0] && allowCreatedDouble)
      state.remaining = movementTokensForRoll(state, player, [after, after], config);
  }
  const modifier: DiceModifier = {
    instanceId: activation.instanceId,
    abilityId: instance.abilityId,
    source: player,
    dieIndex: target.index,
    before,
    after,
    randomResults: [...randomValues],
    ...(activation.option ? { option: activation.option } : {}),
    allowBearingOff,
  };
  if (instance.abilityId === 'opportunist') {
    if (!spendOpportunistFocus(powerups, player)) return null;
  } else {
    const inventoryIndex = inventory.findIndex(
      (candidate) => candidate.instanceId === activation.instanceId,
    );
    inventory.splice(inventoryIndex, 1);
    recordPowerupUse(powerups, player, config);
  }
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
  return instance?.abilityId === 'recast' ||
    instance?.abilityId === 'nudge' ||
    instance?.abilityId === 'opportunist'
    ? (instance as RollAbilityInstance)
    : null;
}

function replaceOneToken(tokens: number[], before: number, after: number): void {
  const index = tokens.indexOf(before);
  if (index < 0) throw new Error('roll ability token is missing');
  tokens[index] = after;
}
