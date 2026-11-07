import { preferences } from './preferences';

type Scene = 'title' | 'game';

const intro = track('/audio/plakoto-intro-soundtrack.mp3', true);
const game = track('/audio/plakoto-soundtrack.mp3', true);
const click = track('/audio/plakoto-button-sound.mp3', false);

let mode: Scene = 'title';
let unlocked = false;

export function initMusic() {
  document.body.append(intro, game, click);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      intro.pause();
      game.pause();
      return;
    }
    playCurrent();
  });
}

/** Call during a click or touch so the browser will allow playback. */
export function primeMusic() {
  if (unlocked) return;
  unlocked = true;
  for (const audio of [intro, game]) {
    audio.muted = true;
    void audio
      .play()
      .then(() => {
        if (audio.muted) audio.pause();
      })
      .catch(() => {});
  }
}

/** The title stayed up after a click, so the intro may begin. */
export function nudgeMusic() {
  requestAnimationFrame(() => {
    if (mode !== 'title') return;
    stop(game);
    play(intro);
  });
}

export function followScene(scene: Scene) {
  mode = scene;
  primeMusic();
  const next = scene === 'title' ? intro : game;
  const previous = scene === 'title' ? game : intro;
  stop(previous);
  next.currentTime = 0;
  play(next);
}

export function syncMusic() {
  if (!preferences.sound) {
    intro.pause();
    game.pause();
    return;
  }
  playCurrent();
}

export function playClick() {
  if (!preferences.sound || document.hidden) return;
  click.currentTime = 0;
  void click.play().catch(() => {});
}

function playCurrent() {
  play(mode === 'title' ? intro : game);
}

function play(audio: HTMLAudioElement) {
  if (!preferences.sound || document.hidden) return;
  audio.muted = false;
  void audio.play().catch(() => {});
}

function stop(audio: HTMLAudioElement) {
  audio.pause();
  audio.currentTime = 0;
}

function track(src: string, loop: boolean) {
  const audio = new Audio(src);
  audio.loop = loop;
  audio.preload = 'auto';
  audio.hidden = true;
  audio.disableRemotePlayback = true;
  audio.setAttribute('aria-hidden', 'true');
  return audio;
}
