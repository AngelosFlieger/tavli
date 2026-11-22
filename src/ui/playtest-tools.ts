import { parseOptionalSeed } from '../game/random';
import { VARIANT_PROFILE_IDS, type VariantProfileId } from '../game/variant/config/profiles';
import { t } from './i18n';

export type PlaytestTools = {
  /** Development-only balance controls, or an empty string in production builds. */
  markup: (powerups: boolean) => string;
  /** Bind the controls rendered by `markup()`. */
  wire: (root: HTMLElement) => void;
  profileId: () => VariantProfileId;
  seed: () => number | undefined;
};

/**
 * Local balance-playtest choices. Settings renders and wires them while title play reads them, so
 * the state lives here instead of in the dialog: reopening Settings must not reset a run's seed.
 * The seed stays blank by default, which keeps fresh cryptographic randomness for ordinary games.
 */
export function createPlaytestTools(): PlaytestTools {
  let profileId: VariantProfileId = VARIANT_PROFILE_IDS[0];
  let seedValue = '';

  return {
    markup(powerups) {
      if (!import.meta.env.DEV) return '';
      const profileOptions = VARIANT_PROFILE_IDS.map(
        (id) => `<option value="${id}"${id === profileId ? ' selected' : ''}>${id}</option>`,
      ).join('');
      return `<section class="playtest-tools" aria-label="${t('playtest.aria')}"><strong>${t('playtest.title')}</strong><label>${t('playtest.profile')} <select id="playtest-profile"${powerups ? '' : ' disabled'}>${profileOptions}</select></label><label>${t('playtest.seed')} <input id="playtest-seed" type="number" min="0" max="4294967295" step="1" placeholder="${t('playtest.seedPlaceholder')}" value="${seedValue}"></label><small>${t('playtest.note')}</small></section>`;
    },
    wire(root) {
      const profile = root.querySelector<HTMLSelectElement>('#playtest-profile');
      const seed = root.querySelector<HTMLInputElement>('#playtest-seed');
      profile?.addEventListener('change', () => {
        profileId = profile.value as VariantProfileId;
      });
      seed?.addEventListener('input', () => {
        seedValue = seed.value;
      });
    },
    profileId: () => profileId,
    seed: () => parseOptionalSeed(seedValue),
  };
}
