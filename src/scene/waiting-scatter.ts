import * as THREE from 'three';
import { createBreathing } from './breathing';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';

/** Original artwork arranged around the matchmaking UI, independent of the playable table. */
export function createWaitingScatter(checkers: THREE.Group[], die: THREE.Group) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
  camera.position.z = 8;
  scene.add(new THREE.HemisphereLight(0xffe6ba, 0x1c1632, 2.4));
  const key = new THREE.DirectionalLight(0xffd5ad, 2.8);
  key.position.set(-3, 5, 7);
  scene.add(key);
  const items: {
    model: THREE.Object3D;
    x: number;
    y: number;
    size: number;
    rotation: [number, number, number];
  }[] = [
    { model: checkers[1], x: -0.88, y: 0.46, size: 6.5, rotation: [1.1, 0.1, -0.5] },
    { model: checkers[0], x: 0.91, y: 0.43, size: 7.5, rotation: [1.25, 0.15, 0.6] },
    { model: checkers[0], x: -0.98, y: -0.2, size: 12, rotation: [1.08, 0.25, -0.35] },
    { model: checkers[1], x: 0.9, y: -0.57, size: 12, rotation: [1.22, -0.1, 0.4] },
    { model: checkers[0], x: 0.98, y: -0.23, size: 8, rotation: [1.0, 0.25, -0.65] },
    { model: die, x: -0.83, y: -0.76, size: 11, rotation: [0.5, 0.65, -0.4] },
    { model: die, x: -0.97, y: -0.52, size: 8, rotation: [0.7, -0.5, 0.2] },
    { model: die, x: 0.69, y: -0.88, size: 7, rotation: [0.6, 0.9, -0.3] },
  ];
  const objects = items.map((item) => {
    const art = item.model.clone(true);
    art.position.sub(new THREE.Box3().setFromObject(art).getCenter(new THREE.Vector3()));
    const object = new THREE.Group();
    object.add(art);
    object.rotation.set(...item.rotation);
    scene.add(object);
    return object;
  });
  const breathing = createBreathing(objects);
  const pass = new RenderPass(scene, camera);
  pass.clear = false;
  pass.enabled = false;
  return {
    pass,
    update: breathing.update,
    resize(width: number, height: number, visible: boolean) {
      const aspect = width / height,
        portrait = width <= height;
      camera.left = -aspect;
      camera.right = aspect;
      camera.updateProjectionMatrix();
      objects.forEach((object, index) => {
        const item = items[index];
        object.rotation.set(...item.rotation);
        object.scale.setScalar(item.size * (portrait ? 0.63 : 1));
        const y = portrait && item.y > 0.2 ? 0.78 + index * 0.025 : item.y;
        object.position.set(item.x * aspect, y, 0);
      });
      breathing.capture();
      pass.enabled = visible;
    },
  };
}
