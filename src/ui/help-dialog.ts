import { abilityRegistry } from '../game/variant/abilities/registry';
import { POWERUPS_V1 } from '../game/variant/config/profiles';
import { ABILITY_IDS } from '../game/variant/types';
import { localizedAbilityCopy } from './abilities/copy';
import { t } from './i18n';
import type { OverlayPanel } from './overlay';

/**
 * Rules reference. Ability names and details derive from the resolved variant definitions, so the
 * reference cannot drift from the rules the engine actually applies.
 */
export function createHelpPanel(): OverlayPanel {
  return { markup: helpMarkup };
}

function abilityHelp(): string {
  return ABILITY_IDS.map((abilityId) => {
    const copy = localizedAbilityCopy(abilityId, POWERUPS_V1);
    const kind =
      abilityRegistry[abilityId].kind === 'POWERUP'
        ? t('help.ability.powerup')
        : t('help.ability.passive');
    const details = [copy.summary, copy.benefit, copy.drawback].filter(Boolean).join(' ');
    return `<li><strong>${copy.name}</strong> <small>${kind}</small><br>${details}</li>`;
  }).join('');
}

function helpMarkup(): string {
  return `<p class="eyebrow">${t('help.eyebrow')}</p><h2>${t('help.title')}</h2><p>${t('help.intro')}</p><p>${t('help.pin')}</p><p>${t('help.opening')}</p><p>${t('help.movement')}</p><p>${t('help.bearing')}</p><h3>${t('help.powerups.title')}</h3><p>${t(
    'help.powerups.intro',
    {
      rounds: POWERUPS_V1.draft.intervalRounds,
      cards: POWERUPS_V1.draft.offer.powerups + POWERUPS_V1.draft.offer.passives,
      powerups: POWERUPS_V1.draft.offer.powerups,
      passives: POWERUPS_V1.draft.offer.passives,
      slots: POWERUPS_V1.inventory.powerupSlots,
      passiveSlots: POWERUPS_V1.inventory.passiveSlots,
      perTurn: POWERUPS_V1.inventory.powerupsPerTurn,
    },
  )}</p><ul class="ability-help">${abilityHelp()}</ul>`;
}
