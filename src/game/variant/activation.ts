import type { Player } from '../rules/position';
import { abilityRegistry } from './abilities/registry';
import {
  activeEffectIsValid,
  configuredEndTurnTargets,
  createConfiguredEndTurnEffect,
  hasEndTurnAbilityBehavior,
} from './abilities/behavior-registry';
import type { GameState } from '../session/state';
import type {
  AbilityActivation,
  AbilityTarget,
  ActiveEffect,
  ResolvedVariantConfig,
} from './types';
import { canUsePowerup, recordPowerupUse } from './passives/policy';

export function endTurnAbilityTargets(
  state: GameState,
  player: Player,
  instanceId: string,
  config: ResolvedVariantConfig,
): AbilityTarget[] {
  if (state.phase !== 'TURN_COMPLETE' || state.active !== player || !state.powerups) return [];

  const instance = state.powerups.loadouts[player].powerups.find(
    (candidate) => candidate.instanceId === instanceId,
  );

  if (
    !instance ||
    abilityRegistry[instance.abilityId].timing !== 'WITH_END_TURN' ||
    !hasEndTurnAbilityBehavior(instance.abilityId)
  )
    return [];

  return configuredEndTurnTargets(instance.abilityId, state, player, config).filter(
    (target) =>
      !state.powerups!.activeEffects.some(
        (effect) =>
          effect.abilityId === instance.abilityId &&
          effect.source === player &&
          sameTarget(effect.target, target),
      ),
  );
}

export function activateEndTurnAbility(
  state: GameState,
  player: Player,
  activation: AbilityActivation,
  config: ResolvedVariantConfig,
): ActiveEffect | null {
  const powerups = state.powerups;

  if (!powerups || !canUsePowerup(powerups, player, config)) return null;

  const inventory = powerups.loadouts[player].powerups;
  const index = inventory.findIndex((instance) => instance.instanceId === activation.instanceId);
  const instance = inventory[index];

  if (!instance) return null;
  if (
    !hasEndTurnAbilityBehavior(instance.abilityId) ||
    !endTurnAbilityTargets(state, player, activation.instanceId, config).some((target) =>
      sameTarget(target, activation.target),
    )
  )
    return null;

  const effect: ActiveEffect = {
    instanceId: activation.instanceId,
    ...createConfiguredEndTurnEffect(instance.abilityId, state, activation, player, config),
  };

  inventory.splice(index, 1);
  powerups.activeEffects.push(effect);
  recordPowerupUse(powerups, player, config);

  return effect;
}

export function expireTargetTurnEffects(state: GameState, player: Player): ActiveEffect[] {
  const powerups = state.powerups;

  if (!powerups) return [];

  const expired: ActiveEffect[] = [];

  powerups.activeEffects = powerups.activeEffects.filter((effect) => {
    if (effect.duration.boundary !== 'TARGET_TURN_END' || effect.affectedPlayer !== player)
      return true;

    effect.remaining--;

    if (effect.remaining > 0) return true;

    expired.push(effect);

    return false;
  });

  return expired;
}

export function expireNextDraftEffects(state: GameState): ActiveEffect[] {
  const powerups = state.powerups;

  if (!powerups) return [];

  const expired: ActiveEffect[] = [];

  powerups.activeEffects = powerups.activeEffects.filter((effect) => {
    if (effect.duration.boundary !== 'NEXT_DRAFT') return true;

    effect.remaining--;

    if (effect.remaining > 0) return true;

    expired.push(effect);

    return false;
  });

  return expired;
}

export function pruneInvalidEffects(state: GameState): ActiveEffect[] {
  const powerups = state.powerups;

  if (!powerups) return [];

  const expired: ActiveEffect[] = [];

  powerups.activeEffects = powerups.activeEffects.filter((effect) => {
    if (activeEffectIsValid(state, effect)) return true;

    expired.push(effect);

    return false;
  });

  return expired;
}

function sameTarget(left: AbilityTarget, right: AbilityTarget): boolean {
  if (left.type !== right.type) return false;
  switch (left.type) {
    case 'PLAYER':
      return right.type === 'PLAYER' && left.player === right.player;
    case 'POINT':
      return right.type === 'POINT' && left.point === right.point;
    case 'CHECKER':
      return right.type === 'CHECKER' && left.checker === right.checker;
    case 'DIE':
      return right.type === 'DIE' && left.index === right.index;
    case 'EFFECT':
      return right.type === 'EFFECT' && left.instanceId === right.instanceId;
  }
}
