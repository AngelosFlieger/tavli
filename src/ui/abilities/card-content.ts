import { abilityRegistry, describeConfiguredAbility } from '../../game/variant/abilities/registry';
import type { AbilityId, ResolvedVariantConfig } from '../../game/variant/types';

export function createAbilityCardContent(
  abilityId: AbilityId,
  config: ResolvedVariantConfig,
  mode: 'DRAFT' | 'FOCUS',
): DocumentFragment {
  const copy = describeConfiguredAbility(abilityId, config);
  const kind = document.createElement(mode === 'DRAFT' ? 'span' : 'small');
  if (mode === 'DRAFT') kind.className = 'draft-card-kind';
  kind.textContent =
    mode === 'DRAFT'
      ? abilityRegistry[abilityId].kind === 'POWERUP'
        ? 'Powerup · expendable'
        : 'Passive'
      : abilityRegistry[abilityId].kind === 'POWERUP'
        ? 'Expendable power'
        : 'Passive';
  const name = document.createElement('strong');
  name.textContent = copy.name;
  const summary = document.createElement(mode === 'DRAFT' ? 'span' : 'p');
  if (mode === 'DRAFT') summary.className = 'draft-card-summary';
  summary.textContent = copy.summary;
  const fragment = document.createDocumentFragment();
  fragment.append(kind, name, summary);
  if (copy.benefit) fragment.append(abilityDetail('Benefit', copy.benefit));
  if (copy.drawback) fragment.append(abilityDetail('Drawback', copy.drawback));
  return fragment;
}

export function abilityTooltip(abilityId: AbilityId, config: ResolvedVariantConfig): string {
  const copy = describeConfiguredAbility(abilityId, config);
  return [
    copy.summary,
    ...(copy.benefit ? [`Benefit: ${copy.benefit}`] : []),
    ...(copy.drawback ? [`Drawback: ${copy.drawback}`] : []),
  ].join(' ');
}

function abilityDetail(label: string, value: string): HTMLElement {
  const row = document.createElement('span');
  row.className = `draft-card-detail ${label.toLowerCase()}`;
  row.textContent = `${label}: ${value}`;
  return row;
}
