import { clearHistory } from '../app/history';
import { sameOrigin } from '../net/account';
import { downloadJson } from './download';
import { matchHistoryMarkup, renderMatchHistory } from './history-list';
import { getLocale, setLocale, t, translateDOM, type Locale } from './i18n';
import { syncMusic } from './music';
import type { OverlayPanel } from './overlay';
import { playtestAnalysisMarkup, wirePlaytestAnalysis } from './playtest-analysis-panel';
import type { PlaytestTools } from './playtest-tools';
import { applyMotionClass, preferences, savePreferences, type PreferenceKey } from './preferences';
import type { Session } from './session';

type SettingsDeps = {
  session: Pick<
    Session,
    'canNewGame' | 'onNewGame' | 'onExitGame' | 'onSignOut' | 'playtestReport'
  >;
  isSearching: () => boolean;
  isPowerups: () => boolean;
  playtest: PlaytestTools;
};

export type SettingsPanel = OverlayPanel & {
  /** Keep the restart button in step with match state while the dialog is open. */
  sync: () => void;
};

/**
 * Owns the Settings dialog: motion/texture/sound/history preferences, language switching, the
 * restart and table-exit controls, and the development-only playtest sections. The saved-match list
 * and playtest analysis live in their own modules; this panel composes and wires them.
 */
export function createSettingsPanel({
  session,
  isSearching,
  isPowerups,
  playtest,
}: SettingsDeps): SettingsPanel {
  function markup(): string {
    const languageOptions = (['en', 'el'] as Locale[])
      .map(
        (locale) =>
          `<option value="${locale}"${getLocale() === locale ? ' selected' : ''}>${locale === 'en' ? 'English' : 'Ελληνικά'}</option>`,
      )
      .join('');
    return `<p class="eyebrow">${t('settings.eyebrow')}</p><h2>${t('settings.title')}</h2><label>${t('settings.motion')} <input type="checkbox" data-pref="motion"></label><label>${t('settings.texture')} <input type="checkbox" data-pref="texture"></label><label>${t('settings.sound')} <input type="checkbox" data-pref="sound"></label><label>${t('settings.language')} <select id="language-select">${languageOptions}</select></label><label>${t('settings.history.save')} <input type="checkbox" data-pref="history"></label><p class="note">${t('settings.note')}</p><div class="match-controls"><button type="button" id="new-game">${t('settings.newGame')}</button><button type="button" id="exit-game">${t('settings.exitGame')}</button>${import.meta.env.DEV ? `<button type="button" id="download-playtest">${t('settings.downloadPlaytest')}</button>` : ''}<button type="button" id="sign-out">${t('settings.signOut')}</button></div>${playtest.markup(isPowerups())}${matchHistoryMarkup()}${playtestAnalysisMarkup()}`;
  }

  function wire(root: HTMLElement, dialog: HTMLDialogElement): void {
    root.querySelectorAll<HTMLInputElement>('[data-pref]').forEach((input) => {
      const key = input.dataset.pref as PreferenceKey;
      input.checked = preferences[key];
      input.addEventListener('change', () => {
        preferences[key] = input.checked;
        savePreferences();
        if (key === 'motion') applyMotionClass();
        if (key === 'sound') syncMusic();
      });
    });
    const language = root.querySelector<HTMLSelectElement>('#language-select');
    language?.addEventListener('change', () => {
      setLocale(language.value as Locale);
      translateDOM();
      root.innerHTML = markup();
      wire(root, dialog);
    });
    renderMatchHistory(root);
    root.querySelector<HTMLButtonElement>('#clear-history')?.addEventListener('click', () => {
      clearHistory();
      renderMatchHistory(root);
    });
    root.querySelector<HTMLButtonElement>('#clear-all-data')?.addEventListener('click', () => {
      clearHistory();
      preferences.motion = true;
      preferences.texture = true;
      preferences.sound = true;
      preferences.history = true;
      savePreferences();
      setLocale('en');
      translateDOM();
      root.innerHTML = markup();
      wire(root, dialog);
    });
    const restart = root.querySelector<HTMLButtonElement>('#new-game')!;
    restart.disabled = isSearching() || !session.canNewGame();
    restart.addEventListener('click', () => {
      if (isSearching() || !session.canNewGame()) return;
      session.onNewGame();
      dialog.close();
    });
    const exit = root.querySelector<HTMLButtonElement>('#exit-game')!;
    // There is no table to leave from the title screen.
    exit.hidden = document.body.classList.contains('on-title');
    exit.addEventListener('click', () => {
      session.onExitGame();
      dialog.close();
    });
    const signOut = root.querySelector<HTMLButtonElement>('#sign-out')!;
    if (!sameOrigin()) signOut.hidden = true;
    else
      signOut.addEventListener('click', () => {
        session.onSignOut();
        dialog.close();
      });
    const download = root.querySelector<HTMLButtonElement>('#download-playtest');
    if (download) {
      download.disabled = session.playtestReport() === null;
      download.addEventListener('click', () => {
        const report = session.playtestReport();
        if (!report) return;
        downloadJson(`plakoto-playtest-${report.seed}.json`, report);
      });
    }
    playtest.wire(root);
    wirePlaytestAnalysis(root);
  }

  return {
    markup,
    wire,
    sync() {
      const restart = document.querySelector<HTMLButtonElement>('#new-game');
      if (restart) restart.disabled = isSearching() || !session.canNewGame();
    },
  };
}
