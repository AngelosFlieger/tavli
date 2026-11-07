import * as THREE from 'three';
import { createBreathing } from './breathing';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';

/** Decorative copies of the original checkers, separate from the playable position. */
export function createStartScatter(models: THREE.Group[]) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
  camera.position.set(0, 0, 8);
  scene.add(new THREE.HemisphereLight(0xffe7bd, 0x17243b, 2.4));
  const light = new THREE.DirectionalLight(0xffe8be, 2.3);
  light.position.set(-3, 5, 6);
  scene.add(light);
  const placements = [
    { player: 0, x: -0.78, y: 0.8, scale: 3.5, turn: -0.5, tilt: 1.12 },
    { player: 1, x: 0.78, y: 0.74, scale: 3.2, turn: 0.7, tilt: 1.22 },
    { player: 1, x: -0.72, y: -0.72, scale: 4.0, turn: -0.4, tilt: 1.18 },
    { player: 0, x: 0.7, y: -0.78, scale: 3.8, turn: 0.5, tilt: 1.06 },
    { player: 0, x: 0.49, y: -0.64, scale: 3.0, turn: -0.8, tilt: 1.3 },
  ];
  const pieces = placements.map((placement) => {
    const model = models[placement.player].clone(true);
    const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
    model.position.sub(center);
    const piece = new THREE.Group();
    piece.add(model);
    piece.scale.setScalar(placement.scale);
    piece.rotation.set(placement.tilt, 0.15, placement.turn);
    scene.add(piece);
    return piece;
  });
  const breathing = createBreathing(pieces);
  const pass = new RenderPass(scene, camera);
  pass.clear = false;
  pass.enabled = false;
  return {
    pass,
    update: breathing.update,
    resize(width: number, height: number, visible: boolean) {
      const aspect = width / height;
      camera.left = -aspect;
      camera.right = aspect;
      camera.updateProjectionMatrix();
      pieces.forEach((piece, index) => {
        const placement = placements[index];
        piece.position.set(placement.x * aspect, placement.y, 0);
        piece.rotation.set(placement.tilt, 0.15, placement.turn);
      });
      breathing.capture();
      pass.enabled = visible;
    },
  };
}
