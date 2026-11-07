import type { BoardLayout } from './layout';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Die.glb's modeled pips: Blender Z becomes glTF Y; Blender Y becomes glTF -Z.
export const faces = [
  { value: 1, normal: new THREE.Vector3(0, 1, 0) },
  { value: 6, normal: new THREE.Vector3(0, -1, 0) },
  { value: 2, normal: new THREE.Vector3(1, 0, 0) },
  { value: 5, normal: new THREE.Vector3(-1, 0, 0) },
  { value: 3, normal: new THREE.Vector3(0, 0, -1) },
  { value: 4, normal: new THREE.Vector3(0, 0, 1) },
];
export function upwardFace(rotation: THREE.Quaternion) {
  return faces.reduce((best, face) =>
    face.normal.clone().applyQuaternion(rotation).y >
    best.normal.clone().applyQuaternion(rotation).y
      ? face
      : best,
  ).value;
}
export function landingRotation(value: number, yaw: number) {
  const face = faces.find((face) => face.value === value)!;
  return new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    .multiply(new THREE.Quaternion().setFromUnitVectors(face.normal, new THREE.Vector3(0, 1, 0)));
}
function randomFace() {
  // Rejection sampling avoids bias when reducing a random byte to six faces.
  const sample = new Uint8Array(1);
  do {
    crypto.getRandomValues(sample);
  } while (sample[0] >= 252);
  return (sample[0] % 6) + 1;
}
export async function createDice(
  root: THREE.Group,
  boardCenter: THREE.Vector3,
  reducedMotion: MediaQueryList,
  layout: BoardLayout,
  callbacks: { canRoll: () => boolean; settled: (values: number[]) => void },
) {
  const button = document.querySelector<HTMLButtonElement>('#roll')!;
  const output = document.querySelector<HTMLOutputElement>('#dice-result')!;
  button.disabled = true;
  let model: THREE.Group;
  try {
    model = (await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/Die.glb`)).scene;
  } catch (error) {
    output.textContent = 'Dice unavailable · reload to retry';
    console.error(error);
    return { update: (_dt: number) => {}, resize: () => {} };
  }
  const bounds = new THREE.Box3().setFromObject(model),
    center = bounds.getCenter(new THREE.Vector3());
  const side = 0.022; // Original asset size; reuse the mesh and materials.
  const scale = side / bounds.getSize(new THREE.Vector3()).x;
  const dice = [0, 1].map(() => {
    const pivot = new THREE.Group(),
      mesh = model.clone(true);
    mesh.position.copy(center).negate();
    const wrapper = new THREE.Group();
    wrapper.add(mesh);
    wrapper.scale.setScalar(scale);
    pivot.add(wrapper);
    pivot.visible = false;
    root.add(pivot);
    return pivot;
  });
  const surface = 0.027 - boardCenter.y;
  const restingY = surface + side / 2;
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 64;
  const ctx = shadowCanvas.getContext('2d')!,
    gradient = ctx.createRadialGradient(32, 32, 7, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(0,0,0,.6)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(shadowCanvas);
  const shadows = dice.map(() => {
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(side * 1.8, side * 1.8),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.visible = false;
    root.add(shadow);
    return shadow;
  });
  function updateShadows() {
    dice.forEach((die, i) => {
      const shadow = shadows[i];
      shadow.visible = die.visible;
      shadow.position.set(die.position.x, surface + 0.0004, die.position.z);
      shadow.material.opacity = Math.max(0.08, 1 - (die.position.y - restingY) * 5);
    });
  }
  let timer = 0,
    rolling = false;
  let tosses: {
    start: THREE.Vector3;
    end: THREE.Vector3;
    target: THREE.Quaternion;
    spin: THREE.Vector3;
  }[] = [];
  function show(values: number[]) {
    output.textContent = `${values[0]}  ·  ${values[1]}`;
    output.setAttribute(
      'aria-label',
      `Dice result: ${values[0]} and ${values[1]}${values[0] === values[1] ? ' — doubles' : ''}`,
    );
    output.classList.toggle('doubles', values[0] === values[1]);
    output.dataset.values = values.join(',');
  }
  updateShadows();
  button.disabled = false;
  window.addEventListener('plakoto-reset', () => {
    dice.forEach((die) => (die.visible = false));
    shadows.forEach((shadow) => (shadow.visible = false));
    output.textContent = '— · —';
    output.setAttribute('aria-label', 'No dice rolled yet');
    output.classList.remove('doubles');
    delete output.dataset.values;
  });
  const duration = 1.5;
  button.addEventListener('click', () => {
    if (rolling || !callbacks.canRoll()) return;
    rolling = true;
    timer = 0;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    output.textContent = 'Rolling…';
    output.setAttribute('aria-label', 'Rolling two dice');
    delete output.dataset.values;
    tosses = dice.map((die, i) => {
      die.visible = true;
      const end = new THREE.Vector3(
        0.085 + i * 0.074 + (Math.random() - 0.5) * 0.014 - boardCenter.x,
        restingY,
        ((Math.random() - 0.5) * 0.065 - boardCenter.z) * layout.depth,
      );
      return {
        start: new THREE.Vector3(
          0.23 + i * 0.035 - boardCenter.x,
          restingY + 0.1,
          (0.13 - boardCenter.z) * layout.depth,
        ),
        end,
        target: landingRotation(randomFace(), Math.random() * Math.PI * 2),
        spin: new THREE.Vector3(
          (3 + i) * Math.PI * 2,
          (2 + i) * Math.PI * 2,
          (4 - i) * Math.PI * 2,
        ),
      };
    });
  });
  let previousDepth = layout.depth;
  return {
    resize() {
      const ratio = layout.depth / previousDepth;
      dice.forEach((die) => (die.position.z *= ratio));
      tosses.forEach((toss) => {
        toss.start.z *= ratio;
        toss.end.z *= ratio;
      });
      previousDepth = layout.depth;
      updateShadows();
    },
    update(dt: number) {
      if (!rolling) return;
      timer += dt;
      const t = Math.min(timer / (reducedMotion.matches ? 0.18 : duration), 1);
      dice.forEach((die, i) => {
        const toss = tosses[i];
        die.position.lerpVectors(toss.start, toss.end, 1 - Math.pow(1 - t, 2));
        if (!reducedMotion.matches) {
          // Three diminishing arcs simulate the initial throw and two board bounces.
          const arc =
            t < 0.55
              ? Math.sin((t / 0.55) * Math.PI) * 0.11
              : t < 0.82
                ? Math.sin(((t - 0.55) / 0.27) * Math.PI) * 0.038
                : Math.sin(((t - 0.82) / 0.18) * Math.PI) * 0.012;
          die.position.y += Math.max(0, arc);
          const spin = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
              toss.spin.x * (1 - t) ** 2,
              toss.spin.y * (1 - t) ** 2,
              toss.spin.z * (1 - t) ** 2,
            ),
          );
          die.quaternion.copy(toss.target).multiply(spin);
          // Keep the rotating cube's lowest corner above the felt.
          const m = new THREE.Matrix4().makeRotationFromQuaternion(die.quaternion).elements;
          const extent = (side / 2) * (Math.abs(m[1]) + Math.abs(m[5]) + Math.abs(m[9]));
          die.position.y = Math.max(die.position.y, surface + extent);
        } else {
          die.quaternion.copy(toss.target);
          die.position.copy(toss.end);
        }
      });
      updateShadows();
      if (t === 1) {
        rolling = false;
        // Read the actual settled mesh orientation, rather than displaying a separate random value.
        const values = dice.map((die) => upwardFace(die.quaternion));
        show(values);
        button.removeAttribute('aria-busy');
        callbacks.settled(values);
      }
    },
  };
}
