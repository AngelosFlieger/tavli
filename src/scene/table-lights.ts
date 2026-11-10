import { Camera, DirectionalLight, Group, PointLight } from 'three';

/** Keep the warm key, cool rim and red accent in the same position for each viewer. */
export function createTableLights() {
  const lights = new Group();
  const key = new DirectionalLight(0xffedce, 3.2);
  key.position.set(-3, 9, 5);
  const rim = new DirectionalLight(0x789ffe, 1.1);
  rim.position.set(4, 4, -4);
  const red = new PointLight(0xff334b, 14, 20, 2);
  red.position.set(-5, 2, 2);
  // Targets belong to the rig too, so their world transforms are always current.
  lights.add(key, key.target, rim, rim.target, red);
  return lights;
}

export function faceTableLights(lights: Group, camera: Camera) {
  lights.rotation.y = Math.atan2(camera.position.x, camera.position.z);
  lights.updateMatrixWorld(true);
}
