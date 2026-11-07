import * as THREE from 'three';
import type { Body } from 'cannon-es';
import { createHomeWorld } from './home-physics';

/** Sparse decorative rigid bodies; never share state with playable checkers. */
export function createHomeFalling(models: THREE.Group[], center: THREE.Vector3, scale: number) {
  const group = new THREE.Group();
  const physics = createHomeWorld(center, scale);
  // Low gravity and air drag give the decorative fall a soft, suspended feel.
  physics.world.gravity.set(0, -2.1, 0);
  const pieces: { art: THREE.Group; body: Body; age: number; materials: THREE.Material[] }[] = [];
  let countdown = 0.6,
    sequence = 0;
  function remove(index: number) {
    const piece = pieces[index];
    physics.world.removeBody(piece.body);
    group.remove(piece.art);
    piece.materials.forEach((material) => material.dispose());
    pieces.splice(index, 1);
  }
  function spawn() {
    const model = models[sequence++ % 2].clone(true);
    const bounds = new THREE.Box3().setFromObject(model),
      size = bounds.getSize(new THREE.Vector3());
    model.position.sub(bounds.getCenter(new THREE.Vector3()));
    const art = new THREE.Group();
    art.add(model);
    art.scale.setScalar(scale);
    const materials: THREE.Material[] = [];
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const clone = (material: THREE.Material) => {
        const copy = material.clone();
        copy.transparent = true;
        materials.push(copy);
        return copy;
      };
      object.material = Array.isArray(object.material)
        ? object.material.map(clone)
        : clone(object.material);
    });
    const body = physics.checker((Math.max(size.x, size.z) * scale) / 2, size.y * scale);
    // Most land on the felt; an occasional edge throw naturally misses the table.
    const miss = sequence % 4 === 0;
    body.position.set(
      miss ? (Math.random() < 0.5 ? -5.25 : 5.25) : (Math.random() - 0.5) * 7,
      4 + Math.random() * 3,
      (Math.random() - 0.5) * 4.5,
    );
    body.velocity.set((Math.random() - 0.5) * 0.9, -0.08, (Math.random() - 0.5) * 0.6);
    body.quaternion.setFromEuler(Math.random() * 0.8, Math.random() * Math.PI, Math.random() * 0.6);
    body.angularVelocity.set(
      (Math.random() - 0.5) * 1.4,
      (Math.random() - 0.5) * 1.4,
      (Math.random() - 0.5) * 1.4,
    );
    body.linearDamping = 0.24;
    group.add(art);
    pieces.push({ art, body, age: 0, materials });
  }
  let resting = true;
  return {
    group,
    update(dt: number, active: boolean) {
      group.visible = active;
      if (!active) {
        if (resting) return;
        while (pieces.length) remove(pieces.length - 1);
        countdown = 0.6;
        resting = true;
        return;
      }
      resting = false;
      countdown -= dt;
      if (countdown <= 0) {
        // A small group enters at different heights, rather than isolated drops.
        const count = Math.min(3, 8 - pieces.length);
        for (let i = 0; i < count; i++) spawn();
        countdown = 3.5 + Math.random() * 1.5;
      }
      if (pieces.length) physics.world.step(1 / 120, Math.min(dt, 0.05), 6);
      for (let i = pieces.length - 1; i >= 0; i--) {
        const piece = pieces[i];
        piece.age += dt;
        if (piece.body.position.y < -12 || piece.age > 14) {
          remove(i);
          continue;
        }
        piece.art.position.copy(piece.body.position);
        piece.art.quaternion.copy(piece.body.quaternion);
        piece.materials.forEach((material) => {
          material.opacity = Math.min(1, (14 - piece.age) / 2);
        });
      }
    },
  };
}
