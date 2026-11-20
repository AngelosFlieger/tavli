import * as THREE from 'three';
import type { BoardLayout } from './layout';

const DURATION = 7.3;
const STILL_TIME = 2.3;
const STILL_DURATION = 1.2;
const FLOOR = 0.029;
const CENTER_BAR_TOP = 0.043;
const CELL = 0.0105;
const NX = 56;
const NZ = 38;
const HALF_X = 0.294;
const HALF_Z = 0.1995;
/** Felt on either side of the center bar. The bar gap and the outer rails stay dry. */
const PLAY_HALF_X = 0.248;
const CENTER_HALF = 0.03;
const WAVE_COUNT = 3;
const LIP_ROWS = 3;
const SPRAY_COUNT = 180;
const SPEEDS = [0.14, 0.2, 0.26];
const STARTS = [-0.34, -0.48, -0.62];
const HEIGHTS = [0.06, 0.048, 0.036];
const BLUE_PIXELS = [0x10769c, 0x1585a8, 0x178eae, 0x1c9bb7, 0x24a6bd];

type Sample = { height: number; foam: number };

const clamp = THREE.MathUtils.clamp;
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Signed fractional noise. The sign is part of the tuned palette, so it is not folded into 0..1. */
const noise = (i: number) => (Math.sin(i * 127.1 + 311.7) * 43758.5453) % 1;
const dry = (): Sample => ({ height: 0, foam: 0 });

export function floodFront(wave: number, time: number, z: number) {
  return STARTS[wave] + SPEEDS[wave] * time + Math.sin(z * 23 + wave * 1.8 + time * 0.8) * 0.012;
}

/** Travelling shallow flood with faster following crests catching the first breaker. */
export function floodSample(x: number, z: number, time: number): Sample {
  if (Math.abs(x) < CENTER_HALF) return dry();
  return flowSample(x, z, time);
}

function flowSample(x: number, z: number, time: number): Sample {
  if (Math.abs(x) > PLAY_HALF_X || Math.abs(z) > HALF_Z || time >= DURATION) return dry();
  let leading = -Infinity;
  for (let wave = 0; wave < WAVE_COUNT; wave++)
    leading = Math.max(leading, floodFront(wave, time, z));
  const behind = leading - x;
  if (behind <= 0) return dry();
  const wet = smooth(0, 0.018, behind);
  // One irregular shoreline follows the flood out, rather than dissolving tiles.
  const shore = -0.275 + smooth(4.35, 7.15, time) * 0.55 + Math.sin(z * 23 + time) * 0.01;
  const retreat = time > 4.35 ? smooth(shore - 0.014, shore + 0.014, x) : 1;
  const drain = (1 - 0.55 * smooth(4.2, DURATION, time)) * retreat;
  let height = 0.007;
  let foam = 0;
  for (let wave = 0; wave < WAVE_COUNT; wave++) {
    const distance = floodFront(wave, time, z) - x;
    const crest = Math.exp(-Math.pow((distance - 0.027) / 0.038, 2));
    const chop = 0.85 + 0.15 * Math.sin(z * 48 + time * 5 + wave);
    height += HEIGHTS[wave] * crest * chop;
    // The breaking lip becomes churning whitewash behind the front.
    foam += Math.exp(-Math.pow((distance - 0.008) / 0.017, 2)) * 0.85;
    if (distance > 0.025 && distance < 0.18)
      foam +=
        Math.exp(-distance * 12) *
        (0.5 + 0.5 * Math.sin(x * 155 + z * 119 - time * 7 + wave)) *
        0.48;
  }
  height += 0.0025 * Math.sin(x * 93 - time * 7 + Math.sin(z * 38)) * Math.sin(z * 67 + time * 3);
  return {
    height: Math.max(0.001, Math.min(0.105, height)) * wet * drain,
    foam: Math.min(1, foam) * wet * drain,
  };
}

/** Only the passing crest can occupy the air above the dry center bar. */
export function centerCrestSample(x: number, z: number, time: number): Sample {
  const sample = flowSample(x, z, time);
  return { height: Math.max(0, FLOOR + sample.height - CENTER_BAR_TOP), foam: sample.foam };
}

/** Heavy spilling lip: little forward travel, accelerating downward into the next swell. */
export function breakingParcel(wave: number, time: number, z: number, flight: number) {
  return {
    x: floodFront(wave, time - flight, z) - 0.008 + flight * (SPEEDS[wave] + 0.055),
    height: HEIGHTS[wave] * 0.96 + 0.01 + flight * 0.025 - 0.5 * 1.65 * flight * flight,
  };
}

/** Visual-only pixel flood. It never receives checkers, a physics world, or game state. */
export function createWaterSweep(root: THREE.Group, center: THREE.Vector3, layout: BoardLayout) {
  const group = new THREE.Group();
  group.name = 'water-sweep-preview';
  group.position.copy(center).negate();
  group.visible = false;
  root.add(group);

  const cube = shadedCube();
  const material = new THREE.MeshBasicMaterial({ vertexColors: true });
  const tint = new THREE.Color();
  const body = pool(group, cube, material, tint, 'flood-volume', NX * NZ);
  const foam = pool(group, cube, material, tint, 'flood-whitewash', NX * NZ);
  const lips = pool(group, cube, material, tint, 'breaking-lips', WAVE_COUNT * NZ * LIP_ROWS);
  const spray = pool(group, cube, material, tint, 'water-spray', SPRAY_COUNT);
  const meshes = [body, foam, lips, spray];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const spin = new THREE.Euler();
  let age = 0;
  let active = false;
  let motion = true;

  function place(
    mesh: THREE.InstancedMesh,
    index: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    hex: number,
    turn = false,
  ) {
    const radius = (sx + sy + sz) / 2;
    const clearsBar = y - (turn ? radius : sy / 2) >= CENTER_BAR_TOP - 0.000001;
    const panMin = clearsBar ? -PLAY_HALF_X : x < 0 ? -PLAY_HALF_X : CENTER_HALF;
    const panMax = clearsBar ? PLAY_HALF_X : x < 0 ? -CENTER_HALF : PLAY_HALF_X;
    const x0 = Math.max(panMin, x - sx / 2);
    const x1 = Math.min(panMax, x + sx / 2);
    const z0 = Math.max(-HALF_Z, z - sz / 2);
    const z1 = Math.min(HALF_Z, z + sz / 2);
    // Spinning droplets use a conservative radius so corners never reach wood or trays.
    const inside =
      !turn ||
      (x - radius >= panMin &&
        x + radius <= panMax &&
        z - radius >= -HALF_Z &&
        z + radius <= HALF_Z);
    const visible = inside && x1 > x0 && z1 > z0 && sy > 0;
    position.set((x0 + x1) / 2, y, ((z0 + z1) / 2) * layout.depth);
    scale.set(
      visible ? (x1 - x0) / CELL : 0,
      visible ? sy / CELL : 0,
      visible ? ((z1 - z0) / CELL) * layout.depth : 0,
    );
    if (turn) rotation.setFromEuler(spin);
    else rotation.identity();
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, tint.setHex(hex));
  }

  function paint() {
    const time = motion ? age : STILL_TIME;
    const duration = motion ? DURATION : STILL_DURATION;
    const envelope =
      smooth(0, 0.16, age) * (motion ? 1 : 1 - smooth(duration - 0.45, duration, age));
    const heightScale = motion ? 1 : 0.3;
    paintSurface(time, envelope, heightScale);
    paintLips(time, envelope);
    paintSpray(time, envelope);
    for (const mesh of meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  function paintSurface(time: number, envelope: number, heightScale: number) {
    for (let ix = 0; ix < NX; ix++) {
      for (let iz = 0; iz < NZ; iz++) {
        const index = ix * NZ + iz;
        const x = -HALF_X + (ix + 0.5) * CELL;
        const z = -HALF_Z + (iz + 0.5) * CELL;
        const overBar = Math.abs(x) < CENTER_HALF;
        const sample = overBar ? centerCrestSample(x, z, time) : floodSample(x, z, time);
        const floor = overBar ? CENTER_BAR_TOP : FLOOR;
        const height = sample.height * heightScale * envelope;
        const grain = Math.abs(noise(Math.floor(ix / 2) * 83 + Math.floor(iz / 2) * 47 + 19));
        // Adjacent columns meet exactly: overlapping coplanar tops caused the black seams.
        const footprint = smooth(0.0001, 0.0007, height);
        place(
          body,
          index,
          x,
          floor + height / 2,
          z,
          CELL * footprint,
          height,
          CELL * footprint,
          waterColor(height, grain),
        );
        const fleck = sample.foam > 0.34 + Math.abs(noise(index)) * 0.43;
        const foamSize =
          fleck && height > 0.002 ? CELL * (0.5 + Math.abs(noise(index + 31)) * 0.5) : 0;
        place(
          foam,
          index,
          x,
          floor + height + 0.0018,
          z,
          foamSize,
          0.003 * envelope,
          foamSize,
          index % 4 === 0 ? 0xc1f1df : 0xffebc1,
        );
      }
    }
  }

  function paintLips(time: number, envelope: number) {
    for (let wave = 0; wave < WAVE_COUNT; wave++) {
      for (let iz = 0; iz < NZ; iz++) {
        for (let row = 0; row < LIP_ROWS; row++) {
          const index = (wave * NZ + iz) * LIP_ROWS + row;
          const z = -HALF_Z + (iz + 0.5) * CELL;
          const patch = Math.floor(iz / 4);
          const flight = (time * 0.87 + patch * 0.173 + wave * 0.23 + row * 0.012) % 0.58;
          const parcel = breakingParcel(wave, time, z, flight);
          const surface = floodSample(parcel.x, z, time).height;
          const visible =
            motion && time - flight > 0.15 && flight < 0.34 && parcel.height > surface + 0.0015;
          const size = visible ? CELL * (0.7 + row * 0.09) * envelope : 0;
          spin.set(-flight * 1.2, row * 0.1, flight * 0.6);
          place(
            lips,
            index,
            parcel.x + (row - 1) * 0.002,
            FLOOR + parcel.height,
            z,
            size,
            size * 0.66,
            size,
            row === 2 ? 0xffedc5 : row === 1 ? 0x9de5d7 : 0x32b3bf,
            true,
          );
        }
      }
    }
  }

  function paintSpray(time: number, envelope: number) {
    spray.visible = motion;
    if (!motion) return;
    for (let index = 0; index < spray.count; index++) {
      const wave = index % WAVE_COUNT;
      const z = (Math.abs(noise(index + 91)) * 2 - 1) * HALF_Z;
      const flight = (time + index * 0.073) % 0.82;
      const x = floodFront(wave, time - flight, z) + flight * (SPEEDS[wave] + 0.085);
      const height =
        HEIGHTS[wave] + flight * (0.11 + (index % 4) * 0.018) - 0.5 * 1.5 * flight * flight;
      const visible = time - flight > 0.15 && height > floodSample(x, z, time).height + 0.006;
      const size = visible ? CELL * (0.25 + (index % 3) * 0.12) * envelope : 0;
      spin.set(time * 1.6 + index, index * 0.7, time * 0.9);
      place(
        spray,
        index,
        x,
        FLOOR + height,
        z,
        size,
        size,
        size,
        index % WAVE_COUNT === 0 ? 0xffedc5 : 0x7ce3d7,
        true,
      );
    }
  }

  function reset() {
    active = false;
    age = 0;
    group.visible = false;
  }

  return {
    group,
    get active() {
      return active;
    },
    trigger(animate = true) {
      motion = animate;
      age = 0;
      active = true;
      group.visible = true;
      paint();
    },
    update(dt: number) {
      if (!active) return;
      age += Math.max(0, Math.min(dt, 0.05));
      if (age >= (motion ? DURATION : STILL_DURATION)) {
        reset();
        return;
      }
      paint();
    },
    reset,
    dispose() {
      reset();
      root.remove(group);
      cube.dispose();
      material.dispose();
    },
  };
}

export type WaterSweep = ReturnType<typeof createWaterSweep>;

function waterColor(height: number, grain: number) {
  if (height > 0.04) return grain > 0.5 ? 0x43c6c9 : 0x2db5bf;
  if (height > 0.02) return grain > 0.5 ? 0x22a5b9 : 0x1896ae;
  return BLUE_PIXELS[Math.min(4, Math.floor(grain * 5))];
}

function shadedCube() {
  const cube = new THREE.BoxGeometry(CELL, CELL, CELL);
  const colors = new Float32Array(cube.attributes.position.count * 3);
  const normals = cube.attributes.normal;
  for (let vertex = 0; vertex < normals.count; vertex++) {
    const shade =
      0.9 +
      0.14 * Math.max(0, normals.getY(vertex)) +
      0.035 * normals.getX(vertex) -
      0.025 * normals.getZ(vertex);
    colors.set([shade, shade, shade], vertex * 3);
  }
  cube.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return cube;
}

function pool(
  group: THREE.Group,
  cube: THREE.BufferGeometry,
  material: THREE.Material,
  tint: THREE.Color,
  name: string,
  count: number,
) {
  const mesh = new THREE.InstancedMesh(cube, material, count);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let index = 0; index < count; index++) mesh.setColorAt(index, tint);
  group.add(mesh);
  return mesh;
}
