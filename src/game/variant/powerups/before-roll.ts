import type { Player } from '../../rules/position';
import type { GameState } from '../../session/state';
import { abilityRegistry } from '../abilities/registry';
import { canUsePowerup, recordPowerupUse } from '../passives/policy';
import type {
  AbilityActivation,
  AbilityId,
  AbilityTarget,
  ActiveEffect,
  ClearSkiesConfig,
  ResolvedVariantConfig,
} from '../types';

export type BeforeRollAbilityResult = {
  abilityId: 'clearSkies';
  removed: ActiveEffect[];
};

type BeforeRollHandler = {
  targets: (state: GameState, player: Player, config: ResolvedVariantConfig) => AbilityTarget[];
  apply: (
    state: GameState,
    player: Player,
    target: AbilityTarget,
    config: ResolvedVariantConfig,
  ) => ActiveEffect[];
};

const handlers: Partial<Record<AbilityId, BeforeRollHandler>> = {
  clearSkies: {
    targets(state, player, config) {
      return removableEffects(state, player, config.abilities.clearSkies).map((effect) => ({
        type: 'EFFECT',
        instanceId: effect.instanceId,
      }));
    },
    apply(state, player, target, config) {
      if (target.type !== 'EFFECT') return [];
      const eligible = removableEffects(state, player, config.abilities.clearSkies);
      const selected = eligible.find((effect) => effect.instanceId === target.instanceId);
      if (!selected) return [];
      const removed = [selected, ...eligible.filter((effect) => effect !== selected)].slice(
        0,
        config.abilities.clearSkies.maxEffects,
      );
      const removedIds = new Set(removed.map((effect) => effect.instanceId));
      state.powerups!.activeEffects = state.powerups!.activeEffects.filter(
        (effect) => !removedIds.has(effect.instanceId),
      );
      return removed;
    },
  },
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
  if (!instance || abilityRegistry[instance.abilityId].timing !== 'BEFORE_ROLL') return [];
  return handlers[instance.abilityId]?.targets(state, player, config) ?? [];
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
  if (!instance || instance.abilityId !== 'clearSkies') return null;
  const legal = beforeRollAbilityTargets(state, player, activation.instanceId, config).some(
    (target) => sameTarget(target, activation.target),
  );
  if (!legal) return null;
  const removed = handlers.clearSkies!.apply(state, player, activation.target, config);
  if (!removed.length) return null;
  inventory.splice(index, 1);
  recordPowerupUse(powerups, player, config);
  return { abilityId: 'clearSkies', removed };
}

function removableEffects(
  state: GameState,
  player: Player,
  config: ClearSkiesConfig,
): ActiveEffect[] {
  return (state.powerups?.activeEffects ?? []).filter((effect) => {
    if (effect.source === player) return false;
    const matchedTags = effect.tags.filter((tag) => config.removableTags.includes(tag));
    const hostile =
      effect.affectedPlayer === player && matchedTags.some((tag) => tag !== 'PROTECTION');
    const opponentPositive = config.canTargetOpponentPositive && matchedTags.includes('PROTECTION');
    return hostile || opponentPositive;
  });
}

function sameTarget(left: AbilityTarget, right: AbilityTarget): boolean {
  return left.type === 'EFFECT' && right.type === 'EFFECT' && left.instanceId === right.instanceId;
}
