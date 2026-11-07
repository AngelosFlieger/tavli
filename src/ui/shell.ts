import { portrait } from './portraits';
import { loadPreferences, preferences, savePreferences, type PreferenceKey } from './preferences';

/** Callbacks filled in once the board and dice exist. */
export type Session = {
  onReset: () => void;
  onNewGame: () => void;
  canNewGame: () => boolean;
  onLocal: () => void;
  onMultiplayer: () => void;
};

let session: Session;

export function initShell(next: Session) {
  session = next;
  loadPreferences();
  applyMotionClass();
  document.querySelector('#portrait1')!.innerHTML = portrait(false);
  document.querySelector('#portrait2')!.innerHTML = portrait(true);

  const dialog = document.querySelector<HTMLDialogElement>('#overlay')!;
  const content = document.querySelector<HTMLElement>('#overlay-content')!;
  let opener: HTMLElement | null = null;

  document.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((button) =>
    button.addEventListener('click', () => {
      opener = button;
      const name = button.dataset.open;
      content.innerHTML = name === 'settings' ? settingsMarkup : helpMarkup;
      if (name === 'settings') wireSettings(content, dialog);
      dialog.showModal();
    }),
  );
  document.querySelector('.close')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    const outside =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom;
    if (outside) dialog.close();
  });
  dialog.addEventListener('close', () => opener?.focus());

  localButton = document.querySelector<HTMLButtonElement>('#start-local')!;
  multiplayerButton = document.querySelector<HTMLButtonElement>('#start-multiplayer')!;
  matchLabel = document.querySelector<HTMLElement>('#multiplayer-label')!;
  matchNote = document.querySelector<HTMLElement>('#match-note')!;
  startScreen = document.querySelector<HTMLElement>('#start-screen')!;
  localButton.addEventListener('click', () => {
    showNote(null);
    session.onLocal();
    enterTable();
  });
  multiplayerButton.addEventListener('click', () => {
    multiplayerButton.classList.remove('mode-pressed');
    void multiplayerButton.offsetWidth;
    multiplayerButton.classList.add('mode-pressed');
    session.onMultiplayer();
  });
  multiplayerButton.addEventListener('animationend', () =>
    multiplayerButton.classList.remove('mode-pressed'),
  );

  let audio: AudioContext | undefined;
  document.querySelector<HTMLButtonElement>('#roll')!.addEventListener('click', () => {
    const roll = document.querySelector<HTMLButtonElement>('#roll')!;
    roll.classList.remove('bounce');
    void roll.offsetWidth;
    roll.classList.add('bounce');
    if (!preferences.sound) return;
    audio ??= new AudioContext();
    void audio.resume();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(180, audio.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(85, audio.currentTime + 0.08);
    gain.gain.setValueAtTime(0.05, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.1);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.11);
  });
}

let localButton: HTMLButtonElement;
let multiplayerButton: HTMLButtonElement;
let matchLabel: HTMLElement;
let matchNote: HTMLElement;
let startScreen: HTMLElement;
let playEnabled = false;
let searching = false;

export function enterTable() {
  document.body.classList.remove('on-title');
  startScreen.hidden = true;
  window.dispatchEvent(new Event('resize'));
  document.querySelector<HTMLButtonElement>('#roll')!.focus();
}

export function showTitle() {
  document.body.classList.add('on-title');
  startScreen.hidden = false;
  window.dispatchEvent(new Event('resize'));
}

export function setSearching(on: boolean) {
  searching = on;
  matchLabel.textContent = on ? 'Searching…' : 'Multiplayer';
  multiplayerButton.setAttribute('aria-pressed', String(on));
  localButton.disabled = on || !playEnabled;
}

export function showNote(text: string | null) {
  matchNote.hidden = !text;
  matchNote.textContent = text ?? '';
}

export function enablePlay() {
  playEnabled = true;
  if (!searching) localButton.disabled = false;
  multiplayerButton.disabled = false;
}

export function syncShell() {
  const restart = document.querySelector<HTMLButtonElement>('#new-game');
  if (restart) restart.disabled = !session.canNewGame();
}

const helpMarkup = `<p class="eyebrow">THE ART OF THE PIN</p><h2>How to play</h2><p>Plakoto is a backgammon variant for two players, with 15 checkers each. Players travel in opposite directions toward their home boards, then bear off. First to bear off all 15 wins.</p><p>A lone opposing checker can be pinned beneath yours. It stays pinned until your checker leaves. Points occupied by two opposing checkers, or an opposing checker pinning yours, are blocked.</p><p>To start, Player 1 rolls both dice, then Player 2. The higher total starts; ties repeat. The starter rolls again for their first turn.</p><p>Use both dice where possible; doubles give four moves. Click a checker, then a highlighted destination. You may combine dice if an intermediate landing is legal. Undo reverts a move until End Turn.</p><p>Bear off only when all remaining checkers are home and none are pinned. Pinning the last checker on the opponent’s starting point wins when your own starting checkers have left. Two pinned mothers mean a draw.</p>`;

const settingsMarkup = `<p class="eyebrow">MAKE YOURSELF AT HOME</p><h2>Settings</h2><label>Ambient motion <input type="checkbox" data-pref="motion"></label><label>Retro grain & scanlines <input type="checkbox" data-pref="texture"></label><label>Button sound <input type="checkbox" data-pref="sound"></label><p class="note">Preferences are saved on this device. Motion also respects your system’s reduced-motion preference.</p><div class="match-controls"><button type="button" id="new-game">New game</button></div>`;

function applyMotionClass() {
  document.body.classList.toggle('still', !preferences.motion);
}

function wireSettings(root: HTMLElement, dialog: HTMLDialogElement) {
  root.querySelectorAll<HTMLInputElement>('[data-pref]').forEach((input) => {
    const key = input.dataset.pref as PreferenceKey;
    input.checked = preferences[key];
    input.addEventListener('change', () => {
      preferences[key] = input.checked;
      savePreferences();
      if (key === 'motion') applyMotionClass();
    });
  });
  const restart = root.querySelector<HTMLButtonElement>('#new-game')!;
  restart.disabled = !session.canNewGame();
  restart.addEventListener('click', () => {
    if (!session.canNewGame()) return;
    session.onNewGame();
    dialog.close();
  });
}
