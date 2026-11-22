import { abilityCopy } from '../../game/variant/abilities/catalog';
import type {
  AbilityCopy,
  AbilityCopyDescriptor,
  AbilityId,
  ResolvedVariantConfig,
  TextRef,
} from '../../game/variant/types';
import { pluralSuffix, t } from '../i18n';

/**
 * Presents variant ability copy in the active locale. Rule logic and the definitions stay in the
 * pure variant layer; definitions only supply catalog references and their parameters.
 */
export function localizedAbilityCopy(id: AbilityId, config: ResolvedVariantConfig): AbilityCopy {
  return renderCopy(abilityCopy(id, config.abilities));
}

function renderCopy(descriptor: AbilityCopyDescriptor): AbilityCopy {
  return {
    name: render(descriptor.name),
    summary: render(descriptor.summary),
    ...(descriptor.benefit ? { benefit: render(descriptor.benefit) } : {}),
    ...(descriptor.drawback ? { drawback: render(descriptor.drawback) } : {}),
  };
}

/** `count` carries the plural suffix convention the catalogs already use. */
function render(reference: TextRef): string {
  const params = reference.params ?? {};
  const count = typeof params.count === 'number' ? params.count : undefined;

  return t(reference.key, count === undefined ? params : { ...params, s: pluralSuffix(count) });
}
