import { createHelpPanel } from './help-dialog';
import { initMusic, nudgeMusic, playClick, primeMusic } from './music';
import { initOverlay } from './overlay';
import { createPlaytestTools } from './playtest-tools';
import { portrait } from './portraits';
import { applyMotionClass, loadPreferences } from './preferences';
import type { Session } from './session';
import { createSettingsPanel, type SettingsPanel } from './settings-dialog';
import { createTitleScreen, type TitleScreen } from './title-screen';

export type { Session } from './session';

let titleScreen: TitleScreen;
let settingsPanel: SettingsPanel;

/**
 * Composes the browser chrome. Each panel owns its markup, state, and listeners; this module binds
 * the input-sound and portrait decoration that belongs to the page as a whole, then forwards the
 * navigation calls `main.ts` makes to the panel that owns them.
 */
export function initShell(session: Session) {
  loadPreferences();
  applyMotionClass();
  initMusic();
  window.addEventListener('pointerdown', () => primeMusic(), { capture: true });
  window.addEventListener('pointerup', () => nudgeMusic(), { capture: true });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') primeMusic();
  });
  window.addEventListener('keyup', (event) => {
    if (event.key === 'Enter' || event.key === ' ') nudgeMusic();
  });
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('button')) return;
    playClick();
  });
  document.querySelector('#portrait1')!.innerHTML = portrait(false);
  document.querySelector('#portrait2')!.innerHTML = portrait(true);
  document.querySelector('#waiting-portrait')!.innerHTML = portrait(false);

  const playtest = createPlaytestTools();
  titleScreen = createTitleScreen(session, playtest);
  settingsPanel = createSettingsPanel({
    session,
    isSearching: () => titleScreen.isSearching(),
    isPowerups: () => titleScreen.selectedMatch().ruleset === 'POWERUPS_V1',
    playtest,
  });
  initOverlay({ settings: settingsPanel, help: createHelpPanel() });
}

export function enterTable() {
  titleScreen.enterTable();
}

export function showTitle() {
  titleScreen.showTitle();
}

export function setSearching(on: boolean, status?: 'CONNECTING' | 'SEARCHING') {
  titleScreen.setSearching(on, status);
}

export function showNote(text: string | null) {
  titleScreen.showNote(text);
}

export function showRoom(code: string) {
  titleScreen.showRoom(code);
}

export function enablePlay() {
  titleScreen.enablePlay();
}

export function syncShell() {
  settingsPanel.sync();
}
