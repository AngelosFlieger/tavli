import { abilityRegistry } from '../../game/variant/abilities/registry';
import type {
  AbilityTarget,
  ActiveEffect,
  EffectBoundary,
  ResolvedVariantConfig,
} from '../../game/variant/types';
import { pluralSuffix, t } from '../i18n';
import { localizedAbilityCopy } from './copy';

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
    const copy = localizedAbilityCopy(effect.abilityId, config);
    const target = describeEffectTarget(effect.target);
    const expiry = describeEffectExpiry(effect.duration.boundary, effect.remaining);
    chip.textContent = t('ability.effectChip', {
      name: copy.name,
      target,
      remaining: effect.remaining,
    });
    chip.title = t('ability.effectTitle', {
      player: effect.source + 1,
      summary: copy.summary,
      target,
      expiry,
    });
    list.append(chip);
  }
  return list;
}

export function describeEffectTarget(target: AbilityTarget): string {
  switch (target.type) {
    case 'PLAYER':
      return t('effectTarget.player', { player: target.player + 1 });
    case 'POINT':
      return t('effectTarget.point', { point: target.point + 1 });
    case 'CHECKER':
      return t('effectTarget.checker', { checker: target.checker + 1 });
    case 'DIE':
      return t('effectTarget.die', { index: target.index + 1 });
    case 'EFFECT':
      return t('effectTarget.effect', { instanceId: target.instanceId });
  }
}

export function describeEffectExpiry(boundary: EffectBoundary, remaining: number): string {
  const unit =
    boundary === 'NEXT_DRAFT'
      ? t('ability.expiry.draft')
      : boundary === 'SOURCE_TURN_END'
        ? t('ability.expiry.source')
        : t('ability.expiry.target');
  return t('ability.expiry.remaining', {
    remaining,
    unit,
    s: pluralSuffix(remaining),
  });
}
