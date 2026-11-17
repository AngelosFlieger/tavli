import { POWERUPS_V1, POWERUPS_V1_ID } from '../game/variant/config/profiles';
import { CLASSIC_SELECTION, type MatchSelection } from '../net/messages';
import { t } from './i18n';
import { followScene } from './music';
import type { PlaytestTools } from './playtest-tools';
import type { Session } from './session';

export type TitleScreen = {
  enterTable: () => void;
  showTitle: () => void;
  setSearching: (on: boolean) => void;
  showNote: (text: string | null) => void;
  showRoom: (code: string) => void;
  enablePlay: () => void;
  /** The typed selection the player chose; local play may use its development profile. */
  selectedMatch: (localPlaytest?: boolean) => MatchSelection;
  isSearching: () => boolean;
};

/**
 * Owns the start menu: ruleset choice, local/multiplayer/private-room entry, the room code panel,
 * and the matchmaking state that swaps the menu for the waiting screen. It reads the playtest
 * tools only for a local launch; online selections always use the public profile.
 */
export function createTitleScreen(session: Session, playtest: PlaytestTools): TitleScreen {
  const localButton = document.querySelector<HTMLButtonElement>('#start-local')!;
  const multiplayerButton = document.querySelector<HTMLButtonElement>('#start-multiplayer')!;
  const matchLabel = document.querySelector<HTMLElement>('#multiplayer-label')!;
  const matchNote = document.querySelector<HTMLElement>('#match-note')!;
  const startScreen = document.querySelector<HTMLElement>('#start-screen')!;
  const rulesetPicker = document.querySelector<HTMLFieldSetElement>('#ruleset-picker')!;
  const rulesetInputs = Array.from(
    rulesetPicker.querySelectorAll<HTMLInputElement>('input[name="ruleset"]'),
  );
  const waitingRuleset = document.querySelector<HTMLElement>('#waiting-ruleset')!;
  const roomButton = document.querySelector<HTMLButtonElement>('#start-room')!;
  const roomPanel = document.querySelector<HTMLElement>('#room-panel')!;
  const roomCreate = document.querySelector<HTMLButtonElement>('#room-create')!;
  const roomJoin = document.querySelector<HTMLButtonElement>('#room-join')!;
  const roomCode = document.querySelector<HTMLInputElement>('#room-code')!;
  const roomStatus = document.querySelector<HTMLElement>('#room-status')!;
  const roomCancel = document.querySelector<HTMLButtonElement>('#room-cancel')!;
  let playEnabled = false;
  let searching = false;

  rulesetInputs.forEach((input) => input.addEventListener('change', updateRulesetCopy));
  updateRulesetCopy();

  localButton.addEventListener('click', () => {
    showNote(null);
    session.onLocal(selectedMatch(true), playtest.seed());
    enterTable();
  });
  multiplayerButton.addEventListener('click', () => {
    // Re-trigger the press animation even when the player searches again immediately.
    multiplayerButton.classList.remove('mode-pressed');
    void multiplayerButton.offsetWidth;
    multiplayerButton.classList.add('mode-pressed');
    session.onMultiplayer(selectedMatch());
  });
  multiplayerButton.addEventListener('animationend', () =>
    multiplayerButton.classList.remove('mode-pressed'),
  );

  roomButton.addEventListener('click', () => {
    roomPanel.hidden = !roomPanel.hidden;
  });
  roomCreate.addEventListener('click', () => {
    roomPanel.hidden = true;
    session.onCreateRoom(selectedMatch());
  });
  roomJoin.addEventListener('click', () => {
    const code = roomCode.value.trim().toUpperCase();
    if (!code) return;
    roomPanel.hidden = true;
    session.onJoinRoom(code);
  });
  roomCode.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') roomJoin.click();
  });
  roomCancel.addEventListener('click', () => {
    roomStatus.hidden = true;
    roomCancel.hidden = true;
    roomPanel.hidden = true;
    session.onMultiplayer(selectedMatch());
  });

  document.querySelector('#waiting-cancel')!.addEventListener('click', () => {
    if (searching) session.onMultiplayer(selectedMatch());
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !searching) return;
    if (document.querySelector<HTMLDialogElement>('#overlay')?.open) return;
    session.onMultiplayer(selectedMatch());
  });

  function enterTable() {
    document.body.classList.remove('on-title', 'is-waiting');
    document.querySelector<HTMLElement>('#waiting-screen')!.hidden = true;
    startScreen.hidden = true;
    roomPanel.hidden = true;
    window.dispatchEvent(new Event('resize'));
    document.querySelector<HTMLButtonElement>('#roll')!.focus();
    followScene('game');
  }

  function showTitle() {
    document.body.classList.add('on-title');
    document.body.classList.remove('is-waiting');
    document.querySelector<HTMLElement>('#waiting-screen')!.hidden = true;
    startScreen.hidden = false;
    roomPanel.hidden = true;
    roomStatus.hidden = true;
    roomCancel.hidden = true;
    window.dispatchEvent(new Event('resize'));
    followScene('title');
  }

  function setSearching(on: boolean) {
    searching = on;
    document.body.classList.toggle('is-waiting', on);
    document.querySelector<HTMLElement>('#waiting-screen')!.hidden = !on;
    startScreen.hidden = on || !document.body.classList.contains('on-title');
    window.dispatchEvent(new Event('resize'));
    if (on) document.querySelector<HTMLButtonElement>('#waiting-cancel')!.focus();
    else if (document.body.classList.contains('on-title')) multiplayerButton.focus();
    matchLabel.textContent = on ? t('menu.searching') : t('menu.multiplayer');
    multiplayerButton.setAttribute('aria-pressed', String(on));
    localButton.disabled = on || !playEnabled;
    roomButton.disabled = on || !playEnabled;
    rulesetPicker.disabled = on;
    if (on) roomPanel.hidden = true;
  }

  function showNote(text: string | null) {
    matchNote.hidden = !text;
    matchNote.textContent = text ?? '';
  }

  function showRoom(code: string) {
    roomStatus.hidden = false;
    roomCancel.hidden = false;
    roomPanel.hidden = false;
    roomStatus.textContent = t('room.created', { code });
  }

  function enablePlay() {
    playEnabled = true;
    if (!searching) localButton.disabled = false;
    multiplayerButton.disabled = false;
    roomButton.disabled = false;
  }

  function selectedMatch(localPlaytest = false): MatchSelection {
    return rulesetInputs.some((input) => input.checked && input.value === 'POWERUPS_V1')
      ? {
          ruleset: 'POWERUPS_V1',
          profileId: (localPlaytest && playtest.profileId()) || POWERUPS_V1_ID,
        }
      : CLASSIC_SELECTION;
  }

  function updateRulesetCopy() {
    const selection = selectedMatch();
    const powerups = selection.ruleset === 'POWERUPS_V1';
    waitingRuleset.textContent = powerups
      ? `Powerups · ${POWERUPS_V1.id} v${POWERUPS_V1.version}`
      : t('menu.classic.matchmaking');
    document.body.dataset.ruleset = selection.ruleset;
  }

  return {
    enterTable,
    showTitle,
    setSearching,
    showNote,
    showRoom,
    enablePlay,
    selectedMatch,
    isSearching: () => searching,
  };
}
