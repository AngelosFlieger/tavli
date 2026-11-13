import * as THREE from 'three';
import { applyMove, type GameState, type Move, type Position } from '../game/engine';
import type { PickupSelection, PickupView } from '../app/pickup-selection';
import type { CheckerSpot } from './board-presentation';
import type { MovePreview } from './move-preview';

export type BoardInputIntent =
  | { type: 'pickUp'; point: number }
  | { type: 'releaseLast' }
  | { type: 'clear' }
  | { type: 'place'; sequence: Move[] };

type BoardInputOptions = {
  root: THREE.Group;
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  hitTargets: THREE.Mesh[];
  markers: THREE.Mesh[];
  preview: MovePreview;
  pickup: Pick<PickupSelection, 'items' | 'sequences' | 'refresh'>;
  spots: (position: Position) => Map<number, CheckerSpot>;
  state: () => GameState;
  locked: () => boolean;
  mine: () => boolean;
  onIntent: (intent: BoardInputIntent) => void;
};

/** Turns board pointer gestures into pickup, release, and placement intents. */
export function createBoardInput({
  root,
  camera,
  canvas,
  hitTargets,
  markers,
  preview,
  pickup,
  spots,
  state,
  locked,
  mine,
  onIntent,
}: BoardInputOptions) {
  let view: PickupView = { queue: [], pickable: Array(24).fill(null), sequences: [] };
  let hovered: number | undefined;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function canInteract() {
    return state().phase === 'WAITING_FOR_MOVE' && mine() && !locked();
  }

  function selectedSequences() {
    return pickup.sequences(state(), locked());
  }

  function refresh() {
    const current = state();
    view = pickup.refresh(current, canInteract(), locked());
    preview.select(view.queue);
    if (view.queue.length) preview.followPointer(pointer);
    if (!view.queue.length && canvas.style.cursor === 'none') canvas.style.cursor = 'default';
    return view;
  }

  function hit(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    root.updateMatrixWorld(true);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(hitTargets, false)[0]?.object.userData.point as
      | number
      | undefined;
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!canInteract()) return;
    const point = hit(event);
    if (point === undefined) {
      onIntent({ type: 'clear' });
      return;
    }
    const destinations = selectedSequences().filter((sequence) => sequence.at(-1)!.to === point);
    if (destinations.length && !event.shiftKey) {
      onIntent({ type: 'place', sequence: destinations[0] });
      return;
    }
    const checker = view.pickable[point];
    if (checker !== null) {
      onIntent({ type: 'pickUp', point });
      return;
    }
    const last = pickup.items.at(-1);
    if (last !== undefined && state().board[point].includes(last))
      onIntent({ type: 'releaseLast' });
  });

  canvas.addEventListener('pointermove', (event) => {
    const point = canInteract() ? hit(event) : undefined;
    const legal =
      point !== undefined &&
      (view.pickable[point] !== null ||
        selectedSequences().some((sequence) => sequence.at(-1)!.to === point));
    canvas.style.cursor = pickup.items.length ? 'none' : legal ? 'pointer' : 'default';
    if (pickup.items.length) {
      preview.followPointer(pointer);
      const sequence = selectedSequences().find((candidate) => candidate.at(-1)!.to === point);
      if (sequence) {
        let position: Position = { board: state().board, off: state().off };
        for (const move of sequence) position = applyMove(position, state().active!, move);
        preview.showLanding(spots(position).get(pickup.items[0])?.at ?? null);
      } else preview.showLanding(null);
    }
    if (hovered !== undefined) markers[hovered].scale.setScalar(1);
    hovered = legal ? point : undefined;
    if (hovered !== undefined) markers[hovered].scale.setScalar(1.16);
  });

  canvas.addEventListener('pointerleave', () => {
    if (hovered !== undefined) markers[hovered].scale.setScalar(1);
    hovered = undefined;
    canvas.style.cursor = 'default';
    preview.hidePointer();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !pickup.items.length) return;
    onIntent({ type: 'clear' });
  });

  return { refresh };
}
