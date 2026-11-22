import { abilityRegistry } from '../../game/variant/abilities/registry';
import type { AbilityId, ResolvedVariantConfig } from '../../game/variant/types';
import { t } from '../i18n';
import { localizedAbilityCopy } from './copy';

export function createAbilityCardContent(
  abilityId: AbilityId,
  config: ResolvedVariantConfig,
  mode: 'DRAFT' | 'FOCUS',
): DocumentFragment {
  const copy = localizedAbilityCopy(abilityId, config);
  const kind = document.createElement(mode === 'DRAFT' ? 'span' : 'small');

  if (mode === 'DRAFT') kind.className = 'draft-card-kind';

  kind.textContent =
    mode === 'DRAFT'
      ? abilityRegistry[abilityId].kind === 'POWERUP'
        ? t('ability.powerupExpendable')
        : t('ability.passive')
      : abilityRegistry[abilityId].kind === 'POWERUP'
        ? t('ability.expendablePower')
        : t('ability.passive');

  const name = document.createElement('strong');

  name.textContent = copy.name;

  const summary = document.createElement(mode === 'DRAFT' ? 'span' : 'p');

  if (mode === 'DRAFT') summary.className = 'draft-card-summary';

  summary.textContent = copy.summary;

  const fragment = document.createDocumentFragment();

  fragment.append(kind, name, summary);

  if (copy.benefit) fragment.append(abilityDetail(t('ability.benefit'), copy.benefit));
  if (copy.drawback) fragment.append(abilityDetail(t('ability.drawback'), copy.drawback));

  return fragment;
}

export function abilityTooltip(abilityId: AbilityId, config: ResolvedVariantConfig): string {
  const copy = localizedAbilityCopy(abilityId, config);

  return [
    copy.summary,
    ...(copy.benefit ? [`${t('ability.benefit')}: ${copy.benefit}`] : []),
    ...(copy.drawback ? [`${t('ability.drawback')}: ${copy.drawback}`] : []),
  ].join(' ');
}

function abilityDetail(label: string, value: string): HTMLElement {
  const row = document.createElement('span');

  row.className = `draft-card-detail ${label.toLowerCase()}`;
  row.textContent = `${label}: ${value}`;

  return row;
}
