import { PATHS } from '../points';
import { other, owner, type Player } from '../rules/position';
import { abilityRegistry } from './abilities/registry';
import type { GameState } from '../session/state';
import type {
  AbilityActivation,
  AbilityId,
  AbilityTarget,
  ActiveEffect,
  ResolvedVariantConfig,
} from './types';
import { canUsePowerup, recordPowerupUse } from './passives/policy';

type EndTurnHandler = {
  targets: (state: GameState, player: Player, config: ResolvedVariantConfig) => AbilityTarget[];
  effect: (
    state: GameState,
    activation: AbilityActivation,
    player: Player,
    config: ResolvedVariantConfig,
  ) => Omit<ActiveEffect, 'instanceId'>;
};

const starts = new Set(PATHS.map((path) => path[0]));
const homes = new Set(PATHS.flatMap((path) => path.slice(18)));

const endTurnHandlers: Partial<Record<AbilityId, EndTurnHandler>> = {
  frostSeal: {
    targets(state, player, config) {
      const frost = config.abilities.frostSeal;
      const opponent = other(player);
      return state.board.flatMap((stack, point) => {
        if (!stack.length || owner(stack.at(-1)!) !== opponent) return [];
        if (!frost.allowStartPoints && starts.has(point)) return [];
        if (!frost.allowHomePoints && homes.has(point)) return [];
        if (!frost.allowPinnedStacks && stack.some((checker) => owner(checker) !== opponent))
          return [];
        return [{ type: 'POINT' as const, point }];
      });
    },
    effect(_state, activation, player, config) {
      const frost = config.abilities.frostSeal;
      return {
        abilityId: 'frostSeal',
        source: player,
        affectedPlayer: other(player),
        target: activation.target,
        tags: ['CONTROL'],
        modifiers: {
          blockLeaving: frost.blockLeaving,
          blockLanding: frost.blockLanding,
        },
        duration: frost.duration,
        remaining: frost.duration.count,
      };
    },
  },
  bastion: {
    targets(state, player, config) {
      const bastion = config.abilities.bastion;
      return state.board.flatMap((stack, point) => {
        if (
          stack.length !== bastion.requiredOwnCheckers ||
          stack.some((checker) => owner(checker) !== player)
        )
          return [];
        if (!bastion.allowStartPoints && starts.has(point)) return [];
        if (!bastion.allowHomePoints && homes.has(point)) return [];
        return [{ type: 'POINT' as const, point }];
      });
    },
    effect(state, activation, player, config) {
      const bastion = config.abilities.bastion;
      const point = activation.target.type === 'POINT' ? activation.target.point : -1;
      return {
        abilityId: 'bastion',
        source: player,
        affectedPlayer: other(player),
        target: activation.target,
        tags: ['PROTECTION'],
        modifiers: {
          blockLanding: bastion.blockLanding,
          anchorChecker: state.board[point]?.at(-1),
        },
        duration: bastion.duration,
        remaining: bastion.duration.count,
      };
    },
  },
  jinx: {
    targets(_state, player) {
      return [{ type: 'PLAYER', player: other(player) }];
    },
    effect(_state, activation, player, config) {
      const jinx = config.abilities.jinx;
      return {
        abilityId: 'jinx',
        source: player,
        affectedPlayer: other(player),
        target: activation.target,
        tags: ['DICE_PENALTY'],
        modifiers: {
          dicePenalty: {
            penalty: jinx.penalty,
            minimumToken: jinx.minimumToken,
            targetToken: jinx.targetToken,
            affectDoubles: jinx.affectDoubles,
            unaffectedDoubleConsumes: jinx.unaffectedDoubleConsumes,
            doubleHandling: jinx.doubleHandling,
          },
        },
        duration: jinx.duration,
        remaining: jinx.duration.count,
      };
    },
  },
};

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
  if (!instance || abilityRegistry[instance.abilityId].timing !== 'WITH_END_TURN') return [];
  const handler = endTurnHandlers[instance.abilityId];
  if (!handler) return [];
  return handler
    .targets(state, player, config)
    .filter(
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
  const handler = endTurnHandlers[instance.abilityId];
  if (
    !handler ||
    !endTurnAbilityTargets(state, player, activation.instanceId, config).some((target) =>
      sameTarget(target, activation.target),
    )
  )
    return null;
  const effect: ActiveEffect = {
    instanceId: activation.instanceId,
    ...handler.effect(state, activation, player, config),
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
    if (effect.target.type !== 'POINT') return true;
    const stack = state.board[effect.target.point];
    const valid =
      effect.abilityId === 'frostSeal'
        ? stack.length > 0 && owner(stack.at(-1)!) === effect.affectedPlayer
        : effect.abilityId === 'bastion'
          ? effect.modifiers.anchorChecker !== undefined &&
            stack.includes(effect.modifiers.anchorChecker)
          : true;
    if (valid) return true;
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
