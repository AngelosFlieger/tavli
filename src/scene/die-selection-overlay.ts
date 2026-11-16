import * as THREE from 'three';

export type DieIndex = 0 | 1;

/** Keeps accessible HTML controls aligned with selectable 3D dice. */
export function createDieSelectionOverlay(
  dice: readonly THREE.Object3D[],
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  callbacks: {
    selectableDice: () => DieIndex[];
    selectDie: (index: DieIndex) => void;
  },
) {
  let selectable: DieIndex[] = [];
  let hovered: DieIndex | null = null;
  const projected = new THREE.Vector3();
  const positionsLocked = dice.map(() => false);
  const targets = dice.map((_die, index) => {
    const dieIndex = index as DieIndex;
    const target = document.createElement('button');
    target.type = 'button';
    target.className = 'die-target';
    target.dataset.die = String(index);
    target.setAttribute('aria-label', `Reroll die ${index + 1}`);
    target.hidden = true;
    target.addEventListener('pointerenter', () => (hovered = dieIndex));
    target.addEventListener('pointerleave', () => (hovered = null));
    const select = () => {
      if (selectable.includes(dieIndex)) callbacks.selectDie(dieIndex);
    };
    const selectOnPress = (event: PointerEvent | MouseEvent) => {
      event.preventDefault();
      select();
    };
    target.addEventListener('pointerdown', selectOnPress);
    // Keep desktop selection reliable when assistive input does not synthesize pointer events. A
    // successful press clears eligibility, so the following mouse event cannot activate twice.
    target.addEventListener('mousedown', selectOnPress);
    target.addEventListener('click', (event) => {
      // Pointer selection happens on press so a moving projection cannot lose pointer-up.
      if (event.detail === 0) select();
    });
    document.body.append(target);
    return target;
  });

  return {
    update(rolling: boolean): DieIndex[] {
      selectable = rolling ? [] : callbacks.selectableDice();
      dice.forEach((die, index) => {
        const target = targets[index];
        target.hidden = !selectable.includes(index as DieIndex) || !die.visible;
        if (target.hidden) positionsLocked[index] = false;
        else if (!positionsLocked[index]) {
          die.getWorldPosition(projected).project(camera);
          const rect = canvas.getBoundingClientRect();
          target.style.left = `${rect.left + ((projected.x + 1) / 2) * rect.width}px`;
          target.style.top = `${rect.top + ((1 - projected.y) / 2) * rect.height}px`;
          positionsLocked[index] = true;
        }
      });
      canvas.dataset.selectableDice = selectable.join(',');
      return selectable;
    },
    hovered: () => hovered,
    invalidatePositions() {
      positionsLocked.fill(false);
    },
    reset() {
      selectable = [];
      hovered = null;
      positionsLocked.fill(false);
      targets.forEach((target) => (target.hidden = true));
      canvas.dataset.selectableDice = '';
    },
  };
}
