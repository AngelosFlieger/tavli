import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectionalLight, OrthographicCamera, Vector3 } from 'three';
import { createTableLights, faceTableLights } from '../src/scene/table-lights';

test('opposite seats receive identical camera-relative table lighting and reset correctly', () => {
  const rig = createTableLights();
  const camera = new OrthographicCamera();
  function sample(z: number) {
    camera.position.set(0, 12, z);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    faceTableLights(rig, camera);
    return rig.children
      .filter((item) => 'isLight' in item)
      .map((light) => {
        const position = light
          .getWorldPosition(new Vector3())
          .applyMatrix4(camera.matrixWorldInverse);
        const direction =
          light instanceof DirectionalLight
            ? light
                .getWorldPosition(new Vector3())
                .sub(light.target.getWorldPosition(new Vector3()))
                .transformDirection(camera.matrixWorldInverse)
            : null;
        return { position, direction };
      });
  }
  const baseline = sample(8.3);
  for (const z of [-8.3, 8.3, -8.3, 8.3]) {
    sample(z).forEach((light, index) => {
      assert.ok(light.position.distanceTo(baseline[index].position) < 1e-10);
      if (light.direction)
        assert.ok(light.direction.distanceTo(baseline[index].direction!) < 1e-10);
    });
  }
});
