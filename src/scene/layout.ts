import { Matrix4, type Camera } from 'three';
/** Visual layout only. Logical point IDs, dice values and move paths never change. */
export interface BoardLayout {
  depth: number;
  stackSlots: number;
}
export function boardLayout(portrait: boolean, title: boolean, aspect: number): BoardLayout {
  return portrait && !title
    ? { depth: Math.min(2.6, Math.max(1.3, 1.6 / aspect)), stackSlots: 7 }
    : { depth: 1, stackSlots: 5 };
}

/** Map board space into its UI rectangle; the background still fills the entire viewport. */
export function applyBoardViewport(
  camera: Camera,
  frame: { left: number; top: number; width: number; height: number },
  width: number,
  height: number,
) {
  const sx = frame.width / width,
    sy = frame.height / height;
  const tx = ((frame.left + frame.width / 2) / width) * 2 - 1,
    ty = 1 - ((frame.top + frame.height / 2) / height) * 2;
  camera.projectionMatrix.premultiply(
    new Matrix4().set(sx, 0, 0, tx, 0, sy, 0, ty, 0, 0, 1, 0, 0, 0, 0, 1),
  );
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
