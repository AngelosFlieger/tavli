import type { Player } from '../../rules/position';
import type { GameState } from '../../session/state';
import {
  applyConfiguredBeforeRoll,
  configuredBeforeRollTargets,
  hasBeforeRollAbilityBehavior,
  type BeforeRollAbilityId,
} from '../abilities/behavior-registry';
import { abilityRegistry } from '../abilities/registry';
import { canUsePowerup, recordPowerupUse } from '../passives/policy';
import type {
  AbilityActivation,
  AbilityTarget,
  ActiveEffect,
  ResolvedVariantConfig,
} from '../types';

export type BeforeRollAbilityResult = {
  abilityId: BeforeRollAbilityId;
  removed: ActiveEffect[];
};

export function beforeRollAbilityTargets(
  state: GameState,
  player: Player,
  instanceId: string,
  config: ResolvedVariantConfig,
): AbilityTarget[] {
  const powerups = state.powerups;
  if (
    state.phase !== 'WAITING_FOR_ROLL' ||
    state.opening ||
    state.active !== player ||
    !powerups ||
    !canUsePowerup(powerups, player, config)
  )
    return [];
  const instance = powerups.loadouts[player].powerups.find(
    (candidate) => candidate.instanceId === instanceId,
  );
  if (
    !instance ||
    abilityRegistry[instance.abilityId].timing !== 'BEFORE_ROLL' ||
    !hasBeforeRollAbilityBehavior(instance.abilityId)
  )
    return [];
  return configuredBeforeRollTargets(instance.abilityId, state, player, config);
}

export function activateBeforeRollAbility(
  state: GameState,
  player: Player,
  activation: AbilityActivation,
  config: ResolvedVariantConfig,
): BeforeRollAbilityResult | null {
  const powerups = state.powerups;
  if (!powerups || !canUsePowerup(powerups, player, config)) return null;
  const inventory = powerups.loadouts[player].powerups;
  const index = inventory.findIndex((instance) => instance.instanceId === activation.instanceId);
  const instance = inventory[index];
  if (!instance || !hasBeforeRollAbilityBehavior(instance.abilityId)) return null;
  const legal = beforeRollAbilityTargets(state, player, activation.instanceId, config).some(
    (target) => sameTarget(target, activation.target),
  );
  if (!legal) return null;
  const removed = applyConfiguredBeforeRoll(
    instance.abilityId,
    state,
    player,
    activation.target,
    config,
  );
  if (!removed.length) return null;
  inventory.splice(index, 1);
  recordPowerupUse(powerups, player, config);
  return { abilityId: instance.abilityId, removed };
}

function sameTarget(left: AbilityTarget, right: AbilityTarget): boolean {
  return left.type === 'EFFECT' && right.type === 'EFFECT' && left.instanceId === right.instanceId;
}
