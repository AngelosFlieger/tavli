// Physical IDs: top T1–T12 = 0–11 left-to-right; bottom B1–B12 = 12–23 left-to-right.
// Verified against Board.glb generation: x = ±.139 + (j−2.5)*.035; outer edge z = ±.205.
export const PATHS: readonly [readonly number[], readonly number[]] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12],
  [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
export function pointPosition(point: number) {
  const column = point % 12;
  return {
    x: (column < 6 ? -0.139 : 0.139) + ((column % 6) - 2.5) * 0.035,
    z: point < 12 ? -0.184 : 0.184,
  };
}
