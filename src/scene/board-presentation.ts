import * as THREE from 'three';
import { owner, type Position } from '../game/engine';
import { pointPosition } from '../game/points';
import type { BoardLayout } from './layout';
import { trayPosition } from './tray';

export type CheckerSpot = { at: THREE.Vector3; flat: boolean; pinned: boolean };

/** Maps a logical position to checker transforms for the current board layout. */
export function createBoardPresentation(
  center: THREE.Vector3,
  layout: BoardLayout,
  checkers: THREE.Group[],
  heights: number[],
) {
  function trayWorld(player: number, index: number, stage: 'start' | 'finish' = 'finish') {
    const tray = trayPosition(player, index, heights[player] - 0.0004, layout.depth, stage);
    return new THREE.Vector3(
      tray.x - center.x,
      tray.y - center.y,
      tray.z - center.z * layout.depth,
    );
  }

  function spots(position: Position) {
    const targets = new Map<number, CheckerSpot>();
    position.board.forEach((stack, point) => {
      const { x, z } = pointPosition(point);
      const mixed = stack.length > 1 && owner(stack[0]) !== owner(stack.at(-1)!);
      stack.forEach((id, index) => {
        // A pinned checker is always physically beneath the controller, sharing its first slot.
        const slot = mixed ? Math.max(0, index - 1) : index;
        const y =
          0.0274 +
          Math.floor(slot / layout.stackSlots) * heights[owner(id)] +
          (mixed && index > 0 ? heights[owner(stack[0])] : 0);
        targets.set(id, {
          at: new THREE.Vector3(
            x - center.x,
            y - center.y,
            (z - center.z) * layout.depth +
              (point < 12 ? 1 : -1) * (slot % layout.stackSlots) * 0.0305,
          ),
          flat: false,
          pinned: mixed && index === 0,
        });
      });
    });
    position.off.forEach((ids, player) =>
      ids.forEach((id, index) =>
        targets.set(id, { at: trayWorld(player, index), flat: true, pinned: false }),
      ),
    );
    return targets;
  }

  function applySpot(id: number, spot: CheckerSpot) {
    checkers[id].userData.off = spot.flat;
    checkers[id].userData.pinned = spot.pinned;
    checkers[id].scale.setScalar(spot.pinned ? 1.06 : 1);
  }

  function sync(position: Position) {
    for (const [id, spot] of spots(position)) {
      applySpot(id, spot);
      checkers[id].position.copy(spot.at);
      checkers[id].rotation.set(spot.flat ? Math.PI / 2 : 0, 0, 0);
    }
  }

  function deal(position: Position, elapsed: number) {
    const targets = spots(position);
    checkers.forEach((checker, id) => {
      const player = owner(id),
        index = id % 15;
      const t = Math.min(1, Math.max(0, (elapsed - 0.25 - index * 0.045) / 0.82));
      const ease = t * t * (3 - 2 * t);
      checker.position.copy(trayWorld(player, index, 'start')).lerp(targets.get(id)!.at, ease);
      checker.position.y += Math.sin(t * Math.PI) * 0.07;
      checker.rotation.set(
        ((1 - ease) * Math.PI) / 2,
        Math.sin(t * Math.PI) * (player ? -0.16 : 0.16),
        0,
      );
    });
  }

  return { spots, applySpot, sync, deal };
}
