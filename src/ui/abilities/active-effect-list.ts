import { abilityRegistry, describeConfiguredAbility } from '../../game/variant/abilities/registry';
import type {
  AbilityTarget,
  ActiveEffect,
  EffectBoundary,
  ResolvedVariantConfig,
} from '../../game/variant/types';

export function createActiveEffectList(
  effects: ActiveEffect[],
  config: ResolvedVariantConfig,
): HTMLElement | null {
  if (!effects.length) return null;
  const list = document.createElement('div');
  list.className = 'active-effect-list';
  for (const effect of effects) {
    const chip = document.createElement('span');
    chip.className = 'ability-slot active-effect';
    chip.dataset.kind = abilityRegistry[effect.abilityId].kind;
    chip.dataset.ability = effect.abilityId;
    chip.dataset.instance = effect.instanceId;
    const copy = describeConfiguredAbility(effect.abilityId, config);
    const target = describeEffectTarget(effect.target);
    const expiry = describeEffectExpiry(effect.duration.boundary, effect.remaining);
    chip.textContent = `${copy.name} · ${target} · ${effect.remaining}`;
    chip.title = `Player ${effect.source + 1}: ${copy.summary} Target ${target}; ${expiry}.`;
    list.append(chip);
  }
  return list;
}

export function describeEffectTarget(target: AbilityTarget): string {
  switch (target.type) {
    case 'PLAYER':
      return `Player ${target.player + 1}`;
    case 'POINT':
      return `P${target.point + 1}`;
    case 'CHECKER':
      return `checker ${target.checker + 1}`;
    case 'DIE':
      return `die ${target.index + 1}`;
    case 'EFFECT':
      return `effect ${target.instanceId}`;
  }
}

export function describeEffectExpiry(boundary: EffectBoundary, remaining: number): string {
  const unit =
    boundary === 'NEXT_DRAFT'
      ? 'draft boundary'
      : boundary === 'SOURCE_TURN_END'
        ? 'source turn'
        : 'target turn';
  return `${remaining} ${unit}${remaining === 1 ? '' : 's'} remaining`;
}
