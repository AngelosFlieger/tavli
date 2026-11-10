import { PATHS, pointPosition } from '../game/points';

/** Use the recess beside the player's starting or finishing point, never the opposite half. */
export function trayPosition(
  player: number,
  index: number,
  thickness: number,
  depth: number,
  stage: 'start' | 'finish' = 'finish',
) {
  const path = PATHS[player];
  const point = stage === 'start' ? path[0] : path[path.length - 1];
  const adjacent = pointPosition(point);
  const spacing = Math.min(thickness + 0.0007, 0.0095) * depth;
  return {
    x: adjacent.x < 0 ? -0.282 : 0.282,
    y: 0.0265 + 0.0152,
    z: Math.sign(adjacent.z) * 0.132 * depth + (index - 7) * spacing - thickness / 2,
  };
}
