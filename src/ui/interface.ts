import { portrait } from './portraits';
const stored = (() => {
  try {
    return JSON.parse(localStorage.getItem('plakoto-preferences') || '{}');
  } catch {
    return {};
  }
})();
export const preferences = {
  motion: stored.motion ?? true,
  texture: stored.texture ?? true,
  sound: stored.sound ?? false,
};
document.querySelector('#portrait1')!.innerHTML = portrait(false);
document.querySelector('#portrait2')!.innerHTML = portrait(true);
const dialog = document.querySelector<HTMLDialogElement>('#overlay')!;
const content = document.querySelector<HTMLElement>('#overlay-content')!;
const screens = {
  help: `<p class="eyebrow">THE ART OF THE PIN</p><h2>How to play</h2><p>Plakoto is a backgammon variant for two players, with 15 checkers each. Players travel in opposite directions toward their home boards, then bear off. First to bear off all 15 wins.</p><p>A lone opposing checker can be pinned beneath yours. It stays pinned until your checker leaves. Points occupied by two opposing checkers, or an opposing checker pinning yours, are blocked.</p><p>To start, Player 1 rolls both dice, then Player 2. The higher total starts; ties repeat. The starter rolls again for their first turn.</p><p>Use both dice where possible; doubles give four moves. Click a checker, then a highlighted destination. You may combine dice if an intermediate landing is legal. Undo reverts a move until End Turn.</p><p>Bear off only when all remaining checkers are home and none are pinned. Pinning the last checker on the opponent’s starting point wins when your own starting checkers have left. Two pinned mothers mean a draw.</p>`,
  settings: `<p class="eyebrow">MAKE YOURSELF AT HOME</p><h2>Settings</h2><label>Ambient motion <input type="checkbox" data-pref="motion"></label><label>Retro grain & scanlines <input type="checkbox" data-pref="texture"></label><label>Button sound <input type="checkbox" data-pref="sound"></label><p class="note">Preferences are saved on this device. Motion also respects your system’s reduced-motion preference.</p>`,
};
let opener: HTMLElement | null = null;
document.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((button) =>
  button.addEventListener('click', () => {
    opener = button;
    content.innerHTML = screens[button.dataset.open as keyof typeof screens];
    dialog.showModal();
    content.querySelectorAll<HTMLInputElement>('[data-pref]').forEach((input) => {
      const key = input.dataset.pref as keyof typeof preferences;
      input.checked = preferences[key];
      input.onchange = () => {
        preferences[key] = input.checked;
        try {
          localStorage.setItem('plakoto-preferences', JSON.stringify(preferences));
        } catch {}
        document.body.classList.toggle('still', !preferences.motion);
      };
    });
  }),
);
document.querySelector('.close')!.addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      dialog.close();
  }
});
dialog.addEventListener('close', () => opener?.focus());
document.body.classList.toggle('still', !preferences.motion);
let audio: AudioContext | undefined;
const roll = document.querySelector<HTMLButtonElement>('#roll')!;
roll.addEventListener('click', () => {
  roll.classList.remove('bounce');
  void roll.offsetWidth;
  roll.classList.add('bounce');
  if (preferences.sound) {
    audio ??= new AudioContext();
    void audio.resume();
    const oscillator = audio.createOscillator(),
      gain = audio.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(180, audio.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(85, audio.currentTime + 0.08);
    gain.gain.setValueAtTime(0.05, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.1);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.11);
  }
});
