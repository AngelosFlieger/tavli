import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

export function loadModel(name: string) {
  return loader.loadAsync(`${import.meta.env.BASE_URL}models/${name}.glb`);
}
