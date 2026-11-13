import * as THREE from 'three';

type SavedMaterial = {
  mesh: THREE.Mesh;
  original: THREE.Material | THREE.Material[];
  dimmed: THREE.Material | THREE.Material[];
};

/** Visual copies only; the selected checker and the board state stay in place until a move is made. */
export function createMovePreview(
  root: THREE.Group,
  camera: THREE.Camera,
  checkers: THREE.Group[],
  boardCenter: THREE.Vector3,
) {
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane();
  const planePoint = new THREE.Vector3();
  const planeNormal = new THREE.Vector3();
  const intersection = new THREE.Vector3();
  let selectedIds: number[] = [];
  let held: THREE.Group[] = [];
  let landing: THREE.Group | null = null;
  let saved: SavedMaterial[] = [];
  let spin = 0;

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.022, 32),
    new THREE.MeshBasicMaterial({
      color: 0x0b1522,
      transparent: true,
      opacity: 0.58,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 8;
  shadow.visible = false;
  root.add(shadow);

  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.019, 0.024, 40),
    new THREE.MeshBasicMaterial({
      color: 0xffd46b,
      transparent: true,
      opacity: 0.78,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.renderOrder = 9;
  halo.visible = false;
  root.add(halo);

  function faded(material: THREE.Material | THREE.Material[], opacity: number) {
    const make = (source: THREE.Material) => {
      const copy = source.clone();
      if (opacity < 1) {
        copy.transparent = true;
        copy.opacity *= opacity;
        copy.depthWrite = false;
      }
      return copy;
    };
    return Array.isArray(material) ? material.map(make) : make(material);
  }

  function dispose(material: THREE.Material | THREE.Material[]) {
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material.dispose();
  }

  function dimmed(material: THREE.Material | THREE.Material[]) {
    const make = (source: THREE.Material) => {
      const copy = source.clone();
      if (copy instanceof THREE.MeshStandardMaterial || copy instanceof THREE.MeshBasicMaterial)
        copy.color.multiplyScalar(0.42);
      return copy;
    };
    return Array.isArray(material) ? material.map(make) : make(material);
  }

  function visualCopy(source: THREE.Group, opacity: number, landingPreview = false) {
    const group = source.clone(true);
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.material = faded(object.material, opacity);
      if (landingPreview) {
        object.renderOrder = 10;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          // The checker has separate top and underside meshes. Keep their depth so
          // the underside cannot blend through the translucent top surface.
          material.side = THREE.FrontSide;
          material.depthTest = true;
          material.depthWrite = true;
        }
      }
    });
    group.visible = false;
    root.add(group);
    return group;
  }

  function removeVisual(group: THREE.Group | null) {
    if (!group) return;
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) dispose(object.material);
    });
    root.remove(group);
  }

  function select(ids: number[]) {
    if (ids.length === selectedIds.length && ids.every((id, index) => id === selectedIds[index]))
      return;
    for (const item of saved) {
      item.mesh.material = item.original;
      dispose(item.dimmed);
    }
    saved = [];
    held.forEach(removeVisual);
    removeVisual(landing);
    held = [];
    landing = null;
    shadow.visible = false;
    halo.visible = false;
    selectedIds = [...ids];
    if (!ids.length) return;

    held = ids.map((id) => {
      const copy = visualCopy(checkers[id], 1);
      copy.scale.multiplyScalar(1.1);
      return copy;
    });
    landing = visualCopy(checkers[ids[0]], 0.86, true);
    landing.scale.multiplyScalar(1.04);
    ids.forEach((id) =>
      checkers[id].traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const original = object.material;
        const muted = dimmed(original);
        object.material = muted;
        saved.push({ mesh: object, original, dimmed: muted });
      }),
    );
  }

  function followPointer(ndc: THREE.Vector2) {
    if (!held.length) return;
    root.updateMatrixWorld(true);
    raycaster.setFromCamera(ndc, camera);
    planePoint.set(0, 0.14 - boardCenter.y, 0).applyMatrix4(root.matrixWorld);
    planeNormal.set(0, 1, 0).transformDirection(root.matrixWorld);
    plane.setFromNormalAndCoplanarPoint(planeNormal, planePoint);
    if (!raycaster.ray.intersectPlane(plane, intersection)) return;
    const at = root.worldToLocal(intersection);
    held.forEach((checker, index) => {
      checker.position.copy(at);
      checker.position.x += (index - (held.length - 1) / 2) * 0.009;
      checker.position.y += (held.length - index - 1) * 0.006;
      checker.visible = true;
    });
  }

  function showLanding(at: THREE.Vector3 | null) {
    if (!landing) return;
    landing.visible = at !== null;
    shadow.visible = at !== null;
    halo.visible = at !== null;
    if (!at) return;
    landing.position.copy(at);
    landing.position.y += 0.001;
    shadow.position.copy(at);
    shadow.position.y += 0.0006;
    halo.position.copy(shadow.position);
    halo.position.y += 0.0002;
  }

  function hidePointer() {
    held.forEach((checker) => (checker.visible = false));
    showLanding(null);
  }

  function update(dt: number) {
    if (!landing?.visible) return;
    spin += dt * 1.6;
    landing.rotation.y = spin;
    shadow.scale.setScalar(1 + Math.sin(spin * 2) * 0.08);
    halo.scale.copy(shadow.scale);
  }

  return { select, followPointer, showLanding, hidePointer, update };
}

export type MovePreview = ReturnType<typeof createMovePreview>;
