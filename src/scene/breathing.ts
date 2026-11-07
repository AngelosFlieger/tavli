import type { Object3D } from 'three';

/** Absolute poses avoid accumulating drift when resizing or toggling motion. */
export function createBreathing(objects: Object3D[]) {
  let bases = objects.map((object) => ({
    position: object.position.clone(),
    rotation: object.rotation.clone(),
  }));
  return {
    capture() {
      bases = objects.map((object) => ({
        position: object.position.clone(),
        rotation: object.rotation.clone(),
      }));
    },
    update(elapsed: number, motion: boolean) {
      objects.forEach((object, index) => {
        const base = bases[index],
          phase = elapsed * (0.65 + index * 0.025) + index * 1.7;
        object.position.copy(base.position);
        object.rotation.copy(base.rotation);
        if (!motion) return;
        object.position.x += Math.sin(phase * 0.7) * 0.012;
        object.position.y += Math.sin(phase) * 0.018;
        object.rotation.z += Math.sin(phase * 0.8) * 0.018;
        object.rotation.y += Math.cos(phase * 0.65) * 0.025;
      });
    },
  };
}
