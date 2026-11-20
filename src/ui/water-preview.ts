import type { WaterSweep } from '../scene/water-sweep';
import { preferences } from './preferences';

/** Temporary art-preview control. It sends no gameplay or network commands. */
export function createWaterPreview(
  effect: WaterSweep,
  canvas: HTMLCanvasElement,
  reducedMotion: MediaQueryList,
) {
  const button = document.querySelector<HTMLButtonElement>('#test-water')!;
  button.disabled = false;
  canvas.dataset.water = 'idle';
  button.addEventListener('click', () => {
    effect.trigger(!reducedMotion.matches && preferences.motion);
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    canvas.dataset.water = 'playing';
  });
  return {
    update(dt: number) {
      const offTable =
        document.body.classList.contains('on-title') ||
        document.body.classList.contains('signed-out');
      if (offTable) {
        if (effect.active) effect.reset();
      } else effect.update(dt);
      if (!effect.active) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        canvas.dataset.water = 'idle';
      }
    },
  };
}
