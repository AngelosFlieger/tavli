import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Vector3, InstancedMesh, Matrix4 } from 'three';
import {
  createWaterSweep,
  floodSample,
  floodFront,
  breakingParcel,
  centerCrestSample,
} from '../src/scene/water-sweep';

test('following flood waves overtake the first crest and leave full-width water behind', () => {
  assert.ok(floodFront(0, 0, 0) > floodFront(1, 0, 0));
  assert.ok(floodFront(1, 0, 0) > floodFront(2, 0, 0));
  assert.ok(floodFront(2, 3.5, 0) > floodFront(0, 3.5, 0));

  for (const z of [-0.19, -0.1, 0, 0.1, 0.19]) assert.ok(floodSample(-0.15, z, 2.5).height > 0);

  assert.equal(floodSample(0.29, 0, 0).height, 0);
  assert.equal(floodSample(-0.15, 0, 7.3).height, 0);
});

test('flood fills the box, reuses its meshes, cleans up and never transforms checkers', () => {
  const root = new Group(),
    checker = new Group();

  checker.position.set(0.1, 0.03, 0.12);
  root.add(checker);

  const before = checker.position.clone();
  const effect = createWaterSweep(root, new Vector3(0, 0.02, 0), { depth: 1, stackSlots: 5 });
  const body = effect.group.getObjectByName('flood-volume') as InstancedMesh;
  const objects = effect.group.children.slice();

  effect.trigger();

  for (let i = 0; i < 70; i++) effect.update(0.05);

  const matrix = new Matrix4(),
    pos = new Vector3(),
    scale = new Vector3();
  let minZ = 1,
    maxZ = -1,
    wet = 0;

  for (let i = 0; i < body.count; i++) {
    body.getMatrixAt(i, matrix);
    pos.setFromMatrixPosition(matrix);
    scale.setFromMatrixScale(matrix);

    if (scale.y === 0) continue;

    wet++;
    minZ = Math.min(minZ, pos.z);
    maxZ = Math.max(maxZ, pos.z);
    assert.ok(pos.x - 0.00525 * scale.x >= -0.294001 && pos.x + 0.00525 * scale.x <= 0.294001);
    assert.ok(pos.y - 0.00525 * scale.y >= 0.02899);
  }

  assert.ok(wet > body.count * 0.6, 'flood must fill most of the box, not a narrow band');
  assert.ok(minZ < -0.18 && maxZ > 0.18, 'flood must span the entire board width');
  assert.ok(checker.position.equals(before));

  for (let i = 0; i < 140; i++) effect.update(0.05);

  assert.equal(effect.active, false);
  effect.trigger();
  assert.deepEqual(effect.group.children, objects);
  effect.dispose();
  assert.deepEqual(root.children, [checker]);
});

test('reduced-motion flood stays stationary after fading in and suppresses airborne water', () => {
  const effect = createWaterSweep(new Group(), new Vector3(), { depth: 2, stackSlots: 7 });

  effect.trigger(false);

  const body = effect.group.getObjectByName('flood-volume') as InstancedMesh;

  for (let i = 0; i < 4; i++) effect.update(0.05);

  const before = Array.from(body.instanceMatrix.array);

  for (let i = 0; i < 8; i++) effect.update(0.05);

  assert.deepEqual(Array.from(body.instanceMatrix.array), before);
  assert.equal(effect.group.getObjectByName('water-spray')!.visible, false);

  for (let i = 0; i < 20; i++) effect.update(0.05);

  assert.equal(effect.active, false);
  effect.dispose();
});

test('breaking parcels fall faster while staying close to the crest', () => {
  for (let wave = 0; wave < 3; wave++) {
    const a = breakingParcel(wave, 2, 0, 0),
      b = breakingParcel(wave, 2, 0, 0.1),
      c = breakingParcel(wave, 2, 0, 0.2);

    assert.ok(c.height - b.height < b.height - a.height);
    assert.ok(Math.abs(c.x - floodFront(wave, 2, 0)) < 0.02);
  }
});

test('recession clears from left to right without random dry holes', () => {
  for (const time of [4.8, 5.3, 5.8, 6.3, 6.8]) {
    for (const [min, max] of [
      [-0.248, -0.03],
      [0.03, 0.248],
    ]) {
      let wet = false;

      for (let x = min + 0.001; x < max; x += 0.003) {
        const isWet = floodSample(x, 0.05, time).height > 0;

        assert.ok(!wet || isWet, 'dry hole appeared behind a wet part of the shoreline');
        wet ||= isWet;
      }
    }
  }

  assert.equal(floodSample(-0.15, 0, 6).height, 0);
  assert.ok(floodSample(0.15, 0, 6).height > 0);
  assert.equal(floodSample(0.15, 0, 7.3).height, 0);
});

test('water samples exclude side trays, center bar, and end rails throughout the sweep', () => {
  for (const time of [1, 2.5, 3.5, 5, 6]) {
    for (const x of [-0.29, -0.27, -0.01, 0, 0.01, 0.27, 0.29])
      assert.equal(floodSample(x, 0, time).height, 0);
    for (const z of [-0.22, 0.22]) assert.equal(floodSample(0.15, z, time).height, 0);
  }
});

test('passing crest crosses above the center bar without leaving standing water', () => {
  assert.ok(centerCrestSample(0, 0, 2.65).height > 0);
  assert.equal(floodSample(0, 0, 2.65).height, 0);
  assert.equal(centerCrestSample(0, 0, 5).height, 0);

  const effect = createWaterSweep(new Group(), new Vector3(), { depth: 1, stackSlots: 5 });

  effect.trigger();

  for (let i = 0; i < 53; i++) effect.update(0.05);

  const mesh = effect.group.getObjectByName('flood-volume') as InstancedMesh;
  const matrix = new Matrix4(),
    pos = new Vector3(),
    scale = new Vector3();
  let crossing = 0;

  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    pos.setFromMatrixPosition(matrix);
    scale.setFromMatrixScale(matrix);

    if (Math.abs(pos.x) >= 0.03 || scale.y === 0) continue;

    crossing++;
    assert.ok(pos.y - scale.y * 0.00525 >= 0.04299, 'crest entered the center bar');
  }

  assert.ok(crossing > 0, 'crest vanished at the center');
  effect.dispose();
});
