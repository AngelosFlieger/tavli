import type { BoardLayout } from './layout';
import * as THREE from 'three';
import { loadModel } from './assets';

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
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  boardCenter: THREE.Vector3,
  reducedMotion: MediaQueryList,
  layout: BoardLayout,
  callbacks: {
    canRoll: () => boolean;
    /** Handles the shared button while it means "end turn". True consumes the click. */
    finish: () => boolean;
    player: () => 0 | 1;
    settled: (values: number[]) => void;
    scripted: () => boolean;
    forced: () => [number, number] | null;
    presented: () => void;
    selectableDice: () => (0 | 1)[];
    selectDie: (index: 0 | 1) => void;
  },
) {
  const button = document.querySelector<HTMLButtonElement>('#roll')!;
  const output = document.querySelector<HTMLOutputElement>('#dice-result')!;
  button.disabled = true;
  let model: THREE.Group;
  try {
    model = (await loadModel('Die')).scene;
  } catch (error) {
    output.textContent = 'Dice unavailable · reload to retry';
    console.error(error);
    return {
      update: (_dt: number) => {},
      resize: () => {},
      reset() {},
      play(_values: [number, number], _rerolledDie?: 0 | 1) {},
    };
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
  const selectionRings = dice.map(() => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(side * 0.78, side * 1.08, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffd36b,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        depthTest: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    root.add(ring);
    return ring;
  });
  let hoveredDie: 0 | 1 | null = null;
  const dieTargets = dice.map((_die, index) => {
    const target = document.createElement('button');
    target.type = 'button';
    target.className = 'die-target';
    target.dataset.die = String(index);
    target.setAttribute('aria-label', `Reroll die ${index + 1}`);
    target.hidden = true;
    target.addEventListener('pointerenter', () => (hoveredDie = index as 0 | 1));
    target.addEventListener('pointerleave', () => (hoveredDie = null));
    const select = () => {
      if (!rolling && callbacks.selectableDice().includes(index as 0 | 1))
        callbacks.selectDie(index as 0 | 1);
    };
    const selectOnPress = (event: PointerEvent | MouseEvent) => {
      event.preventDefault();
      select();
    };
    target.addEventListener('pointerdown', selectOnPress);
    // Keep desktop selection reliable in browsers that do not synthesize pointer events for
    // programmatic or assistive mouse input. A successful pointer press clears eligibility, so
    // the following mouse event cannot activate the ability twice.
    target.addEventListener('mousedown', selectOnPress);
    target.addEventListener('click', (event) => {
      // Pointer selection is handled on press so a moving 3D projection cannot lose pointer-up.
      if (event.detail === 0) select();
    });
    document.body.append(target);
    return target;
  });
  const projected = new THREE.Vector3();
  const targetPositionsLocked = [false, false];
  let rollingIndices: (0 | 1)[] = [];
  function updateShadows() {
    dice.forEach((die, i) => {
      const shadow = shadows[i];
      shadow.visible = die.visible;
      shadow.position.set(die.position.x, surface + 0.0004, die.position.z);
      shadow.material.opacity = Math.max(0.08, 1 - (die.position.y - restingY) * 5);
      const ring = selectionRings[i];
      const selectable = !rolling && callbacks.selectableDice().includes(i as 0 | 1);
      ring.visible = selectable && die.visible;
      ring.position.set(die.position.x, surface + 0.0007, die.position.z);
      ring.scale.setScalar(hoveredDie === i ? 1.18 : 1);
      const target = dieTargets[i];
      target.hidden = !selectable || !die.visible;
      if (target.hidden) targetPositionsLocked[i] = false;
      else if (!targetPositionsLocked[i]) {
        die.getWorldPosition(projected).project(camera);
        const rect = canvas.getBoundingClientRect();
        target.style.left = `${rect.left + ((projected.x + 1) / 2) * rect.width}px`;
        target.style.top = `${rect.top + ((1 - projected.y) / 2) * rect.height}px`;
        targetPositionsLocked[i] = true;
      }
    });
    canvas.dataset.selectableDice = callbacks.selectableDice().join(',');
  }
  let timer = 0,
    rolling = false;
  let tosses: (
    | {
        start: THREE.Vector3;
        end: THREE.Vector3;
        target: THREE.Quaternion;
        spin: THREE.Vector3;
      }
    | undefined
  )[] = [];
  function show(values: number[]) {
    output.textContent = `${values[0]}  ·  ${values[1]}`;
    output.setAttribute(
      'aria-label',
      `Dice result: ${values[0]} and ${values[1]}${values[0] === values[1] ? ' — doubles' : ''}`,
    );
  }
  updateShadows();
  button.disabled = false;
  function reset() {
    rolling = false;
    timer = 0;
    button.removeAttribute('aria-busy');
    dice.forEach((die) => (die.visible = false));
    shadows.forEach((shadow) => (shadow.visible = false));
    selectionRings.forEach((ring) => (ring.visible = false));
    dieTargets.forEach((target) => (target.hidden = true));
    targetPositionsLocked.fill(false);
    rollingIndices = [];
    canvas.dataset.selectableDice = '';
    canvas.dataset.rollingDice = '';
    canvas.dataset.lastRollingDice = '';
    output.textContent = '— · —';
    output.setAttribute('aria-label', 'No dice rolled yet');
  }
  const duration = 1.5;
  function startToss(forced?: [number, number], onlyDie?: 0 | 1) {
    rolling = true;
    rollingIndices = onlyDie === undefined ? [0, 1] : [onlyDie];
    canvas.dataset.rollingDice = rollingIndices.join(',');
    canvas.dataset.lastRollingDice = rollingIndices.join(',');
    hoveredDie = null;
    timer = 0;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    output.textContent = onlyDie === undefined ? 'Rolling…' : `Rerolling die ${onlyDie + 1}…`;
    output.setAttribute(
      'aria-label',
      onlyDie === undefined ? 'Rolling two dice' : `Rerolling die ${onlyDie + 1}`,
    );
    const side = callbacks.player() === 0 ? -1 : 1;
    const place = (x: number, z: number, y: number) =>
      new THREE.Vector3(side * x - boardCenter.x, y, (z - boardCenter.z) * layout.depth);
    tosses = dice.map((die, i) => {
      if (!rollingIndices.includes(i as 0 | 1)) return undefined;
      const rerolling = onlyDie !== undefined;
      const current = die.position.clone();
      die.visible = true;
      return {
        start: rerolling
          ? current.clone().setY(restingY + 0.075)
          : place(0.23 + i * 0.035, side * 0.22, restingY + 0.1),
        end: rerolling
          ? current
              .clone()
              .add(
                new THREE.Vector3((Math.random() - 0.5) * 0.035, 0, (Math.random() - 0.5) * 0.035),
              )
              .setY(restingY)
          : place(
              0.085 + i * 0.074 + (Math.random() - 0.5) * 0.014,
              (Math.random() - 0.5) * 0.065,
              restingY,
            ),
        target: landingRotation(forced?.[i] ?? randomFace(), Math.random() * Math.PI * 2),
        spin: new THREE.Vector3(
          (3 + i) * Math.PI * 2,
          (2 + i) * Math.PI * 2,
          (4 - i) * Math.PI * 2,
        ),
      };
    });
  }
  button.addEventListener('click', () => {
    if (callbacks.finish() || rolling || !callbacks.canRoll()) return;
    if (callbacks.scripted()) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      output.textContent = 'Rolling…';
      output.setAttribute('aria-label', 'Rolling two dice');
      return;
    }
    startToss(callbacks.forced() ?? undefined);
  });
  let previousDepth = layout.depth;
  return {
    play(values: [number, number], rerolledDie?: 0 | 1) {
      if (!rolling) startToss(values, rerolledDie);
    },
    reset,
    resize() {
      targetPositionsLocked.fill(false);
      const ratio = layout.depth / previousDepth;
      dice.forEach((die) => (die.position.z *= ratio));
      tosses.forEach((toss) => {
        if (!toss) return;
        toss.start.z *= ratio;
        toss.end.z *= ratio;
      });
      previousDepth = layout.depth;
      updateShadows();
    },
    update(dt: number) {
      updateShadows();
      if (!rolling) return;
      timer += dt;
      const t = Math.min(timer / (reducedMotion.matches ? 0.18 : duration), 1);
      dice.forEach((die, i) => {
        const toss = tosses[i];
        if (!toss) return;
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
        rollingIndices = [];
        canvas.dataset.rollingDice = '';
        // Read the actual settled mesh orientation, rather than displaying a separate random value.
        const values = dice.map((die) => upwardFace(die.quaternion));
        show(values);
        button.removeAttribute('aria-busy');
        if (callbacks.scripted()) callbacks.presented();
        else callbacks.settled(values);
      }
    },
  };
}
