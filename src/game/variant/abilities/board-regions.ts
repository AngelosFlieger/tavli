import { PATHS } from '../../points';

export const START_POINTS: ReadonlySet<number> = new Set(PATHS.map((path) => path[0]));

export const HOME_POINTS: ReadonlySet<number> = new Set(PATHS.flatMap((path) => path.slice(18)));

export const PLAYER_HOME_POINTS: readonly ReadonlySet<number>[] = PATHS.map(
  (path) => new Set(path.slice(18)),
);
